import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import configuration from "./config/configuration";
import { environmentSchema } from "./config/environment.validation";
import { AuthModule } from "./auth/auth.module";
import { RequestIdMiddleware } from "./common/request-id.middleware";
import { DatabaseModule } from "./database/database.module";
import { DocsController } from "./docs.controller";
import { ProgramsModule } from "./programs/programs.module";
import { ReservationsModule } from "./reservations/reservations.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: environmentSchema,
      validationOptions: { abortEarly: false },
    }),
    DatabaseModule,
    AuthModule,
    ProgramsModule,
    ReservationsModule,
  ],
  controllers: [DocsController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
