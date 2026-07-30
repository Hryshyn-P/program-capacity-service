import "dotenv/config";
import dataSource from "../src/database/data-source";

async function runMigrations(): Promise<void> {
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
    process.stdout.write("Migrations complete\n");
  } finally {
    await dataSource.destroy();
  }
}

void runMigrations().catch((error: unknown) => {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  process.stderr.write(`Migration failed (${errorName})\n`);
  process.exitCode = 1;
});
