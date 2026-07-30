import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "treasury_inbox" })
export class TreasuryInbox {
  @PrimaryColumn({ name: "event_id", type: "uuid" })
  eventId!: string;

  @Column({ name: "program_id", type: "varchar", length: 128 })
  programId!: string;

  @Column({ name: "event_type", type: "varchar", length: 64 })
  eventType!: string;

  @Column({ name: "source_version", type: "bigint" })
  sourceVersion!: string;

  @Column({ type: "varchar", length: 256 })
  topic!: string;

  @Column({ type: "integer" })
  partition!: number;

  @Column({ type: "bigint" })
  offset!: string;

  @Column({ name: "processed_at", type: "timestamptz" })
  processedAt!: Date;
}
