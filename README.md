# Program Capacity Service

A production-minded NestJS service that reserves and releases financing program
capacity and consumes treasury limit updates and authoritative reconciliation
snapshots.

## Architecture

```text
client --JWT--> API -----------+
                               +--> PostgreSQL (program row locks + inbox)
Kafka --------> worker --------+
                  |
                  +--> DLQ for invalid events
```

One repository and one shared application model produce two processes:
`src/main.ts` serves HTTP and `src/worker.ts` consumes Kafka. This keeps business
transactions consistent while allowing independent operational scaling. See
[docs/architecture.md](docs/architecture.md) for the detailed rationale.

## Prerequisites and startup

- Docker with Compose, or Node.js 24 + pnpm 10 + PostgreSQL 16 + Kafka 4.1.2.

The complete local stack:

```bash
docker compose up --build -d --wait
pnpm smoke:kafka
```

This starts PostgreSQL, native KRaft Kafka (no ZooKeeper), runs migrations,
idempotently seeds `program-001`, then starts API and worker. Production
containers execute compiled JavaScript directly with Node.js; pnpm and Corepack
are build-time tools and are not required at runtime. The API waits for
migrations and seed but does not depend on Kafka; the worker requires both
PostgreSQL and a healthy broker.

PostgreSQL and Kafka use the `postgres-data` and `kafka-data` named volumes.
They must be retained or reset together because `treasury_inbox` source
positions correspond to offsets in the Kafka log:

```bash
docker compose down      # stop while retaining both volumes
docker compose down -v   # destructive clean reset of both volumes
```

For host development, copy `.env.example` to `.env`, start dependencies, then:

```bash
pnpm install
pnpm migration:run
pnpm seed
pnpm dev:api
pnpm dev:worker
```

Configuration is fail-fast. Required variables are `DATABASE_URL`,
`KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, `KAFKA_GROUP_ID`, `KAFKA_TOPIC`,
`KAFKA_DLQ_TOPIC`, `JWT_SECRET` (minimum 32 characters), `JWT_ISSUER`, and
`JWT_AUDIENCE`; `PORT`, `NODE_ENV`, and `LOG_LEVEL` have validated defaults.

## Authentication and HTTP

Generate a one-hour local token from `.env`:

```bash
TOKEN=$(pnpm --silent auth:token)
```

Read capacity:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/v1/programs/program-001/capacity
```

Reserve and release:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:3000/v1/programs/program-001/reservations \
  -d '{"invoiceId":"INV-2026-001","invoiceAmount":"100000.00","invoiceCurrency":"EUR","fxRate":"1.080000000000"}'

curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/v1/programs/program-001/reservations/INV-2026-001/release
```

All routes authenticate JWT signature, expiry, issuer, and audience. Business
endpoints also require `capacity:read` or `capacity:write`. Authenticated raw
OpenAPI JSON is at `GET /v1/docs` and requires a valid token but no business
scope; raw JSON was chosen so no Swagger static asset route can bypass the
global guard.

## Kafka

Topic: `treasury.program-capacity`; DLQ:
`treasury.program-capacity.dlq`; key: program ID. Publish valid examples:

```bash
pnpm kafka:publish -- capacity program-001
pnpm kafka:publish -- reconcile program-001
pnpm smoke:kafka
```

Both event types contain UUID `eventId`, decimal-string monetary fields, a
PostgreSQL-bigint-compatible integer-string `version`, ISO timestamp, and state.
`PROGRAM_CAPACITY_UPDATED` updates the limit while preserving reservations; it
cannot change currency. `PROGRAM_RECONCILED` supplies the complete reservation
set and optional declared active aggregate.

`pnpm smoke:kafka` creates an isolated `smoke-*` program, publishes both event
types, replays a duplicate, verifies an invalid payload in the DLQ, and polls
the authenticated HTTP API to prove the broker-to-database path. It also checks
that the worker commits the next source offset. Run it after
`docker compose up --build -d --wait`; it honors the JWT and Kafka variables
from `.env` and otherwise uses the same local defaults as Compose. CI runs this
probe against the complete Compose stack.

## Correctness semantics

- Money is never a JavaScript float. Decimal.js uses precision 50 and half-even
  rounding to six places for multiplication results. Input money is limited to
  18 integer and 6 fractional digits; FX is limited to 12 integer and 12
  fractional digits so accepted values always fit PostgreSQL `NUMERIC(24,6)`
  and `NUMERIC(24,12)`. FX direction is: one invoice-currency unit equals
  `fxRate` program-currency units. Same-currency FX is exactly one.
- A program currency is immutable after creation. Every treasury update and
  reconciliation snapshot must use the existing currency. Changing currency
  requires a new program or a separate accounting migration because existing
  reservations are fixed in the original program currency.
- A program row lock serializes every mutation. Exact capacity is allowed;
  negative availability blocks reservations but releases remain possible.
- `(programId, invoiceId)` plus a normalized SHA-256 fingerprint makes HTTP
  retries idempotent, including after release. Conflicting reuse returns 409.
- Kafka inbox rows and business changes commit in one transaction. Stale
  treasury versions are recorded but ignored.
- Reconciliation is a complete authoritative one-program snapshot. It upserts
  included details, releases omitted ACTIVE rows, and recomputes the aggregate.
  Treasury owns correct monotonically increasing program-level versions.

The reservation client supplies a fixed FX rate; there is intentionally no
external FX integration. Currency validation enforces uppercase three-letter
codes rather than embedding an ISO registry.

## Migrations and verification

```bash
pnpm migration:run
pnpm migration:revert
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm build
```

Integration/e2e tests use real PostgreSQL through Testcontainers, never SQLite.
E2e auth coverage includes missing and malformed tokens, expiry, issuer,
audience, scopes, and protection of the OpenAPI document.

## Known limitations

- A single shared HS256 secret is appropriate for this take-home; production
  federation would normally use managed key rotation/JWKS.
- There is no external FX pricing or ISO currency registry by design.
- Broker smoke verification stays separate from the deterministic transaction
  suite and runs against the complete Compose stack in CI.
- The aggregate is repaired by snapshots; no background drift checker is added.
- KafkaJS 2.2.4 can emit a Node.js 24 `TimeoutNegativeWarning` from its internal
  request-queue scheduler. Node clamps that timer to 1 ms; delivery, duplicate,
  DLQ, and offset smoke checks still pass.
