CREATE TABLE "signing_alerts" (
	"app_id" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signing_alerts_app_id_key_pk" PRIMARY KEY("app_id","key")
);
--> statement-breakpoint
ALTER TABLE "signing_alerts" ADD CONSTRAINT "signing_alerts_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;