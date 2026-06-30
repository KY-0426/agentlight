CREATE TABLE "activation_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"status" "invite_code_status" DEFAULT 'active' NOT NULL,
	"label" varchar(200),
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"activated_installation_id" varchar(128),
	"activated_platform" "desktop_platform",
	"activated_app_version" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "activation_codes_code_hash_unique" ON "activation_codes" USING btree ("code_hash");
--> statement-breakpoint
CREATE INDEX "activation_codes_status_idx" ON "activation_codes" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "activation_codes_installation_idx" ON "activation_codes" USING btree ("activated_installation_id");
