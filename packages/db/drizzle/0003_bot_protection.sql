ALTER TABLE "apps" ADD COLUMN "access_headers_enc" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "access_header_names" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "blocked" jsonb;