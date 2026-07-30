export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "ROUTE_NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "PAYLOAD_TOO_LARGE"
  | "TOO_MANY_REQUESTS"
  | "SERVICE_UNAVAILABLE"
  | "HTTP_ERROR"
  | "PROGRAM_NOT_FOUND"
  | "RESERVATION_NOT_FOUND"
  | "RESERVATION_CONFLICT"
  | "INSUFFICIENT_CAPACITY"
  | "DATA_INVARIANT_VIOLATION"
  | "INVALID_TREASURY_EVENT"
  | "INTERNAL_ERROR";

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DomainError";
  }
}
