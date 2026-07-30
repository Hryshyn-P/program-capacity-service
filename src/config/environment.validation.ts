import Joi from "joi";

export const environmentSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ["postgres", "postgresql"] })
    .required(),
  KAFKA_BROKERS: Joi.string().min(1).required(),
  KAFKA_CLIENT_ID: Joi.string().min(1).required(),
  KAFKA_GROUP_ID: Joi.string().min(1).required(),
  KAFKA_TOPIC: Joi.string().min(1).required(),
  KAFKA_DLQ_TOPIC: Joi.string().min(1).required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ISSUER: Joi.string().min(1).required(),
  JWT_AUDIENCE: Joi.string().min(1).required(),
  LOG_LEVEL: Joi.string()
    .valid("fatal", "error", "warn", "log", "debug", "verbose")
    .default("log"),
});
