import { Injectable } from "@nestjs/common";
import Decimal from "decimal.js";
import { DataSource, EntityManager } from "typeorm";
import {
  calculateReservedAmount,
  fx,
  money,
  parseDecimal,
  positiveDecimal,
} from "../common/decimal";
import { DomainError } from "../common/domain-error";
import { Program } from "../programs/program.entity";
import { reservationFingerprint } from "../reservations/fingerprint";
import type {
  ReconciliationEvent,
  TreasuryEvent,
} from "./treasury-event.schemas";

export interface KafkaPosition {
  topic: string;
  partition: number;
  offset: string;
}

export interface TreasuryResult {
  outcome: "APPLIED" | "STALE" | "DUPLICATE";
}

@Injectable()
export class TreasuryReconciliationService {
  constructor(private readonly dataSource: DataSource) {}

  async process(
    event: TreasuryEvent,
    position: KafkaPosition,
  ): Promise<TreasuryResult> {
    this.validateEvent(event);
    return this.dataSource.transaction(async (manager) => {
      if (!(await this.claimInbox(manager, event, position)))
        return { outcome: "DUPLICATE" };

      await manager
        .createQueryBuilder()
        .insert()
        .into(Program)
        .values({
          id: event.programId,
          currency: event.state.currency,
          totalLimit: money(event.state.totalLimit, "totalLimit"),
          reservedAmount: money(0),
          treasuryVersion: null,
        })
        .orIgnore()
        .execute();
      const program = await manager
        .getRepository(Program)
        .createQueryBuilder("program")
        .setLock("pessimistic_write")
        .where("program.id = :programId", { programId: event.programId })
        .getOneOrFail();

      if (program.currency !== event.state.currency) {
        this.invalid("Program currency is immutable", {
          programId: event.programId,
          currentCurrency: program.currency,
          incomingCurrency: event.state.currency,
        });
      }
      if (
        program.treasuryVersion !== null &&
        BigInt(event.version) <= BigInt(program.treasuryVersion)
      ) {
        return { outcome: "STALE" };
      }
      if (event.type === "PROGRAM_CAPACITY_UPDATED") {
        program.totalLimit = money(event.state.totalLimit, "totalLimit");
      } else {
        await this.applySnapshot(manager, program, event);
      }
      program.treasuryVersion = event.version;
      await manager.save(program);
      return { outcome: "APPLIED" };
    });
  }

  private async claimInbox(
    manager: EntityManager,
    event: TreasuryEvent,
    position: KafkaPosition,
  ): Promise<boolean> {
    const rows = await manager.query<Array<{ event_id: string }>>(
      `INSERT INTO treasury_inbox
        (event_id, program_id, event_type, source_version, topic, partition, "offset", processed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT DO NOTHING RETURNING event_id`,
      [
        event.eventId,
        event.programId,
        event.type,
        event.version,
        position.topic,
        position.partition,
        position.offset,
      ],
    );
    return rows.length === 1;
  }

