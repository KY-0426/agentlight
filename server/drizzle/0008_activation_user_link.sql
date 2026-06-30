ALTER TABLE "activation_codes" ADD COLUMN "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "activation_codes" ADD CONSTRAINT "activation_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "activation_codes_user_idx" ON "activation_codes" USING btree ("user_id");
