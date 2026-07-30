import { createHash } from "node:crypto";
import { fx, money } from "../common/decimal";

export interface FingerprintInput {
  invoiceId: string;
  invoiceAmount: string;
  invoiceCurrency: string;
  fxRate: string;
}

export function reservationFingerprint(input: FingerprintInput): string {
  const canonical = JSON.stringify({
    invoiceId: input.invoiceId,
    invoiceAmount: money(input.invoiceAmount),
    invoiceCurrency: input.invoiceCurrency,
    fxRate: fx(input.fxRate),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
