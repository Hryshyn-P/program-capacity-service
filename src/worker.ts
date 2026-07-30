import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { logLevels } from "./config/log-levels";
import { WorkerModule } from "./worker.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: logLevels(process.env.LOG_LEVEL),
  });
  app.enableShutdownHooks();
  Logger.log(
    {
      message: "Worker started",
      environment: process.env.NODE_ENV ?? "development",
    },
    "Bootstrap",
  );
}

void bootstrap().catch((error: unknown) => {
  Logger.error(
    {
      message: "Worker failed to start",
      errorName: error instanceof Error ? error.name : "UnknownError",
    },
    "Bootstrap",
  );
  process.exitCode = 1;
});
