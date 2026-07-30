import { SetMetadata } from "@nestjs/common";

export const REQUIRED_SCOPES = "requiredScopes";
export const Scopes = (...scopes: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_SCOPES, scopes);
