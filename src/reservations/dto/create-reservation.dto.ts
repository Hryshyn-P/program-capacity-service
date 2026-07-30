import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, Matches, MaxLength } from "class-validator";
import { DECIMAL_PATTERN } from "../../common/decimal";

export class CreateReservationDto {
  @ApiProperty({ example: "INV-2026-001" })
  @IsNotEmpty()
  @MaxLength(256)
  invoiceId!: string;

  @ApiProperty({ example: "100000.00" })
  @Matches(DECIMAL_PATTERN)
  invoiceAmount!: string;

  @ApiProperty({ example: "EUR" })
  @Matches(/^[A-Z]{3}$/)
  invoiceCurrency!: string;

  @ApiPropertyOptional({ example: "1.080000000000" })
  @IsOptional()
  @Matches(DECIMAL_PATTERN)
  fxRate?: string;
}
