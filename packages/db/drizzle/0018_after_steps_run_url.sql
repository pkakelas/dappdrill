ALTER TABLE "test_runs" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "after" jsonb;