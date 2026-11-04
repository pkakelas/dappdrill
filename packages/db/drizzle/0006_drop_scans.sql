ALTER TABLE "api_tokens" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "flow_changes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "flows" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "issues" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repairs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "run_batches" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scan_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scans" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "signing_reviews" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "variations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "api_tokens" CASCADE;--> statement-breakpoint
DROP TABLE "flow_changes" CASCADE;--> statement-breakpoint
DROP TABLE "flows" CASCADE;--> statement-breakpoint
DROP TABLE "issues" CASCADE;--> statement-breakpoint
DROP TABLE "repairs" CASCADE;--> statement-breakpoint
DROP TABLE "run_batches" CASCADE;--> statement-breakpoint
DROP TABLE "runs" CASCADE;--> statement-breakpoint
DROP TABLE "scan_events" CASCADE;--> statement-breakpoint
DROP TABLE "scans" CASCADE;--> statement-breakpoint
DROP TABLE "signing_reviews" CASCADE;--> statement-breakpoint
DROP TABLE "variations" CASCADE;--> statement-breakpoint
ALTER TABLE "apps" DROP CONSTRAINT "apps_share_token_unique";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "share_token";