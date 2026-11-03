ALTER TABLE "issues" ADD COLUMN "fixed_by_run_id" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "fixed_at" timestamp with time zone;