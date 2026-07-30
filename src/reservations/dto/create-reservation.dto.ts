import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";
import { FX_RATE_PATTERN, MONEY_PATTERN } from "../../common/decimal";

export class CreateReservationDto {
  @ApiProperty({ example: "INV-2026-001" })
  @IsNotEmpty()
  @MaxLength(256)
  invoiceId!: string;

  @ApiProperty({ example: "100000.00" })
  @IsString()
  @Matches(MONEY_PATTERN, {
    message:
      "invoiceAmount must have at most 18 integer and 6 fractional digits",
  })
  invoiceAmount!: string;

  @ApiProperty({ example: "EUR" })
  @Matches(/^[A-Z]{3}$/)
  invoiceCurrency!: string;

  @ApiPropertyOptional({ example: "1.080000000000" })
  @IsOptional()
  @IsString()
  @Matches(FX_RATE_PATTERN, {
    message: "fxRate must have at most 12 integer and 12 fractional digits",
  })
  fxRate?: string;
}
