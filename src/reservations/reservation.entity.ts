import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Program } from "../programs/program.entity";
import type {
  ReservationSource,
  ReservationStatus,
} from "./reservation-status";

@Entity({ name: "invoice_reservations" })
export class Reservation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "program_id", type: "varchar", length: 128 })
  programId!: string;

  @ManyToOne(() => Program, (program) => program.reservations, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "program_id" })
  program!: Program;

  @Column({ name: "invoice_id", type: "varchar", length: 256 })
  invoiceId!: string;

  @Column({ name: "invoice_currency", type: "char", length: 3 })
  invoiceCurrency!: string;

  @Column({ name: "invoice_amount", type: "numeric", precision: 24, scale: 6 })
  invoiceAmount!: string;

  @Column({ name: "fx_rate", type: "numeric", precision: 24, scale: 12 })
  fxRate!: string;

  @Column({ name: "reserved_amount", type: "numeric", precision: 24, scale: 6 })
  reservedAmount!: string;

  @Column({ type: "varchar", length: 16 })
  status!: ReservationStatus;

  @Column({ type: "varchar", length: 16 })
  source!: ReservationSource;

  @Column({ name: "request_fingerprint", type: "char", length: 64 })
  requestFingerprint!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "released_at", type: "timestamptz", nullable: true })
  releasedAt!: Date | null;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
