import "dotenv/config";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { Kafka, Partitioners, type Consumer } from "kafkajs";
import { treasuryEventSchema } from "../src/treasury/treasury-event.schemas";

interface CapacityResponse {
  programId: string;
  currency: string;
  totalLimit: string;
  reservedAmount: string;
  treasuryVersion: string | null;
}

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? "30000");

interface DlqPayload {
  partition: number;
  offset: string;
  key: string | null;
  originalPayload: string | null;
  errorCode: string;
}

function isCapacityResponse(value: unknown): value is CapacityResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.programId === "string" &&
    typeof candidate.currency === "string" &&
    typeof candidate.totalLimit === "string" &&
    typeof candidate.reservedAmount === "string" &&
    (typeof candidate.treasuryVersion === "string" ||
      candidate.treasuryVersion === null)
  );
}

function isDlqPayload(value: unknown): value is DlqPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.partition === "number" &&
    typeof candidate.offset === "string" &&
    (typeof candidate.key === "string" || candidate.key === null) &&
    (typeof candidate.originalPayload === "string" ||
      candidate.originalPayload === null) &&
    typeof candidate.errorCode === "string"
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  message: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readCapacity(
  programId: string,
  token: string,
): Promise<CapacityResponse | undefined> {
  const response = await fetch(
    `${apiBaseUrl}/v1/programs/${encodeURIComponent(programId)}/capacity`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `Capacity API returned ${response.status}: ${await response.text()}`,
    );
  }
  const body: unknown = await response.json();
  if (!isCapacityResponse(body)) {
    throw new Error("Capacity API returned an unexpected response");
  }
  return body;
}

async function waitForCapacity(
  programId: string,
  token: string,
  expectedVersion: string,
  expectedReservedAmount: string,
): Promise<CapacityResponse> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const capacity = await readCapacity(programId, token);
      if (
        capacity?.treasuryVersion === expectedVersion &&
        capacity.reservedAmount === expectedReservedAmount
      ) {
        return capacity;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const suffix = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(
    `Timed out waiting for treasury version ${expectedVersion} on ${programId}${suffix}`,
  );
}

async function waitForDlq(
  consumer: Consumer,
  dlqTopic: string,
  expectedKey: string,
  expectedPayload: string,
  publish: () => Promise<unknown>,
): Promise<{ partition: number; offset: string }> {
  let resolveMatch:
    ((position: { partition: number; offset: string }) => void) | undefined;
  const matched = new Promise<{ partition: number; offset: string }>(
    (resolve) => {
      resolveMatch = resolve;
    },
  );
  let resolveGroupJoin: (() => void) | undefined;
  const groupJoined = new Promise<void>((resolve) => {
    resolveGroupJoin = resolve;
  });
  const removeGroupJoinListener = consumer.on(consumer.events.GROUP_JOIN, () =>
    resolveGroupJoin?.(),
  );
  await consumer.subscribe({ topic: dlqTopic, fromBeginning: false });
  await consumer.run({
    eachMessage: ({ message }) => {
      try {
        const parsed: unknown = JSON.parse(
          message.value?.toString("utf8") ?? "",
        );
        if (
          isDlqPayload(parsed) &&
          parsed.key === expectedKey &&
          parsed.originalPayload === expectedPayload &&
          parsed.errorCode === "INVALID_TREASURY_EVENT"
        ) {
          resolveMatch?.({
            partition: parsed.partition,
            offset: parsed.offset,
          });
        }
      } catch (error) {
        const errorName =
          error instanceof Error ? error.name : "UnknownParseError";
        process.stderr.write(
          `Ignoring unrelated malformed DLQ record (${errorName})\n`,
        );
      }
      return Promise.resolve();
    },
  });
  try {
    await withTimeout(groupJoined, "Timed out joining the DLQ consumer group");
  } finally {
    removeGroupJoinListener();
  }
  await publish();
  return withTimeout(matched, "Timed out waiting for the DLQ record");
}

async function waitForCommittedOffset(
  kafka: Kafka,
  groupId: string,
  topic: string,
  partition: number,
  processedOffset: string,
): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  const expectedOffset = BigInt(processedOffset) + 1n;
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const topics = await admin.fetchOffsets({ groupId, topics: [topic] });
      const committed = topics
        .find((entry) => entry.topic === topic)
        ?.partitions.find((entry) => entry.partition === partition)?.offset;
      if (
        committed !== undefined &&
        committed !== "-1" &&
        BigInt(committed) >= expectedOffset
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(
      `Timed out waiting for committed offset ${expectedOffset.toString()}`,
    );
  } finally {
    await admin.disconnect();
  }
}

