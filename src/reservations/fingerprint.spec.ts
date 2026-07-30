import { reservationFingerprint } from "./fingerprint";

describe("reservationFingerprint", () => {
  it("is deterministic across equivalent decimal representations", () => {
    const base = {
      invoiceId: "INV-1",
      invoiceAmount: "100",
      invoiceCurrency: "USD",
      fxRate: "1",
    };
    expect(reservationFingerprint(base)).toBe(
      reservationFingerprint({
        ...base,
        invoiceAmount: "100.000000",
        fxRate: "1.000",
      }),
    );
  });

  it("changes with immutable input", () => {
    const base = {
      invoiceId: "INV-1",
      invoiceAmount: "100",
      invoiceCurrency: "USD",
      fxRate: "1",
    };
    expect(reservationFingerprint(base)).not.toBe(
      reservationFingerprint({ ...base, invoiceAmount: "101" }),
    );
  });
});
