ALTER TABLE "flow_changes" ADD COLUMN "scan_id" text;--> statement-breakpoint
ALTER TABLE "flow_changes" ADD COLUMN "plan_item" text;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "flow_changes" ADD CONSTRAINT "flow_changes_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;