import { type FeedEvent } from "@basketwatch/contract";

/**
 * One interface, one file per channel. Adding Slack is a new file plus a line
 * in the notifier's registry -- which is what keeps the cut order cheap: the
 * PRD drops to one channel under time pressure without touching call sites.
 */
export interface NotificationChannel {
  readonly name: "email" | "telegram" | "discord";
  isConfigured(): boolean;
  send(event: FeedEvent): Promise<void>;
}
