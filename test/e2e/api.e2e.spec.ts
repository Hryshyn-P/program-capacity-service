import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Test } from "@nestjs/testing";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import request from "supertest";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import type { INestApplication } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ApiErrorFilter } from "../../src/common/api-error.filter";
import { DocsController } from "../../src/docs.controller";
import { Program } from "../../src/programs/program.entity";

jest.setTimeout(120_000);

describe("HTTP API", () => {
  let container: StartedTestContainer | undefined;
  let app: INestApplication;
  const secret = "test-secret-that-is-definitely-at-least-32-characters";

  beforeAll(async () => {
    let databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      container = await new GenericContainer("postgres:16")
        .withEnvironment({
          POSTGRES_USER: "capacity",
          POSTGRES_PASSWORD: "capacity",
          POSTGRES_DB: "capacity_e2e",
        })
        .withExposedPorts(5432)
        .withWaitStrategy(
          Wait.forLogMessage(
            "database system is ready to accept connections",
            2,
          ),
        )
        .start();
      databaseUrl = `postgresql://capacity:capacity@${container.getHost()}:${container.getMappedPort(5432)}/capacity_e2e`;
    }
    Object.assign(process.env, {
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      KAFKA_BROKERS: "localhost:9092",
      KAFKA_CLIENT_ID: "test",
      KAFKA_GROUP_ID: "test",
      KAFKA_TOPIC: "test",
      KAFKA_DLQ_TOPIC: "test.dlq",
      JWT_SECRET: secret,
      JWT_ISSUER: "program-capacity-service",
      JWT_AUDIENCE: "program-capacity-api",
    });
    const { AppModule } = await import("../../src/app.module");
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new ApiErrorFilter());
    DocsController.document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("Program Capacity Service")
        .setVersion("1.0")
        .addBearerAuth()
        .build(),
    );
    await app.init();
    const database = app.get(DataSource);
    await database.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await database.runMigrations();
    await database.getRepository(Program).save({
      id: "program-001",
      currency: "USD",
      totalLimit: "100.000000",
      reservedAmount: "0.000000",
      treasuryVersion: null,
    });
  });

  afterAll(async () => {
    DocsController.document = undefined;
    if (app) await app.close();
    if (container) await container.stop();
  });

  function token(
    scopes: string[],
    overrides: Record<string, unknown> = {},
    options: SignOptions = {},
  ): string {
    return jwt.sign({ scope: scopes, ...overrides }, secret, {
      subject: "test-client",
      issuer: "program-capacity-service",
      audience: "program-capacity-api",
      expiresIn: "1h",
      ...options,
    });
  }

  it("enforces authentication and scopes", async () => {
    await request(app.getHttpServer())
      .get("/v1/programs/program-001/capacity")
      .expect(401);
    await request(app.getHttpServer())
      .get("/v1/programs/program-001/capacity")
      .set("Authorization", "Bearer invalid")
      .expect(401);
    await request(app.getHttpServer())
      .get("/v1/programs/program-001/capacity")
      .set("Authorization", `Bearer ${token(["capacity:write"])}`)
      .expect(403);
    await request(app.getHttpServer())
      .get("/v1/programs/program-001/capacity")
      .set("Authorization", `Bearer ${token(["capacity:read"])}`)
      .expect(200)
      .expect(({ body }) => expect(body.availableAmount).toBe("100.000000"));
  });

  it.each([
    ["expired token", token(["capacity:read"], {}, { expiresIn: -1 })],
    [
      "token with the wrong issuer",
      token(["capacity:read"], {}, { issuer: "another-service" }),
    ],
    [
      "token with the wrong audience",
      token(["capacity:read"], {}, { audience: "another-api" }),
    ],
  ])("rejects %s", async (_description, bearerToken) => {
    await request(app.getHttpServer())
      .get("/v1/programs/program-001/capacity")
      .set("Authorization", `Bearer ${bearerToken}`)
      .expect(401);
  });

  it("protects the OpenAPI document", async () => {
    await request(app.getHttpServer()).get("/v1/docs").expect(401);
    await request(app.getHttpServer())
      .get("/v1/docs")
      .set("Authorization", `Bearer ${token([])}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          info: { title: "Program Capacity Service", version: "1.0" },
        }),
      );
  });

  it("normalizes framework errors and propagates the request ID", async () => {
    const readToken = token(["capacity:read"]);
    await request(app.getHttpServer())
      .get("/v1/missing")
      .set("Authorization", `Bearer ${readToken}`)
      .set("x-request-id", "e2e-request-id")
      .expect("x-request-id", "e2e-request-id")
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          code: "ROUTE_NOT_FOUND",
          requestId: "e2e-request-id",
        }),
      );
  });

  it("normalizes validation and supports the reservation lifecycle", async () => {
    const writeToken = token(["capacity:write"]);
    await request(app.getHttpServer())
      .post("/v1/programs/program-001/reservations")
      .set("Authorization", `Bearer ${writeToken}`)
      .send({ invoiceId: "BAD", invoiceAmount: -1, invoiceCurrency: "usd" })
      .expect(400)
      .expect(({ body }) =>
        expect(body).toMatchObject({ code: "VALIDATION_ERROR" }),
      );

    await request(app.getHttpServer())
      .post("/v1/programs/program-001/reservations")
      .set("Authorization", `Bearer ${writeToken}`)
      .send({
        invoiceId: "TOO-PRECISE",
        invoiceAmount: "1.0000001",
        invoiceCurrency: "EUR",
        fxRate: "1.0000000000001",
      })
      .expect(400)
      .expect(({ body }) =>
        expect(body).toMatchObject({ code: "VALIDATION_ERROR" }),
      );

    await request(app.getHttpServer())
      .post("/v1/programs/program-001/reservations")
      .set("Authorization", `Bearer ${writeToken}`)
      .send({ invoiceId: "INV-1", invoiceAmount: "25", invoiceCurrency: "USD" })
      .expect(201)
      .expect(({ body }) => expect(body.reservedAmount).toBe("25.000000"));
    await request(app.getHttpServer())
      .post("/v1/programs/program-001/reservations/INV-1/release")
      .set("Authorization", `Bearer ${writeToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe("RELEASED"));
  });
});
