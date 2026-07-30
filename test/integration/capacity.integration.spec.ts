import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import { DataSource } from "typeorm";
import { DomainError } from "../../src/common/domain-error";
import { InitialSchema1722297600000 } from "../../src/database/migrations/1722297600000-InitialSchema";
import { Program } from "../../src/programs/program.entity";
import { Reservation } from "../../src/reservations/reservation.entity";
import { ReservationsService } from "../../src/reservations/reservations.service";
import { TreasuryInbox } from "../../src/treasury/treasury-inbox.entity";
import { TreasuryReconciliationService } from "../../src/treasury/treasury-reconciliation.service";

jest.setTimeout(120_000);

describe("capacity transactions (PostgreSQL)", () => {
  let container: StartedTestContainer | undefined;
  let database: DataSource;
  let reservations: ReservationsService;
  let treasury: TreasuryReconciliationService;

  beforeAll(async () => {
    let url = process.env.TEST_DATABASE_URL;
    if (!url) {
      container = await new GenericContainer("postgres:16")
        .withEnvironment({
          POSTGRES_USER: "capacity",
          POSTGRES_PASSWORD: "capacity",
          POSTGRES_DB: "capacity_test",
        })
        .withExposedPorts(5432)
        .withWaitStrategy(
          Wait.forLogMessage(
            "database system is ready to accept connections",
            2,
          ),
        )
        .start();
      url = `postgresql://capacity:capacity@${container.getHost()}:${container.getMappedPort(5432)}/capacity_test`;
    }
    database = new DataSource({
      type: "postgres",
      url,
      entities: [Program, Reservation, TreasuryInbox],
      migrations: [InitialSchema1722297600000],
      synchronize: false,
    });
    await database.initialize();
    await database.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await database.runMigrations();
    reservations = new ReservationsService(database);
    treasury = new TreasuryReconciliationService(database);
  });

  afterAll(async () => {
    if (database?.isInitialized) await database.destroy();
    if (container) await container.stop();
  });

  beforeEach(async () => {
    await database.query(
      "TRUNCATE treasury_inbox, invoice_reservations, programs CASCADE",
    );
  });

  async function program(limit = "100.000000"): Promise<void> {
    await database.getRepository(Program).save({
      id: "p1",
      currency: "USD",
      totalLimit: limit,
      reservedAmount: "0.000000",
      treasuryVersion: null,
    });
  }

  it("reserves exact capacity, handles retry/conflict, and releases idempotently", async () => {
    await program();
    const input = {
      invoiceId: "A",
      invoiceAmount: "100",
      invoiceCurrency: "USD",
    };
    const first = await reservations.reserve("p1", input);
    expect(first.created).toBe(true);
    expect(first.body.reservedAmount).toBe("100.000000");
    const retry = await reservations.reserve("p1", {
      ...input,
      fxRate: "1.000",
    });
    expect(retry).toMatchObject({
      created: false,
      body: { reservationId: first.body.reservationId },
    });
    await expect(
      reservations.reserve("p1", { ...input, invoiceAmount: "99" }),
    ).rejects.toMatchObject({ code: "RESERVATION_CONFLICT" });
    const released = await reservations.release("p1", "A");
    const repeated = await reservations.release("p1", "A");
    expect(repeated.releasedAt).toBe(released.releasedAt);
    expect(
      (await database.getRepository(Program).findOneByOrFail({ id: "p1" }))
        .reservedAmount,
    ).toBe("0.000000");
  });

  it("converts currency, rejects insufficient capacity, and releases historical amount", async () => {
    await program("108.000000");
    const created = await reservations.reserve("p1", {
      invoiceId: "EUR-1",
      invoiceAmount: "100",
      invoiceCurrency: "EUR",
      fxRate: "1.08",
    });
    expect(created.body.reservedAmount).toBe("108.000000");
    await expect(
      reservations.reserve("p1", {
        invoiceId: "B",
        invoiceAmount: "1",
        invoiceCurrency: "USD",
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CAPACITY" });
    await database
      .getRepository(Program)
      .update("p1", { totalLimit: "10.000000" });
    expect((await reservations.release("p1", "EUR-1")).releasedAmount).toBe(
      "108.000000",
    );
  });

  it("serializes competing reservations and concurrent duplicates", async () => {
    await program();
    const settled = await Promise.allSettled([
      reservations.reserve("p1", {
        invoiceId: "A",
        invoiceAmount: "80",
        invoiceCurrency: "USD",
      }),
      reservations.reserve("p1", {
        invoiceId: "B",
        invoiceAmount: "80",
        invoiceCurrency: "USD",
      }),
    ]);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    const rejected = settled.find(
      (item) => item.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(DomainError);
    expect((rejected.reason as DomainError).code).toBe("INSUFFICIENT_CAPACITY");
    const stored = await database
      .getRepository(Program)
      .findOneByOrFail({ id: "p1" });
    expect(stored.reservedAmount).toBe("80.000000");
    expect(
      await database
        .getRepository(Reservation)
        .countBy({ programId: "p1", status: "ACTIVE" }),
    ).toBe(1);

    await database.query("TRUNCATE invoice_reservations, programs CASCADE");
    await program();
    const input = {
      invoiceId: "SAME",
      invoiceAmount: "20",
      invoiceCurrency: "USD",
    };
    const duplicates = await Promise.all([
      reservations.reserve("p1", input),
      reservations.reserve("p1", input),
    ]);
    expect(
      new Set(duplicates.map((result) => result.body.reservationId)).size,
    ).toBe(1);
    expect(await database.getRepository(Reservation).count()).toBe(1);
  });

  it("applies, deduplicates, and rejects stale treasury updates while allowing negative availability", async () => {
    await program();
    await reservations.reserve("p1", {
      invoiceId: "A",
      invoiceAmount: "80",
      invoiceCurrency: "USD",
    });
    const event = {
      eventId: randomUUID(),
      type: "PROGRAM_CAPACITY_UPDATED" as const,
      programId: "p1",
      version: "2",
      occurredAt: new Date().toISOString(),
      state: { currency: "USD", totalLimit: "50.000000" },
    };
    const position = { topic: "t", partition: 0, offset: "1" };
    expect((await treasury.process(event, position)).outcome).toBe("APPLIED");
    expect((await treasury.process(event, position)).outcome).toBe("DUPLICATE");
    expect(
      (
        await treasury.process(
          { ...event, eventId: randomUUID(), version: "1" },
          { ...position, offset: "2" },
        )
      ).outcome,
    ).toBe("STALE");
    await reservations.release("p1", "A");
  });

  it("rejects an incremental currency change while reservations are active", async () => {
    await program();
    await reservations.reserve("p1", {
      invoiceId: "A",
      invoiceAmount: "10",
      invoiceCurrency: "USD",
    });
    const event = {
      eventId: randomUUID(),
      type: "PROGRAM_CAPACITY_UPDATED" as const,
      programId: "p1",
      version: "2",
      occurredAt: new Date().toISOString(),
      state: { currency: "EUR", totalLimit: "100.000000" },
    };

    await expect(
      treasury.process(event, { topic: "t", partition: 0, offset: "1" }),
    ).rejects.toMatchObject({ code: "INVALID_TREASURY_EVENT" });
    expect(
      await database.getRepository(Program).findOneByOrFail({ id: "p1" }),
    ).toMatchObject({
      currency: "USD",
      totalLimit: "100.000000",
      reservedAmount: "10.000000",
      treasuryVersion: null,
    });
    expect(await database.getRepository(TreasuryInbox).count()).toBe(0);
  });

  it("reconciles the active set and rolls invalid snapshots back fully", async () => {
    await program();
    await reservations.reserve("p1", {
      invoiceId: "OLD",
      invoiceAmount: "10",
      invoiceCurrency: "USD",
    });
    const event = {
      eventId: randomUUID(),
      type: "PROGRAM_RECONCILED" as const,
      programId: "p1",
      version: "3",
      occurredAt: new Date().toISOString(),
      state: {
        currency: "USD",
        totalLimit: "20.000000",
        declaredReservedAmount: "30.000000",
        reservations: [
          {
            invoiceId: "NEW",
            invoiceAmount: "30.000000",
            invoiceCurrency: "USD",
            fxRate: "1.000000000000",
            reservedAmount: "30.000000",
            status: "ACTIVE" as const,
          },
        ],
      },
    };
    await treasury.process(event, { topic: "t", partition: 0, offset: "1" });
    expect(
      (await database.getRepository(Program).findOneByOrFail({ id: "p1" }))
        .reservedAmount,
    ).toBe("30.000000");
    expect(
      await database
        .getRepository(Reservation)
        .findOneByOrFail({ programId: "p1", invoiceId: "OLD" }),
    ).toMatchObject({ status: "RELEASED" });

    const invalid = {
      ...event,
      eventId: randomUUID(),
      version: "4",
      state: { ...event.state, declaredReservedAmount: "31.000000" },
    };
    await expect(
      treasury.process(invalid, { topic: "t", partition: 0, offset: "2" }),
    ).rejects.toMatchObject({ code: "INVALID_TREASURY_EVENT" });
    expect(await database.getRepository(TreasuryInbox).count()).toBe(1);
  });
});
