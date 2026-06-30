CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(64) NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_username_unique" ON "admin_users" USING btree (lower("username"));
--> statement-breakpoint
-- Default admin: username=admin, password=AgentLight@Admin2026
INSERT INTO "admin_users" ("username", "password_hash", "display_name")
VALUES (
	'admin',
	'scrypt$ss8KZjFJ-ybnamV8oRShxA$f2UhW2OphYnRQgse7o6Fpxq2M4qazvCpaE4BFJ7oG4N8VWwFRGCdZJCRPUlMndlcEq_XX1EeT2ozO9ZtCZAbAg',
	'Administrator'
);
