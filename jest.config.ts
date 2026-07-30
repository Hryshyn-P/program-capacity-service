import type { Config } from "jest";

const common: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
};

export default {
  projects: [
    {
      ...common,
      displayName: "unit",
      testMatch: ["<rootDir>/src/**/*.spec.ts"],
    },
    {
      ...common,
      displayName: "integration",
      testMatch: ["<rootDir>/test/integration/**/*.spec.ts"],
      testTimeout: 120000,
    },
    {
      ...common,
      displayName: "e2e",
      testMatch: ["<rootDir>/test/e2e/**/*.spec.ts"],
      testTimeout: 120000,
    },
  ],
} satisfies Config;
