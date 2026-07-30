import { Controller, Get, Param } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Scopes } from "../auth/scopes.decorator";
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
  @ApiNotFoundResponse({ description: "PROGRAM_NOT_FOUND" })
  getCapacity(
    @Param("programId") programId: string,
  ): Promise<ProgramCapacityDto> {
    return this.programs.getCapacity(programId);
  }
}
