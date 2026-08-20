ALTER TABLE "heal_attempts" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "heal_attempts" ADD COLUMN "started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "heal_attempts" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "heal_attempts" ADD COLUMN "canary" jsonb;