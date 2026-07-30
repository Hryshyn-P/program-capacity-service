import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import { Reservation } from "../reservations/reservation.entity";

@Entity({ name: "programs" })
export class Program {
  @PrimaryColumn({ type: "varchar", length: 128 })
  id!: string;

  @Column({ type: "char", length: 3 })
  currency!: string;

  @Column({ name: "total_limit", type: "numeric", precision: 24, scale: 6 })
  totalLimit!: string;

  @Column({ name: "reserved_amount", type: "numeric", precision: 24, scale: 6 })
  reservedAmount!: string;

  @Column({ name: "treasury_version", type: "bigint", nullable: true })
  treasuryVersion!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @OneToMany(() => Reservation, (reservation) => reservation.program)
  reservations!: Reservation[];
}
