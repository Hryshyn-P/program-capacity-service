# Architecture

```text
                         PostgreSQL 16
                    +----------------------+
                    | programs (lock root) |
                    | reservations         |
                    | treasury_inbox       |
                    +----------+-----------+
                               ^
                      shared transactions
                               |
            +------------------+------------------+
            |                                     |
  +---------+----------+                +---------+----------+
  | NestJS HTTP API    |                | NestJS Kafka worker|
  | JWT + scopes       |                | Zod + KafkaJS      |
  +---------+----------+                +---------+----------+
            ^                                     ^
       approval clients                  treasury topic / DLQ
```

The API and worker are two operational entrypoints from one codebase and image.
They share no HTTP interface. PostgreSQL is their consistency boundary.

## Transaction model

The program row is the serialization point because every capacity decision
changes one program. At PostgreSQL's default `READ COMMITTED` isolation level,
`SELECT ... FOR UPDATE` makes concurrent capacity checks wait and observe the
latest committed aggregate. API reserve and release transactions lock the
program before reading reservations. A treasury transaction first claims its
idempotency inbox row, then creates the program if needed and locks it before
changing reservations or aggregates. The inbox has no foreign key to a program
and no other path locks it after a program, so this ordering introduces no
conflicting lock cycle. Consistent program-row serialization prevents
oversubscription without blocking unrelated programs.

`reserved_amount` is stored for constant-time reads and checks. Reservation
details remain authoritative. Reconciliation recalculates the aggregate from
ACTIVE rows, which repairs drift rather than trusting a supplied aggregate.
Availability is derived and may be negative after a treasury limit reduction.
That state blocks new reservations but not releases or reconciliation.

Program currency is immutable after creation. Incremental updates and complete
snapshots with another currency are invalid and roll back with their inbox
claim. This prevents historical reserved amounts from being relabeled without
an explicit accounting conversion.

## Delivery, ordering, and reconciliation

Kafka delivery is at least once. `autoCommit` is disabled; the worker commits
`offset + 1` only after its database transaction succeeds. An inbox record,
unique by event ID and source position, commits with the state change. Duplicate
delivery is therefore harmless. Invalid deterministic events go to a DLQ;
connectivity failures remain uncommitted and retry.

Messages use program ID as key, giving partition-level program ordering.
Treasury versions still reject stale messages. Reconciliation handles one
program per event, keeping snapshots bounded to the same consistency boundary.
It is a complete authoritative snapshot after all upstream commands represented
by that program-level version. This upstream causal-order assumption is needed
because HTTP commands and external snapshots do not share a command sequence.

## Deliberate boundaries

The approval client provides a fixed FX rate. The service records that rate and
uses Decimal.js with half-even six-place rounding; it is a capacity tracker, not
an FX pricing service. HTTP idempotency uses the invoice business key because
upstream retries naturally retain it, plus a canonical fingerprint to detect
conflicting reuse.

Generic repositories, CQRS, event sourcing, and event-bus wrappers are omitted:
they would obscure three direct transactions without improving isolation or
delivery semantics.
