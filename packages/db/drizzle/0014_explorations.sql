CREATE TABLE "explorations" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"budget_minutes" integer DEFAULT 15 NOT NULL,
	"state" jsonb,
	"triage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"blocked" jsonb,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"error" text,
	"stop_requested" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "draft_note" text;--> statement-breakpoint
ALTER TABLE "explorations" ADD CONSTRAINT "explorations_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "explorations_app_idx" ON "explorations" USING btree ("app_id","created_at");