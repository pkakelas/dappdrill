CREATE TABLE "agent_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"user_id" text,
	"role" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'done' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"live_frame" text,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blocked" jsonb,
	"stalled" jsonb,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"error" text,
	"stop_requested" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flows" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"test_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"live_frame" text,
	"stop_requested" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"flow_id" text NOT NULL,
	"name" text NOT NULL,
	"goal" text NOT NULL,
	"expected" text NOT NULL,
	"start_path" text DEFAULT '/' NOT NULL,
	"steps" jsonb NOT NULL,
	"condition" text,
	"base_id" text,
	"forked_from" text,
	"proof" text,
	"drafting" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "map" jsonb;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "chains" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_base_id_tests_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_messages_app_idx" ON "agent_messages" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE INDEX "analyses_app_idx" ON "analyses" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE INDEX "flows_app_idx" ON "flows" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "test_runs_test_idx" ON "test_runs" USING btree ("test_id","created_at");--> statement-breakpoint
CREATE INDEX "test_runs_batch_idx" ON "test_runs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "tests_flow_idx" ON "tests" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "tests_app_idx" ON "tests" USING btree ("app_id");