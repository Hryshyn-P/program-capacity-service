import { ApiProperty } from "@nestjs/swagger";

export class ReservationResponseDto {
  @ApiProperty({ format: "uuid" })
  reservationId!: string;

  @ApiProperty({ example: "program-001" })
  programId!: string;

  @ApiProperty({ example: "INV-2026-001" })
  invoiceId!: string;

  @ApiProperty({ example: "100000.000000" })
  invoiceAmount!: string;

  @ApiProperty({ example: "EUR" })
  invoiceCurrency!: string;

  @ApiProperty({ example: "USD" })
  programCurrency!: string;

  @ApiProperty({ example: "1.080000000000" })
  fxRate!: string;

  @ApiProperty({ example: "108000.000000" })
  reservedAmount!: string;

  @ApiProperty({ enum: ["ACTIVE", "RELEASED"] })
  status!: "ACTIVE" | "RELEASED";

  @ApiProperty({ format: "date-time" })
  createdAt!: string;
}

export class ReleaseResponseDto {
  @ApiProperty({ format: "uuid" })
  reservationId!: string;

  @ApiProperty({ example: "program-001" })
  programId!: string;

  @ApiProperty({ example: "INV-2026-001" })
  invoiceId!: string;

  @ApiProperty({ example: "108000.000000" })
  releasedAmount!: string;

  @ApiProperty({ example: "USD" })
  programCurrency!: string;

  @ApiProperty({ enum: ["RELEASED"] })
  status!: "RELEASED";

  @ApiProperty({ format: "date-time" })
  releasedAt!: string;
}
