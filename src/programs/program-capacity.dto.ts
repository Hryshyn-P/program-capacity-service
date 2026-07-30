import { ApiProperty } from "@nestjs/swagger";

export class ProgramCapacityDto {
  @ApiProperty({ example: "program-001" })
  programId!: string;
  @ApiProperty({ example: "USD" })
  currency!: string;
  @ApiProperty({ example: "10000000.000000" })
  totalLimit!: string;
  @ApiProperty({ example: "3000000.000000" })
  reservedAmount!: string;
  @ApiProperty({ example: "7000000.000000" })
  availableAmount!: string;
  @ApiProperty({ example: "152", type: String, nullable: true })
  treasuryVersion!: string | null;
  @ApiProperty()
  updatedAt!: string;
}
