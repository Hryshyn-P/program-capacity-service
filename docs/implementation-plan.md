# Implementation Plan

## Architecture

One repository produces one Docker image and two processes. The API owns
authenticated synchronous commands and reads. The worker consumes treasury
events. Both call shared transaction-oriented services and use the same
PostgreSQL database; they never call each other.

This is intentionally a modular monolith with operational process separation.
It avoids CQRS frameworks, repository wrappers, Redis, and event sourcing.

Compose runs migrations and seed before the API. The API has no Kafka startup
dependency; the worker waits for migrations and a healthy broker. PostgreSQL
and Kafka use separate named volumes that are retained or reset together so
transactional inbox source positions remain aligned with the broker log.

## Data model

- `programs`: currency, treasury-owned total limit/version, and the
  transactionally maintained reserved aggregate.
- `invoice_reservations`: immutable invoice/FX inputs and calculated program
  amount plus ACTIVE/RELEASED lifecycle.
- `treasury_inbox`: processed Kafka identity and source coordinates, committed
  atomically with the resulting business state.

Amounts use `numeric` columns mapped to strings. Availability is computed, not
stored. Constraints and useful active-reservation indexes are explicit in a
migration.

## HTTP contracts

Under `/v1`, provide capacity read, reservation creation, and complete release.
All require bearer JWTs; read and mutation endpoints require `capacity:read`
and `capacity:write` respectively. Decimal and bigint fields are strings.
Errors have `{code,message,details,requestId}`.

## Kafka contracts

Consume keyed `PROGRAM_CAPACITY_UPDATED` and `PROGRAM_RECONCILED` events from
`treasury.program-capacity`. Validate a Zod discriminated union. Commit the next
offset only after the DB transaction succeeds. Invalid non-retriable payloads
go to the DLQ with source metadata and a normalized failure.

## Concurrency and idempotency

API reserve and release transactions lock the program row before reading
reservation state. A treasury transaction claims its inbox row first, performs
a conflict-safe program insert if necessary, and then locks the program before
changing reservations or aggregates. No path acquires an inbox row after
locking a program, so there is no inverse lock order. Program-row serialization
protects capacity checks without stronger global isolation. HTTP retries compare
the business key and deterministic SHA-256 fingerprint. Kafka retries are
deduplicated by both event ID and source topic/partition/offset in the inbox.

## Reconciliation

A snapshot replaces the ACTIVE set for exactly one program: included rows are
upserted in one set-based statement, omitted active rows are released in one
update, and the stored aggregate is recomputed with `SUM` over active details.
A stale version records its inbox row but does not mutate program state. A
snapshot is validated fully before mutation.

Integration assumption: a reconciliation event is an authoritative, complete
snapshot of the program after all upstream commands represented by its
monotonically increasing version have been incorporated. Treasury generates
versions in the correct program-level ordering domain. Without a shared causal
sequence, a later authoritative snapshot may intentionally supersede HTTP
commands.

## Authentication

`@nestjs/jwt` validates signature, expiration, issuer, and audience in a global
authentication guard. A second global guard enforces scope metadata. There is
no user store or token endpoint; `pnpm auth:token` creates local development
tokens from environment configuration.

## Testing strategy

Fast Jest unit tests exercise pure money/fingerprint/schema/error behavior.
PostgreSQL integration tests exercise real transactions, reconciliation,
idempotency, and concurrent row locking. Supertest e2e tests exercise global
auth (including expiry, issuer, audience, scopes, and OpenAPI protection),
validation, and lifecycle. A separate Compose smoke path exercises Kafka
delivery, transactional inbox deduplication, manual offset progression, and DLQ
publishing against a real broker. Compose persistence is verified by retaining
both PostgreSQL and Kafka state across broker/container recreation.

## Assumptions and trade-offs

- Currency validation checks uppercase three-letter form, not a bundled ISO
  registry.
- Program currency is immutable after creation; a currency migration is outside
  normal capacity update and reconciliation semantics.
- The approval client supplies the fixed FX rate. This service tracks capacity,
  but is not an FX pricing service.
- Snapshot reservation status is accepted as ACTIVE or RELEASED; only ACTIVE
  rows contribute to the aggregate.
- `reserved_amount` is a read-performance aggregate. Reservation rows remain
  authoritative and reconciliation repairs/recalculates it.
- An incremental event can create a program with zero reserved amount.
- Kafka partitioning by program ID supplies per-program delivery ordering;
  database versions still reject stale delivery.
- Authenticated raw OpenAPI JSON is exposed at `/v1/docs`; no Swagger UI asset
  routes or unauthenticated health endpoint are introduced.
