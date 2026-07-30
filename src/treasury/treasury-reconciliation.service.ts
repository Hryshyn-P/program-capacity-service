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
import { Reservation } from "../reservations/reservation.entity";
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

      if (
        program.treasuryVersion !== null &&
        BigInt(event.version) <= BigInt(program.treasuryVersion)
      ) {
        return { outcome: "STALE" };
      }
      if (event.type === "PROGRAM_CAPACITY_UPDATED") {
        if (
          program.currency !== event.state.currency &&
          (new Decimal(program.reservedAmount).isPositive() ||
            (await manager.exists(Reservation, {
              where: { programId: program.id, status: "ACTIVE" },
            })))
        ) {
          this.invalid(
            "Incremental capacity updates cannot change currency while reservations are active",
          );
        }
        program.currency = event.state.currency;
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
    const present = new Set<string>();
    for (const item of event.state.reservations) {
      present.add(item.invoiceId);
      const current = await manager.findOne(Reservation, {
        where: { programId: event.programId, invoiceId: item.invoiceId },
      });
      const releasedAt =
        item.status === "RELEASED" ? (current?.releasedAt ?? new Date()) : null;
      const values = {
        programId: event.programId,
        invoiceId: item.invoiceId,
        invoiceAmount: money(item.invoiceAmount),
        invoiceCurrency: item.invoiceCurrency,
        fxRate: fx(item.fxRate),
        reservedAmount: money(item.reservedAmount),
        status: item.status,
        source: "TREASURY" as const,
        requestFingerprint: reservationFingerprint({
          invoiceId: item.invoiceId,
          invoiceAmount: item.invoiceAmount,
          invoiceCurrency: item.invoiceCurrency,
          fxRate: item.fxRate,
        }),
        releasedAt,
      };
      if (current)
        await manager.save(Reservation, Object.assign(current, values));
      else await manager.save(Reservation, manager.create(Reservation, values));
    }

    const active = await manager.find(Reservation, {
      where: { programId: event.programId, status: "ACTIVE" },
    });
    for (const reservation of active) {
      if (!present.has(reservation.invoiceId)) {
        reservation.status = "RELEASED";
        reservation.releasedAt = new Date();
        await manager.save(reservation);
      }
    }
    const finalActive = await manager.find(Reservation, {
      where: { programId: event.programId, status: "ACTIVE" },
    });
    const aggregate = finalActive.reduce(
      (sum, reservation) => sum.plus(reservation.reservedAmount),
      new Decimal(0),
    );
    program.currency = event.state.currency;
    program.totalLimit = money(event.state.totalLimit, "totalLimit");
    program.reservedAmount = money(aggregate);
  }

  private validateEvent(event: TreasuryEvent): void {
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

  private invalid(message: string): never {
    throw new DomainError("INVALID_TREASURY_EVENT", message, 400);
  }
}
