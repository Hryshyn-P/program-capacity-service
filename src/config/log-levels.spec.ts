import { logLevels } from "./log-levels";

describe("logLevels", () => {
  it("enables the configured severity and every higher severity", () => {
    expect(logLevels("warn")).toEqual(["fatal", "error", "warn"]);
    expect(logLevels("debug")).toEqual([
      "fatal",
      "error",
      "warn",
      "log",
      "debug",
    ]);
  });

  it("defaults safely when the value is absent or invalid", () => {
    const expected = ["fatal", "error", "warn", "log"];
    expect(logLevels(undefined)).toEqual(expected);
    expect(logLevels("invalid")).toEqual(expected);
  });
});
