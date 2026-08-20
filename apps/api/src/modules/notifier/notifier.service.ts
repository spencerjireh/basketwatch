import { Injectable, Logger } from "@nestjs/common";
import { type FeedEvent } from "@basketwatch/contract";
import { EmailChannel } from "./channels/email.channel.js";
import { type NotificationChannel } from "./channels/channel.types.js";
import { TelegramChannel } from "./channels/telegram.channel.js";

/**
 * Fans an event out to every configured channel.
 *
 * An unconfigured channel is skipped rather than failing, so dropping to one
 * channel under time pressure is an env change and not a code change.
 */
@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);
  private readonly channels: NotificationChannel[];

  constructor(telegram: TelegramChannel, email: EmailChannel) {
    this.channels = [telegram, email];
  }

  async notify(event: FeedEvent): Promise<void> {
    const active = this.channels.filter((channel) => channel.isConfigured());
    if (active.length === 0) {
      this.logger.warn(`no notification channel configured; dropping ${event.kind}`);
      return;
    }
    await Promise.allSettled(active.map((channel) => channel.send(event)));
  }
}
