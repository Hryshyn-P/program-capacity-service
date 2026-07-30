import "dotenv/config";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { Kafka, Partitioners } from "kafkajs";
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
  while (Date.now() < deadline) {
    const capacity = await readCapacity(programId, token);
    if (
      capacity?.treasuryVersion === expectedVersion &&
      capacity.reservedAmount === expectedReservedAmount
    ) {
      return capacity;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Timed out waiting for treasury version ${expectedVersion} on ${programId}`,
  );
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
  await producer.connect();
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
    process.stdout.write(
      `Kafka smoke passed: ${JSON.stringify(finalCapacity)}\n`,
    );
  } finally {
    await producer.disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`Kafka smoke failed: ${message}\n`);
  process.exitCode = 1;
});
