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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { Response } from "express";
import { Scopes } from "../auth/scopes.decorator";
import { ApiErrorResponseDto } from "../common/api-error-response.dto";
import { CreateReservationDto } from "./dto/create-reservation.dto";
import {
  ReleaseResponseDto,
  ReservationResponseDto,
} from "./dto/reservation-response.dto";
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
  @ApiCreatedResponse({
    description: "Reservation created",
    type: ReservationResponseDto,
  })
  @ApiOkResponse({
    description: "Idempotent retry returned the existing reservation",
    type: ReservationResponseDto,
  })
  @ApiBadRequestResponse({
    description: "VALIDATION_ERROR",
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: "RESERVATION_CONFLICT or INSUFFICIENT_CAPACITY",
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: "PROGRAM_NOT_FOUND",
    type: ApiErrorResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
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
  @ApiOkResponse({
    description: "Released or already released",
    type: ReleaseResponseDto,
  })
  @ApiNotFoundResponse({
    description: "PROGRAM_NOT_FOUND or RESERVATION_NOT_FOUND",
    type: ApiErrorResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  release(
    @Param("programId") programId: string,
    @Param("invoiceId") invoiceId: string,
  ) {
    return this.reservations.release(programId, invoiceId);
  }
}