async function main(): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("SMOKE_TIMEOUT_MS must be a positive number");
  }
  const secret =
    process.env.JWT_SECRET ?? "local-development-secret-at-least-32-chars";
  const issuer = process.env.JWT_ISSUER ?? "program-capacity-service";
  const audience = process.env.JWT_AUDIENCE ?? "program-capacity-api";
  const token = jwt.sign({ scope: ["capacity:read"] }, secret, {
    subject: "kafka-smoke",
    issuer,
    audience,
    expiresIn: "5m",
    algorithm: "HS256",
  });
  const programId = `smoke-${randomUUID()}`;
  const capacityVersion = String(Date.now());
  const reconciliationVersion = String(BigInt(capacityVersion) + 1n);
  const capacityEvent = treasuryEventSchema.parse({
    eventId: randomUUID(),
    type: "PROGRAM_CAPACITY_UPDATED",
    programId,
    version: capacityVersion,
    occurredAt: new Date().toISOString(),
    state: { currency: "USD", totalLimit: "100.000000" },
  });
  const reconciliationEvent = treasuryEventSchema.parse({
    eventId: randomUUID(),
    type: "PROGRAM_RECONCILED",
    programId,
    version: reconciliationVersion,
    occurredAt: new Date().toISOString(),
    state: {
      currency: "USD",
      totalLimit: "100.000000",
      declaredReservedAmount: "25.000000",
      reservations: [
        {
          invoiceId: "SMOKE-INVOICE",
          invoiceAmount: "25.000000",
          invoiceCurrency: "USD",
          fxRate: "1.000000000000",
          reservedAmount: "25.000000",
          status: "ACTIVE",
        },
      ],
    },
  });

  const kafka = new Kafka({
    clientId: `${process.env.KAFKA_CLIENT_ID ?? "program-capacity"}-smoke`,
    brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092")
      .split(",")
      .map((broker) => broker.trim()),
  });
  const producer = kafka.producer({
    createPartitioner: Partitioners.DefaultPartitioner,
  });
  const dlqConsumer = kafka.consumer({
    groupId: `program-capacity-smoke-dlq-${randomUUID()}`,
  });
  const dlqTopic =
    process.env.KAFKA_DLQ_TOPIC ?? "treasury.program-capacity.dlq";
  const invalidPayload = JSON.stringify({
    eventId: randomUUID(),
    type: "PROGRAM_CAPACITY_UPDATED",
    programId,
    version: String(BigInt(reconciliationVersion) + 1n),
    occurredAt: new Date().toISOString(),
    state: { currency: "USD", totalLimit: 10 },
  });
  await Promise.all([producer.connect(), dlqConsumer.connect()]);
  try {
    const topic = process.env.KAFKA_TOPIC ?? "treasury.program-capacity";
    await producer.send({
      topic,
      messages: [
        {
          key: programId,
          value: JSON.stringify(capacityEvent),
        },
      ],
    });
    await waitForCapacity(programId, token, capacityVersion, "0.000000");

    await producer.send({
      topic,
      messages: [
        {
          key: programId,
          value: JSON.stringify(reconciliationEvent),
        },
      ],
    });
    const finalCapacity = await waitForCapacity(
      programId,
      token,
      reconciliationVersion,
      "25.000000",
    );

    const invalidPosition = await waitForDlq(
      dlqConsumer,
      dlqTopic,
      programId,
      invalidPayload,
      () =>
        producer.send({
          topic,
          messages: [
            {
              key: programId,
              value: JSON.stringify(reconciliationEvent),
            },
            { key: programId, value: invalidPayload },
          ],
        }),
    );
    await waitForCommittedOffset(
      kafka,
      process.env.KAFKA_GROUP_ID ?? "program-capacity-worker",
      topic,
      invalidPosition.partition,
      invalidPosition.offset,
    );
    const afterDuplicate = await readCapacity(programId, token);
    if (
      afterDuplicate?.currency !== finalCapacity.currency ||
      afterDuplicate.totalLimit !== finalCapacity.totalLimit ||
      afterDuplicate.reservedAmount !== finalCapacity.reservedAmount ||
      afterDuplicate.treasuryVersion !== finalCapacity.treasuryVersion
    ) {
      throw new Error("Duplicate event changed capacity state");
    }
    process.stdout.write(
      `Kafka smoke passed (delivery, duplicate inbox, DLQ): ${JSON.stringify(finalCapacity)}\n`,
    );
  } finally {
    await Promise.allSettled([producer.disconnect(), dlqConsumer.disconnect()]);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`Kafka smoke failed: ${message}\n`);
  process.exitCode = 1;
});
