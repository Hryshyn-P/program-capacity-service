import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import Decimal from "decimal.js";
import { Repository } from "typeorm";
import { DomainError } from "../common/domain-error";
import { money } from "../common/decimal";
import { Program } from "./program.entity";
import type { ProgramCapacityDto } from "./program-capacity.dto";

@Injectable()
export class ProgramsService {
  constructor(
    @InjectRepository(Program) private readonly programs: Repository<Program>,
  ) {}

  async getCapacity(programId: string): Promise<ProgramCapacityDto> {
    const program = await this.programs.findOneBy({ id: programId });
    if (!program) {
      throw new DomainError("PROGRAM_NOT_FOUND", "Program was not found", 404, {
        programId,
      });
    }
    return {
      programId: program.id,
      currency: program.currency,
      totalLimit: money(program.totalLimit),
      reservedAmount: money(program.reservedAmount),
      availableAmount: money(
        new Decimal(program.totalLimit).minus(program.reservedAmount),
      ),
      treasuryVersion: program.treasuryVersion,
      updatedAt: program.updatedAt.toISOString(),
    };
  }
}
