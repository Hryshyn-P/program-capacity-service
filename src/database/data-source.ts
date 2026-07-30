import "reflect-metadata";
import { config as loadEnv } from "dotenv";
import { DataSource } from "typeorm";
import { ENTITIES } from "./database.module";

loadEnv();

export default new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  entities: ENTITIES,
  migrations: [__dirname + "/migrations/*{.ts,.js}"],
  synchronize: false,
});
