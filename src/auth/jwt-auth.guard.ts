import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { AuthenticatedPrincipal } from "./auth.types";

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedPrincipal;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<AuthenticatedPrincipal>(
        token,
        {
          secret: this.config.getOrThrow<string>("jwt.secret"),
          issuer: this.config.getOrThrow<string>("jwt.issuer"),
          audience: this.config.getOrThrow<string>("jwt.audience"),
          algorithms: ["HS256"],
        },
      );
      if (!payload.sub || !Array.isArray(payload.scope))
        throw new UnauthorizedException();
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
