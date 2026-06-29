CREATE TYPE "public"."agent_provider" AS ENUM('codex', 'claude_code');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_number" varchar(16);--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_number_unique" ON "users" USING btree ("phone_number") WHERE "phone_number" is not null;--> statement-breakpoint
ALTER TABLE "codex_threads" ADD COLUMN "agent_provider" "agent_provider" DEFAULT 'codex' NOT NULL;--> statement-breakpoint
DROP INDEX "codex_threads_idempotency_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "codex_threads_idempotency_unique" ON "codex_threads" USING btree ("workspace_id","user_id","device_id","agent_provider","codex_thread_id");--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "agent_provider" "agent_provider" DEFAULT 'codex' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_usage_rollups" ADD COLUMN "agent_provider" "agent_provider" DEFAULT 'codex' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_usage_rollups" DROP CONSTRAINT "daily_usage_rollups_workspace_id_user_id_usage_date_pk";--> statement-breakpoint
ALTER TABLE "daily_usage_rollups" ADD CONSTRAINT "daily_usage_rollups_workspace_id_user_id_usage_date_agent_provider_pk" PRIMARY KEY("workspace_id","user_id","usage_date","agent_provider");--> statement-breakpoint
DROP INDEX "daily_usage_rollups_leaderboard_idx";--> statement-breakpoint
CREATE INDEX "daily_usage_rollups_leaderboard_idx" ON "daily_usage_rollups" USING btree ("workspace_id","agent_provider","usage_date");--> statement-breakpoint
CREATE TABLE "phone_verification_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_number" varchar(16) NOT NULL,
	"code_hash" text NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "phone_verification_codes_phone_purpose_idx" ON "phone_verification_codes" USING btree ("phone_number","purpose");
