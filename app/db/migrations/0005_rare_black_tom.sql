ALTER TABLE "matches" ADD COLUMN "external_fixture_id" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "opponent_logo" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "competition_logo" text;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_external_fixture_id_unique" UNIQUE("external_fixture_id");