import Decimal from "decimal.js";
import { DomainError } from "./domain-error";

Decimal.set({ precision: 50, rounding: Decimal.ROUND_HALF_EVEN });

export const MONEY_SCALE = 6;
export const FX_SCALE = 12;
export const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
export const MONEY_PATTERN = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/;
export const FX_RATE_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,12})?$/;
const NUMERIC_PRECISION = 24;

export function parseDecimal(value: string, field: string): Decimal {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `${field} must be a non-negative decimal string`,
      400,
      {
        field,
      },
    );
  }
  try {
    return new Decimal(value);
  } catch {
    throw new DomainError(
      "VALIDATION_ERROR",
      `${field} must be a valid decimal string`,
      400,
      {
        field,
      },
    );
  }
}

export function positiveDecimal(value: string, field: string): Decimal {
  const decimal = parseDecimal(value, field);
  if (!decimal.isPositive()) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `${field} must be greater than zero`,
      400,
      { field },
    );
  }
  return decimal;
}

function fixedNumeric(
  value: Decimal.Value,
  scale: number,
  field: string,
): string {
  let rounded: Decimal;
  try {
    rounded = new Decimal(value).toDecimalPlaces(
      scale,
      Decimal.ROUND_HALF_EVEN,
    );
  } catch {
    throw new DomainError(
      "VALIDATION_ERROR",
      `${field} must be a valid decimal`,
      400,
      { field },
    );
  }
  const exclusiveLimit = new Decimal(10).pow(NUMERIC_PRECISION - scale);
  if (rounded.abs().gte(exclusiveLimit)) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `${field} exceeds supported precision`,
      400,
      { field },
    );
  }
  return rounded.toFixed(scale);
}

export const money = (value: Decimal.Value, field = "amount"): string =>
  fixedNumeric(value, MONEY_SCALE, field);

export const fx = (value: Decimal.Value, field = "fxRate"): string =>
  fixedNumeric(value, FX_SCALE, field);

export function calculateReservedAmount(
  invoiceAmount: string,
  fxRate: string,
): string {
  return money(
    positiveDecimal(invoiceAmount, "invoiceAmount").mul(
      positiveDecimal(fxRate, "fxRate"),
    ),
    "reservedAmount",
  );
}
