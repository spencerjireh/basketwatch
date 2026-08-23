/**
 * The single list of queue names in the repo.
 *
 * Each domain module registers its own worker against one of these, so adding
 * a queue is one line here plus one handler beside the code that owns it.
 */
export const QUEUES = {
  /** scheduled catalogue pulls; owned by modules/pullers */
  fleetPull: "fleet-pull",
  /** per-store fan-out from a fleet pull */
  scrapeRun: "scrape-run",
  /** spider-sense validation of a delivered run */
  validateRun: "validate-run",
  /** enqueued when an incident opens; owned by modules/heal */
  heal: "heal",
  /** self-rescheduling watcher of an in-flight Bright Data heal */
  healPoll: "heal-poll",
  /** outbound alerts; owned by modules/notifier */
  notify: "notify",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const ALL_QUEUES: QueueName[] = Object.values(QUEUES);
