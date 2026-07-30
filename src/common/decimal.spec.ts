import { calculateReservedAmount, fx, money, parseDecimal } from "./decimal";

describe("decimal money rules", () => {
  it("parses decimal strings and rejects exponent/negative syntax", () => {
    expect(parseDecimal("12.3400", "amount").toString()).toBe("12.34");
    expect(() => parseDecimal("1e2", "amount")).toThrow("decimal string");
    expect(() => parseDecimal("-1", "amount")).toThrow("decimal string");
  });

  it("multiplies and rounds to six places using half even", () => {
    expect(calculateReservedAmount("100000.00", "1.08")).toBe("108000.000000");
    expect(money("1.2345665")).toBe("1.234566");
    expect(money("1.2345675")).toBe("1.234568");
  });

  it("formats FX to twelve places", () => {
    expect(fx("1")).toBe("1.000000000000");
  });

  it("rejects values that overflow PostgreSQL numeric columns after rounding", () => {
    expect(() => money("999999999999999999.9999995")).toThrow(
      "supported precision",
    );
    expect(() => fx("1000000000000")).toThrow("supported precision");
  });
});
