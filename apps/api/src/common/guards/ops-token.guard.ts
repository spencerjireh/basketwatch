import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { type Env } from "../../config/env.schema.js";

/**
 * Guards the endpoints that cost money or change the fleet: manual runs, heal
 * triggers. Reads are public because the dashboard is public and has no auth.
 */
@Injectable()
export class OpsTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get("OPS_TOKEN", { infer: true });
    if (!expected) {
      throw new UnauthorizedException("Ops actions are not configured.");
    }

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException("Invalid ops token.");
    }
    return true;
  }
}
