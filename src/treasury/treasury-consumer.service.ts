import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Consumer, Kafka, Producer, logLevel } from "kafkajs";
import { DomainError } from "../common/domain-error";
import { treasuryEventSchema } from "./treasury-event.schemas";
import { TreasuryReconciliationService } from "./treasury-reconciliation.service";

@Injectable()
export class TreasuryConsumerService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(TreasuryConsumerService.name);
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;
  private readonly producer: Producer;
  private readonly topic: string;
  private readonly dlqTopic: string;

  constructor(
    config: ConfigService,
    private readonly reconciliation: TreasuryReconciliationService,
  ) {
    this.kafka = new Kafka({
      clientId: `${config.getOrThrow<string>("kafka.clientId")}-worker`,
      brokers: config.getOrThrow<string[]>("kafka.brokers"),
      logLevel: logLevel.INFO,
    });
    this.consumer = this.kafka.consumer({
      groupId: config.getOrThrow<string>("kafka.groupId"),
    });
    this.producer = this.kafka.producer();
    this.topic = config.getOrThrow<string>("kafka.topic");
    this.dlqTopic = config.getOrThrow<string>("kafka.dlqTopic");
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([this.consumer.connect(), this.producer.connect()]);
    await this.consumer.subscribe({ topic: this.topic, fromBeginning: false });
    await this.consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        const offset = message.offset;
        try {
          const parsedJson: unknown = JSON.parse(
            message.value?.toString("utf8") ?? "",
          );
          const event = treasuryEventSchema.parse(parsedJson);
          if (message.key?.toString("utf8") !== event.programId) {
            throw new DomainError(
              "INVALID_TREASURY_EVENT",
              "Kafka message key must equal programId",
              400,
            );
          }
          const result = await this.reconciliation.process(event, {
            topic,
            partition,
            offset,
          });
          this.logger.log({
            message: "Treasury event handled",
            topic,
            partition,
            offset,
            eventId: event.eventId,
            programId: event.programId,
            outcome: result.outcome,
          });
        } catch (error) {
          if (!this.isNonRetriable(error)) throw error;
          await this.producer.send({
            topic: this.dlqTopic,
            messages: [
              {
                key: message.key,
                value: JSON.stringify({
                  originalTopic: topic,
                  partition,
                  offset,
                  key: message.key?.toString("utf8") ?? null,
                  originalPayload: message.value?.toString("utf8") ?? null,
                  errorCode:
                    error instanceof DomainError
                      ? error.code
                      : "INVALID_TREASURY_EVENT",
                  errorMessage:
                    error instanceof Error ? error.message : "Invalid event",
                  failedAt: new Date().toISOString(),
                }),
              },
            ],
          });
        }
        await this.consumer.commitOffsets([
          { topic, partition, offset: (BigInt(offset) + 1n).toString() },
        ]);
      },
    });
    this.logger.log({ message: "Kafka consumer started", topic: this.topic });
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.consumer.disconnect(), this.producer.disconnect()]);
  }

  private isNonRetriable(error: unknown): boolean {
    return (
      error instanceof SyntaxError ||
      (error instanceof DomainError &&
        (error.code === "INVALID_TREASURY_EVENT" ||
          error.code === "VALIDATION_ERROR")) ||
      (error instanceof Error && error.name === "ZodError")
    );
  }
}
