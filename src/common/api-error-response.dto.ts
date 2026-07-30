import { ApiProperty } from "@nestjs/swagger";

export class ApiErrorResponseDto {
  @ApiProperty({ example: "VALIDATION_ERROR" })
  code!: string;

  @ApiProperty({ example: "Request validation failed" })
  message!: string;

  @ApiProperty({
    type: "object",
    additionalProperties: true,
    example: { errors: ["invoiceAmount must be a decimal string"] },
  })
  details!: Record<string, unknown>;

  @ApiProperty({ example: "4fae1193-90f7-49d6-9919-9b1f15ef4048" })
  requestId!: string;
}
