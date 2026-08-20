import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type FeedEvent } from "@basketwatch/contract";
import { type Env } from "../../../config/env.schema.js";
import { type NotificationChannel } from "./channel.types.js";

@Injectable()
export class TelegramChannel implements NotificationChannel {
  readonly name = "telegram" as const;

  constructor(private readonly config: ConfigService<Env, true>) {}

  isConfigured(): boolean {
    return (
      Boolean(this.config.get("TELEGRAM_BOT_TOKEN", { infer: true })) &&
      Boolean(this.config.get("TELEGRAM_CHAT_ID", { infer: true }))
    );
  }

  async send(_event: FeedEvent): Promise<void> {
    throw new Error("not implemented");
  }
}
