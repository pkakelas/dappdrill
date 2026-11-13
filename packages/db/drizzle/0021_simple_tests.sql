CREATE TABLE "makes" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"goal" text,
	"count" integer DEFAULT 10 NOT NULL,
	"state" jsonb DEFAULT '{"stage":"looking","goals":[]}'::jsonb NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"error" text,
	"stop_requested" boolean DEFAULT false NOT NULL,
	"requested_by" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "suite" jsonb DEFAULT '{"notes":[],"signing":"allowed"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "values" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "cleanup" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "faults" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "makes" ADD CONSTRAINT "makes_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makes" ADD CONSTRAINT "makes_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "makes_app_idx" ON "makes" USING btree ("app_id","created_at");--> statement-breakpoint
-- Every app starts as a user whose wallet is connected, and what its owner told the old pass is kept as a note.
UPDATE "apps" SET "suite" = jsonb_build_object(
  'setup', '{"startPath":"/","steps":[{"type":"action","by":"llm","do":"Connect the wallet to the app (it is listed as MetaMask) and close any first-visit prompt in the way. If the app shows the wallet as connected already, do nothing."}]}'::jsonb,
  'notes', CASE WHEN coalesce("settings"->>'hints', '') <> '' THEN jsonb_build_array(jsonb_build_object('text', "settings"->>'hints', 'from', 'owner')) ELSE '[]'::jsonb END,
  'signing', 'allowed'
);--> statement-breakpoint
UPDATE "apps" SET "settings" = "settings" - 'hints';
