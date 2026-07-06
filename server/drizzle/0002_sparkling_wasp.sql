ALTER TABLE "profiles" ADD COLUMN "xp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "profiles_trophies_idx" ON "profiles" USING btree ("trophies");--> statement-breakpoint
CREATE INDEX "profiles_wins_idx" ON "profiles" USING btree ("wins");--> statement-breakpoint
CREATE INDEX "profiles_xp_idx" ON "profiles" USING btree ("xp");