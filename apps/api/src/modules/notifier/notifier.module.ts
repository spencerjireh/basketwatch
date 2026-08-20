import { Module } from "@nestjs/common";
import { EmailChannel } from "./channels/email.channel.js";
import { NotifierService } from "./notifier.service.js";
import { TelegramChannel } from "./channels/telegram.channel.js";

/** Future home of the alerting layer. */
@Module({
  providers: [NotifierService, TelegramChannel, EmailChannel],
  exports: [NotifierService],
})
export class NotifierModule {}
