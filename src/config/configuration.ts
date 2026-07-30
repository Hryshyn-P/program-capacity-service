export interface AppConfiguration {
  port: number;
  databaseUrl: string;
  kafka: {
    brokers: string[];
    clientId: string;
    groupId: string;
    topic: string;
    dlqTopic: string;
  };
  jwt: { secret: string; issuer: string; audience: string };
}

export default (): AppConfiguration => ({
  port: Number(process.env.PORT ?? "3000"),
  databaseUrl: process.env.DATABASE_URL!,
  kafka: {
    brokers: process.env.KAFKA_BROKERS!.split(",").map((item) => item.trim()),
    clientId: process.env.KAFKA_CLIENT_ID!,
    groupId: process.env.KAFKA_GROUP_ID!,
    topic: process.env.KAFKA_TOPIC!,
    dlqTopic: process.env.KAFKA_DLQ_TOPIC!,
  },
  jwt: {
    secret: process.env.JWT_SECRET!,
    issuer: process.env.JWT_ISSUER!,
    audience: process.env.JWT_AUDIENCE!,
  },
});
