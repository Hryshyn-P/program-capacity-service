import {
  ArgumentsHost,
  Catch,
  HttpException,
  Logger,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import { DomainError } from "./domain-error";
import type { RequestWithId } from "./request-id.middleware";

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<Response>();
    const normalized = normalizeApiError(error);

    if (normalized.status >= 500) {
      this.logger.error({ requestId: request.requestId, error });
    }
    response.status(normalized.status).json({
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
      requestId: request.requestId,
    });
  }
}

export function normalizeApiError(error: unknown): {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
} {
  if (error instanceof DomainError) return error;
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const payload = error.getResponse();
    if (status === 401) {
      return {
        status,
        code: "UNAUTHORIZED",
        message: "Authentication is required",
        details: {},
      };
    }
    if (status === 403) {
      return {
        status,
        code: "FORBIDDEN",
        message: "Required scope is missing",
        details: {},
      };
    }
    if (status === 400) {
      const messages =
        typeof payload === "object" && payload !== null && "message" in payload
          ? payload.message
          : error.message;
      return {
        status,
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: { errors: messages },
      };
    }
    const expected = httpErrorByStatus[status];
    if (expected) {
      return {
        status,
        code: expected.code,
        message: expected.message,
        details: {},
      };
    }
    return {
      status,
      code: status >= 500 ? "INTERNAL_ERROR" : "HTTP_ERROR",
      message:
        status >= 500 ? "An unexpected error occurred" : "Request failed",
      details: {},
    };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred",
    details: {},
  };
}

const httpErrorByStatus: Record<number, { code: string; message: string }> = {
  404: { code: "ROUTE_NOT_FOUND", message: "Route was not found" },
  405: { code: "METHOD_NOT_ALLOWED", message: "Method is not allowed" },
  413: { code: "PAYLOAD_TOO_LARGE", message: "Request payload is too large" },
  429: { code: "TOO_MANY_REQUESTS", message: "Too many requests" },
  503: {
    code: "SERVICE_UNAVAILABLE",
    message: "Service is temporarily unavailable",
  },
};
