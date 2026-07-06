CREATE TYPE "public"."self_outcome" AS ENUM('win', 'loss', 'draw');--> statement-breakpoint
ALTER TABLE "match_reports" DROP COLUMN "outcome";--> statement-breakpoint
ALTER TABLE "match_reports" ADD COLUMN "outcome" self_outcome NOT NULL;