  private async applySnapshot(
    manager: EntityManager,
    program: Program,
    event: ReconciliationEvent,
  ): Promise<void> {
    const snapshot = event.state.reservations.map((item) => ({
      invoiceId: item.invoiceId,
      invoiceCurrency: item.invoiceCurrency,
      invoiceAmount: money(item.invoiceAmount, "invoiceAmount"),
      fxRate: fx(item.fxRate, "fxRate"),
      reservedAmount: money(item.reservedAmount, "reservedAmount"),
      status: item.status,
      requestFingerprint: reservationFingerprint({
        invoiceId: item.invoiceId,
        invoiceAmount: item.invoiceAmount,
        invoiceCurrency: item.invoiceCurrency,
        fxRate: item.fxRate,
      }),
    }));

    if (snapshot.length > 0) {
      await manager.query(
        `INSERT INTO invoice_reservations (
           program_id,
           invoice_id,
           invoice_currency,
           invoice_amount,
           fx_rate,
           reserved_amount,
           status,
           source,
           request_fingerprint,
           released_at
         )
         SELECT
           $1,
           item.invoice_id,
           item.invoice_currency,
           item.invoice_amount::numeric(24, 6),
           item.fx_rate::numeric(24, 12),
           item.reserved_amount::numeric(24, 6),
           item.status,
           'TREASURY',
           item.request_fingerprint,
           CASE WHEN item.status = 'RELEASED' THEN now() ELSE NULL END
         FROM jsonb_to_recordset($2::jsonb) AS item(
           invoice_id text,
           invoice_currency text,
           invoice_amount text,
           fx_rate text,
           reserved_amount text,
           status text,
           request_fingerprint text
         )
         ON CONFLICT (program_id, invoice_id) DO UPDATE SET
           invoice_currency = EXCLUDED.invoice_currency,
           invoice_amount = EXCLUDED.invoice_amount,
           fx_rate = EXCLUDED.fx_rate,
           reserved_amount = EXCLUDED.reserved_amount,
           status = EXCLUDED.status,
           source = EXCLUDED.source,
           request_fingerprint = EXCLUDED.request_fingerprint,
           released_at = CASE
             WHEN EXCLUDED.status = 'RELEASED'
               THEN COALESCE(invoice_reservations.released_at, now())
             ELSE NULL
           END,
           updated_at = now()`,
        [
          event.programId,
          JSON.stringify(
            snapshot.map((item) => ({
              invoice_id: item.invoiceId,
              invoice_currency: item.invoiceCurrency,
              invoice_amount: item.invoiceAmount,
              fx_rate: item.fxRate,
              reserved_amount: item.reservedAmount,
              status: item.status,
              request_fingerprint: item.requestFingerprint,
            })),
          ),
        ],
      );
      await manager.query(
        `UPDATE invoice_reservations
         SET status = 'RELEASED',
             released_at = COALESCE(released_at, now()),
             updated_at = now()
         WHERE program_id = $1
           AND status = 'ACTIVE'
           AND NOT (invoice_id = ANY($2::text[]))`,
        [event.programId, snapshot.map((item) => item.invoiceId)],
      );
    } else {
      await manager.query(
        `UPDATE invoice_reservations
         SET status = 'RELEASED',
             released_at = COALESCE(released_at, now()),
             updated_at = now()
         WHERE program_id = $1
           AND status = 'ACTIVE'`,
        [event.programId],
      );
    }

    const aggregateRows = await manager.query<
      Array<{ reserved_amount: string }>
    >(
      `SELECT COALESCE(SUM(reserved_amount), 0)::text AS reserved_amount
       FROM invoice_reservations
       WHERE program_id = $1
         AND status = 'ACTIVE'`,
      [event.programId],
    );
    const aggregate = aggregateRows[0]?.reserved_amount;
    if (aggregate === undefined) {
      throw new DomainError(
        "DATA_INVARIANT_VIOLATION",
        "Reconciliation aggregate query returned no result",
        500,
        { programId: event.programId },
      );
    }

    program.totalLimit = money(event.state.totalLimit, "totalLimit");
    program.reservedAmount = money(aggregate, "reservedAmount");
  }

  private validateEvent(event: TreasuryEvent): void {
    try {
      this.performValidation(event);
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.code === "INVALID_TREASURY_EVENT"
      ) {
        throw error;
      }
      throw new DomainError(
        "INVALID_TREASURY_EVENT",
        "Treasury event failed business validation",
        400,
        {
          eventId: event.eventId,
          cause:
            error instanceof DomainError
              ? error.code
              : "UNKNOWN_VALIDATION_FAILURE",
        },
      );
    }
  }

  private performValidation(event: TreasuryEvent): void {
    if (parseDecimal(event.state.totalLimit, "totalLimit").isNegative()) {
      this.invalid("totalLimit must not be negative");
    }
    money(event.state.totalLimit, "totalLimit");
    if (event.type !== "PROGRAM_RECONCILED") return;
    const invoices = new Set<string>();
    let aggregate = new Decimal(0);
    for (const reservation of event.state.reservations) {
      if (invoices.has(reservation.invoiceId))
        this.invalid("Snapshot contains duplicate invoice IDs");
      invoices.add(reservation.invoiceId);
      const invoiceAmount = money(
        positiveDecimal(reservation.invoiceAmount, "invoiceAmount"),
        "invoiceAmount",
      );
      const rate = fx(positiveDecimal(reservation.fxRate, "fxRate"), "fxRate");
      const reservedAmount = money(
        positiveDecimal(reservation.reservedAmount, "reservedAmount"),
        "reservedAmount",
      );
      if (
        reservation.invoiceCurrency === event.state.currency &&
        !new Decimal(rate).eq(1)
      ) {
        this.invalid("Same-currency snapshot reservation must use fxRate 1");
      }
      if (calculateReservedAmount(invoiceAmount, rate) !== reservedAmount) {
        this.invalid(
          `Snapshot reserved amount does not match invoice and FX for ${reservation.invoiceId}`,
        );
      }
      if (reservation.status === "ACTIVE")
        aggregate = aggregate.plus(reservedAmount);
    }
    money(aggregate, "reservedAmount");
    if (
      event.state.declaredReservedAmount !== undefined &&
      !aggregate.eq(
        money(
          parseDecimal(
            event.state.declaredReservedAmount,
            "declaredReservedAmount",
          ),
          "declaredReservedAmount",
        ),
      )
    ) {
      this.invalid(
        "Declared reserved aggregate does not match active reservations",
      );
    }
  }

  private invalid(
    message: string,
    details: Record<string, unknown> = {},
  ): never {
    throw new DomainError("INVALID_TREASURY_EVENT", message, 400, details);
  }
}
