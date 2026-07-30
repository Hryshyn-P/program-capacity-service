import { Controller, Get, Param } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Scopes } from "../auth/scopes.decorator";
import { ApiErrorResponseDto } from "../common/api-error-response.dto";
import { ProgramCapacityDto } from "./program-capacity.dto";
import { ProgramsService } from "./programs.service";

@ApiTags("programs")
@ApiBearerAuth()
@Controller("programs")
export class ProgramsController {
  constructor(private readonly programs: ProgramsService) {}

  @Get(":programId/capacity")
  @Scopes("capacity:read")
  @ApiOperation({
    summary: "Read current program capacity",
    description: "Scope: capacity:read",
  })
  @ApiOkResponse({ type: ProgramCapacityDto })
  @ApiNotFoundResponse({
    description: "PROGRAM_NOT_FOUND",
    type: ApiErrorResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  getCapacity(
    @Param("programId") programId: string,
  ): Promise<ProgramCapacityDto> {
    return this.programs.getCapacity(programId);
  }
}
