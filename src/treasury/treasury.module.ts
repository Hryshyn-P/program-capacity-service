import { Module } from "@nestjs/common";
import { TreasuryConsumerService } from "./treasury-consumer.service";
import { TreasuryReconciliationService } from "./treasury-reconciliation.service";

@Module({
  providers: [TreasuryReconciliationService, TreasuryConsumerService],
  exports: [TreasuryReconciliationService],
})
export class TreasuryModule {}

@Module({
  providers: [TreasuryReconciliationService],
  exports: [TreasuryReconciliationService],
})
export class TreasuryHandlerModule {}
