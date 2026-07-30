import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import configuration from "./config/configuration";
import { environmentSchema } from "./config/environment.validation";
import { DatabaseModule } from "./database/database.module";
import { TreasuryModule } from "./treasury/treasury.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: environmentSchema,
      validationOptions: { abortEarly: false },
    }),
    DatabaseModule,
    TreasuryModule,
  ],
})
export class WorkerModule {}
