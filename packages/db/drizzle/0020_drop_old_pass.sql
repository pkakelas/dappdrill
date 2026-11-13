-- Tests and results written by the old pass are in a shape the new runner can't read.
DELETE FROM "test_runs";--> statement-breakpoint
DELETE FROM "tests";--> statement-breakpoint
ALTER TABLE "agent_messages" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "explorations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "agent_messages" CASCADE;--> statement-breakpoint
DROP TABLE "explorations" CASCADE;--> statement-breakpoint
ALTER TABLE "tests" DROP CONSTRAINT "tests_base_id_tests_id_fk";
--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "map";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "setup";--> statement-breakpoint
ALTER TABLE "tests" DROP COLUMN "expected";--> statement-breakpoint
ALTER TABLE "tests" DROP COLUMN "after";--> statement-breakpoint
ALTER TABLE "tests" DROP COLUMN "condition";--> statement-breakpoint
ALTER TABLE "tests" DROP COLUMN "base_id";--> statement-breakpoint
ALTER TABLE "tests" DROP COLUMN "forked_from";--> statement-breakpoint
ALTER TABLE "tests" DROP COLUMN "bug_id";--> statement-breakpoint
ALTER TABLE "tests" DROP COLUMN "proof";--> statement-breakpoint
ALTER TABLE "tests" DROP COLUMN "drafting";--> statement-breakpoint
ALTER TABLE "tests" DROP COLUMN "draft_note";