import { Injectable } from "@nestjs/common";
import Decimal from "decimal.js";
import { DataSource, EntityManager } from "typeorm";
import {
  calculateReservedAmount,
  fx,
  money,
  positiveDecimal,
} from "../common/decimal";
import { DomainError } from "../common/domain-error";
import { Program } from "../programs/program.entity";
import type { CreateReservationDto } from "./dto/create-reservation.dto";
import { Reservation } from "./reservation.entity";
import { reservationFingerprint } from "./fingerprint";

export interface ReservationResponse {
  reservationId: string;
  programId: string;
  invoiceId: string;
  invoiceAmount: string;
  invoiceCurrency: string;
  programCurrency: string;
  fxRate: string;
  reservedAmount: string;
  status: "ACTIVE" | "RELEASED";
  createdAt: string;
}

export interface ReleaseResponse {
  reservationId: string;
  programId: string;
  invoiceId: string;
  releasedAmount: string;
  programCurrency: string;
  status: "RELEASED";
  releasedAt: string;
}

@Injectable()
export class ReservationsService {
  constructor(private readonly dataSource: DataSource) {}

  async reserve(
    programId: string,
    dto: CreateReservationDto,
  ): Promise<{ created: boolean; body: ReservationResponse }> {
    return this.dataSource.transaction(async (manager) => {
      const program = await this.lockProgram(manager, programId);
      const rate = this.resolveRate(dto, program.currency);
      const invoiceAmount = money(
        positiveDecimal(dto.invoiceAmount, "invoiceAmount"),
        "invoiceAmount",
      );
      const reservedAmount = calculateReservedAmount(invoiceAmount, rate);
      if (!new Decimal(reservedAmount).isPositive()) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "Calculated reserved amount must be greater than zero",
          400,
        );
      }
      const fingerprint = reservationFingerprint({
        invoiceId: dto.invoiceId,
        invoiceAmount,
        invoiceCurrency: dto.invoiceCurrency,
        fxRate: rate,
      });
      const existing = await manager.findOne(Reservation, {
        where: { programId, invoiceId: dto.invoiceId },
      });
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) {
          throw new DomainError(
            "RESERVATION_CONFLICT",
            "A reservation already exists with different immutable data",
            409,
            { programId, invoiceId: dto.invoiceId },
          );
        }
        return {
          created: false,
          body: this.toReservation(existing, program.currency),
        };
      }

      const available = new Decimal(program.totalLimit).minus(
        program.reservedAmount,
      );
      if (available.lt(reservedAmount)) {
        throw new DomainError(
          "INSUFFICIENT_CAPACITY",
          "The program does not have sufficient available capacity",
          409,
          {
            availableAmount: money(available),
            requestedAmount: reservedAmount,
            currency: program.currency,
          },
        );
      }
      const reservation = manager.create(Reservation, {
        programId,
        invoiceId: dto.invoiceId,
        invoiceCurrency: dto.invoiceCurrency,
        invoiceAmount,
        fxRate: rate,
        reservedAmount,
        status: "ACTIVE",
        source: "API",
        requestFingerprint: fingerprint,
        releasedAt: null,
      });
      const saved = await manager.save(reservation);
      program.reservedAmount = money(
        new Decimal(program.reservedAmount).plus(reservedAmount),
      );
      await manager.save(program);
      return {
        created: true,
        body: this.toReservation(saved, program.currency),
      };
    });
  }

  async release(
    programId: string,
    invoiceId: string,
  ): Promise<ReleaseResponse> {
    return this.dataSource.transaction(async (manager) => {
      const program = await this.lockProgram(manager, programId);
      const reservation = await manager.findOne(Reservation, {
        where: { programId, invoiceId },
      });
      if (!reservation) {
        throw new DomainError(
          "RESERVATION_NOT_FOUND",
          "Reservation was not found",
          404,
          {
            programId,
            invoiceId,
          },
        );
      }
      if (reservation.status === "RELEASED")
        return this.toRelease(reservation, program.currency);

      const nextReserved = new Decimal(program.reservedAmount).minus(
        reservation.reservedAmount,
      );
      if (nextReserved.isNegative()) {
        throw new DomainError(
          "DATA_INVARIANT_VIOLATION",
          "Releasing the reservation would make the aggregate negative",
          500,
          { programId, invoiceId },
        );
      }
      reservation.status = "RELEASED";
      reservation.releasedAt = new Date();
      program.reservedAmount = money(nextReserved);
      await manager.save(reservation);
      await manager.save(program);
      return this.toRelease(reservation, program.currency);
    });
  }

  private async lockProgram(
    manager: EntityManager,
    programId: string,
  ): Promise<Program> {
    const program = await manager
      .getRepository(Program)
      .createQueryBuilder("program")
      .setLock("pessimistic_write")
      .where("program.id = :programId", { programId })
      .getOne();
    if (!program) {
      throw new DomainError("PROGRAM_NOT_FOUND", "Program was not found", 404, {
        programId,
      });
    }
    return program;
  }

  private resolveRate(
    dto: CreateReservationDto,
    programCurrency: string,
  ): string {
    if (dto.invoiceCurrency === programCurrency) {
      if (
        dto.fxRate !== undefined &&
        !positiveDecimal(dto.fxRate, "fxRate").eq(1)
      ) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "fxRate must be 1 when invoice and program currencies match",
          400,
          { field: "fxRate" },
        );
      }
      return fx(1);
    }
    if (dto.fxRate === undefined) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "fxRate is required for different currencies",
        400,
        {
          field: "fxRate",
        },
      );
    }
    return fx(positiveDecimal(dto.fxRate, "fxRate"));
  }

  private toReservation(
    reservation: Reservation,
    programCurrency: string,
  ): ReservationResponse {
    return {
      reservationId: reservation.id,
      programId: reservation.programId,
      invoiceId: reservation.invoiceId,
      invoiceAmount: money(reservation.invoiceAmount),
      invoiceCurrency: reservation.invoiceCurrency,
      programCurrency,
      fxRate: fx(reservation.fxRate),
      reservedAmount: money(reservation.reservedAmount),
      status: reservation.status,
      createdAt: reservation.createdAt.toISOString(),
    };
  }

  private toRelease(
    reservation: Reservation,
    programCurrency: string,
  ): ReleaseResponse {
    if (!reservation.releasedAt) {
      throw new DomainError(
        "DATA_INVARIANT_VIOLATION",
        "Released reservation has no timestamp",
        500,
      );
    }
    return {
      reservationId: reservation.id,
      programId: reservation.programId,
      invoiceId: reservation.invoiceId,
      releasedAmount: money(reservation.reservedAmount),
      programCurrency,
      status: "RELEASED",
      releasedAt: reservation.releasedAt.toISOString(),
    };
  }
}
