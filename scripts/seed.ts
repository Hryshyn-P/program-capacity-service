import "dotenv/config";
import dataSource from "../src/database/data-source";
import { Program } from "../src/programs/program.entity";

async function seed(): Promise<void> {
  await dataSource.initialize();
  try {
    await dataSource
      .createQueryBuilder()
      .insert()
      .into(Program)
      .values({
        id: "program-001",
        currency: "USD",
        totalLimit: "10000000.000000",
        reservedAmount: "0.000000",
        treasuryVersion: null,
      })
      .orIgnore()
      .execute();
    process.stdout.write("Seed complete\n");
  } finally {
    await dataSource.destroy();
  }
}

void seed().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`Seed failed: ${message}\n`);
  process.exitCode = 1;
});
