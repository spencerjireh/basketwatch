import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type FeedEvent } from "@basketwatch/contract";
import { type Env } from "../../../config/env.schema.js";
import { type NotificationChannel } from "./channel.types.js";

@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly name = "email" as const;

  constructor(private readonly config: ConfigService<Env, true>) {}

  isConfigured(): boolean {
    return Boolean(this.config.get("RESEND_API_KEY", { infer: true }));
  }

  async send(_event: FeedEvent): Promise<void> {
    throw new Error("not implemented");
  }
}
