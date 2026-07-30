import { treasuryEventSchema } from "./treasury-event.schemas";

describe("treasuryEventSchema", () => {
  const valid = {
    eventId: "fca874a4-8ab0-4e61-a13f-fecf2eb5c477",
    type: "PROGRAM_CAPACITY_UPDATED",
    programId: "program-001",
    version: "151",
    occurredAt: "2026-07-30T00:00:00.000Z",
    state: { currency: "USD", totalLimit: "12000000.000000" },
  };

  it("accepts a capacity event with decimal strings", () => {
    expect(treasuryEventSchema.parse(valid)).toEqual(valid);
  });

  it("rejects numeric money and malformed currencies", () => {
    expect(() =>
      treasuryEventSchema.parse({
        ...valid,
        state: { currency: "usd", totalLimit: 10 },
      }),
    ).toThrow();
  });

  it("rejects versions outside PostgreSQL bigint range", () => {
    expect(() =>
      treasuryEventSchema.parse({
        ...valid,
        version: "9223372036854775808",
      }),
    ).toThrow();
  });
});
