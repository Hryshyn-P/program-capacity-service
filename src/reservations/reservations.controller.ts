import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { Scopes } from "../auth/scopes.decorator";
import { CreateReservationDto } from "./dto/create-reservation.dto";
import { ReservationsService } from "./reservations.service";

@ApiTags("reservations")
@ApiBearerAuth()
@Controller("programs/:programId/reservations")
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  @Scopes("capacity:write")
  @ApiOperation({
    summary: "Reserve invoice capacity",
    description: "Scope: capacity:write",
  })
  @ApiCreatedResponse({ description: "Reservation created" })
  @ApiConflictResponse({
    description: "RESERVATION_CONFLICT or INSUFFICIENT_CAPACITY",
  })
  async reserve(
    @Param("programId") programId: string,
    @Body() dto: CreateReservationDto,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.reservations.reserve(programId, dto);
    response
      .status(result.created ? HttpStatus.CREATED : HttpStatus.OK)
      .json(result.body);
  }

  @Post(":invoiceId/release")
  @HttpCode(HttpStatus.OK)
  @Scopes("capacity:write")
  @ApiOperation({
    summary: "Release invoice capacity",
    description: "Scope: capacity:write",
  })
  @ApiOkResponse({ description: "Released or already released" })
  release(
    @Param("programId") programId: string,
    @Param("invoiceId") invoiceId: string,
  ) {
    return this.reservations.release(programId, invoiceId);
  }
}
