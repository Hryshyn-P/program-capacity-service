import type { LogLevel } from "@nestjs/common";

const orderedLevels: LogLevel[] = [
  "fatal",
  "error",
  "warn",
  "log",
  "debug",
  "verbose",
];

export function logLevels(level: string | undefined): LogLevel[] {
  const index = orderedLevels.indexOf((level ?? "log") as LogLevel);
  return index === -1
    ? orderedLevels.slice(0, 4)
    : orderedLevels.slice(0, index + 1);
}
