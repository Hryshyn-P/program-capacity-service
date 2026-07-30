import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DomainError } from "./domain-error";
import { normalizeApiError } from "./api-error.filter";

describe("normalizeApiError", () => {
  it("preserves expected domain errors", () => {
    const normalized = normalizeApiError(
      new DomainError("INSUFFICIENT_CAPACITY", "No capacity", 409, {
        availableAmount: "0.000000",
      }),
    );
    expect(normalized).toMatchObject({
      status: 409,
      code: "INSUFFICIENT_CAPACITY",
    });
  });

  it("maps framework authorization and validation errors", () => {
    expect(normalizeApiError(new ForbiddenException()).code).toBe("FORBIDDEN");
    expect(normalizeApiError(new BadRequestException(["bad"])).code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("preserves framework status without leaking internal messages", () => {
    expect(normalizeApiError(new NotFoundException())).toEqual({
      status: 404,
      code: "ROUTE_NOT_FOUND",
      message: "Route was not found",
      details: {},
    });
    expect(
      normalizeApiError(
        new ServiceUnavailableException("database password leaked"),
      ),
    ).toEqual({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "Service is temporarily unavailable",
      details: {},
    });
    expect(normalizeApiError(new HttpException("teapot", 418))).toEqual({
      status: 418,
      code: "HTTP_ERROR",
      message: "Request failed",
      details: {},
    });
  });

  it("hides unknown errors", () => {
    expect(normalizeApiError(new Error("database password leaked"))).toEqual({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      details: {},
    });
  });
});
