import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { type Env } from "../../config/env.schema.js";

/**
 * Guards the Bright Data delivery endpoint with the shared secret.
 *
 * Compared with timingSafeEqual rather than ===, and length is checked first
 * because timingSafeEqual throws on a length mismatch. A plain string compare
 * leaks the secret's prefix over enough requests, and this endpoint is public.
 */
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get("BRIGHTDATA_WEBHOOK_SECRET", { infer: true });
    if (!expected) {
      throw new UnauthorizedException("Webhook delivery is not configured.");
    }

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers["x-webhook-secret"];
    const provided = typeof header === "string" ? header : "";

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException("Invalid webhook secret.");
    }
    return true;
  }
}
