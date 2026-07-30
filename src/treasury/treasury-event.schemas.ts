import { z } from "zod";
import { FX_RATE_PATTERN, MONEY_PATTERN } from "../common/decimal";

const moneyString = z.string().regex(MONEY_PATTERN);
const fxRateString = z.string().regex(FX_RATE_PATTERN);
const postgresBigint = z
  .string()
  .regex(/^\d+$/)
  .refine(
    (value) => {
      try {
        return BigInt(value) <= 9_223_372_036_854_775_807n;
      } catch {
        return false;
      }
    },
    { message: "Value exceeds PostgreSQL bigint range" },
  );
const currency = z.string().regex(/^[A-Z]{3}$/);
const base = {
  eventId: z.uuid(),
  programId: z.string().min(1).max(128),
  version: postgresBigint,
  occurredAt: z.iso.datetime({ offset: true }),
};

const snapshotReservation = z.object({
  invoiceId: z.string().min(1).max(256),
  invoiceAmount: moneyString,
  invoiceCurrency: currency,
  fxRate: fxRateString,
  reservedAmount: moneyString,
  status: z.enum(["ACTIVE", "RELEASED"]),
});

export const treasuryEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("PROGRAM_CAPACITY_UPDATED"),
    state: z.object({ currency, totalLimit: moneyString }),
  }),
  z.object({
    ...base,
    type: z.literal("PROGRAM_RECONCILED"),
    state: z.object({
      currency,
      totalLimit: moneyString,
      declaredReservedAmount: moneyString.optional(),
      reservations: z.array(snapshotReservation),
    }),
  }),
]);

export type TreasuryEvent = z.infer<typeof treasuryEventSchema>;
export type ReconciliationEvent = Extract<
  TreasuryEvent,
  { type: "PROGRAM_RECONCILED" }
>;
