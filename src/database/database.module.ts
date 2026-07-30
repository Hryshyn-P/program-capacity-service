import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Program } from "../programs/program.entity";
import { Reservation } from "../reservations/reservation.entity";
import { TreasuryInbox } from "../treasury/treasury-inbox.entity";
import { InitialSchema1722297600000 } from "./migrations/1722297600000-InitialSchema";

export const ENTITIES = [Program, Reservation, TreasuryInbox];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres" as const,
        url: config.getOrThrow<string>("databaseUrl"),
        entities: ENTITIES,
        migrations: [InitialSchema1722297600000],
        synchronize: false,
        logging: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
