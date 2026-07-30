import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Kafka, Partitioners } from "kafkajs";
import { treasuryEventSchema } from "../src/treasury/treasury-event.schemas";

async function publish(): Promise<void> {
  const type = process.argv[2] ?? "capacity";
  const programId = process.argv[3] ?? "program-001";
  const common = {
    eventId: randomUUID(),
    programId,
    version: String(Date.now()),
    occurredAt: new Date().toISOString(),
  };
  const event =
    type === "capacity"
      ? {
          ...common,
          type: "PROGRAM_CAPACITY_UPDATED" as const,
          state: { currency: "USD", totalLimit: "12000000.000000" },
        }
      : type === "reconcile"
        ? {
            ...common,
            type: "PROGRAM_RECONCILED" as const,
            state: {
              currency: "USD",
              totalLimit: "12000000.000000",
              declaredReservedAmount: "50000.000000",
              reservations: [
                {
                  invoiceId: "TREASURY-DEMO-001",
                  invoiceAmount: "50000.000000",
                  invoiceCurrency: "USD",
                  fxRate: "1.000000000000",
                  reservedAmount: "50000.000000",
                  status: "ACTIVE" as const,
                },
              ],
            },
          }
        : undefined;
  if (!event)
    throw new Error(
      "Usage: pnpm kafka:publish -- capacity|reconcile [programId]",
    );
  treasuryEventSchema.parse(event);

  const kafka = new Kafka({
    clientId: `${process.env.KAFKA_CLIENT_ID ?? "program-capacity"}-publisher`,
    brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
  });
  const producer = kafka.producer({
    createPartitioner: Partitioners.DefaultPartitioner,
  });
  await producer.connect();
  try {
    await producer.send({
      topic: process.env.KAFKA_TOPIC ?? "treasury.program-capacity",
      messages: [{ key: programId, value: JSON.stringify(event) }],
    });
    process.stdout.write(`${JSON.stringify(event, null, 2)}\n`);
  } finally {
    await producer.disconnect();
  }
}

void publish().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`Kafka publish failed: ${message}\n`);
  process.exitCode = 1;
});
