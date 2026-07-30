import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { ApiErrorFilter } from "./common/api-error.filter";
import { logLevels } from "./config/log-levels";
import { DocsController } from "./docs.controller";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: logLevels(process.env.LOG_LEVEL),
  });
  const config = app.get(ConfigService);
  app.setGlobalPrefix("v1");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Program Capacity Service")
    .setDescription(
      "Authenticated financing capacity API. All routes require a bearer JWT.",
    )
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  DocsController.document = SwaggerModule.createDocument(app, swaggerConfig);

  const port = config.getOrThrow<number>("port");
  await app.listen(port);
  Logger.log(
    {
      message: "API started",
      port,
      environment: process.env.NODE_ENV ?? "development",
    },
    "Bootstrap",
  );
}

void bootstrap().catch((error: unknown) => {
  Logger.error(
    {
      message: "API failed to start",
      errorName: error instanceof Error ? error.name : "UnknownError",
    },
    "Bootstrap",
  );
  process.exitCode = 1;
});
