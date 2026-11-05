ALTER TABLE "invites" RENAME TO "invitation";--> statement-breakpoint
ALTER TABLE "team_members" RENAME TO "member";--> statement-breakpoint
ALTER TABLE "teams" RENAME TO "organization";--> statement-breakpoint
ALTER TABLE "invitation" RENAME CONSTRAINT "invites_pkey" TO "invitation_pkey";--> statement-breakpoint
ALTER TABLE "organization" RENAME CONSTRAINT "teams_pkey" TO "organization_pkey";--> statement-breakpoint
ALTER TABLE "apps" RENAME COLUMN "team_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "domains" RENAME COLUMN "team_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "integrations" RENAME COLUMN "team_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "invitation" RENAME COLUMN "team_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "invitation" RENAME COLUMN "invited_by" TO "inviter_id";--> statement-breakpoint
ALTER TABLE "member" RENAME COLUMN "team_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "test_wallets" RENAME COLUMN "team_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "invitation" DROP CONSTRAINT "invites_token_unique";--> statement-breakpoint
ALTER TABLE "apps" DROP CONSTRAINT "apps_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "domains" DROP CONSTRAINT "domains_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "integrations" DROP CONSTRAINT "integrations_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "invitation" DROP CONSTRAINT "invites_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "invitation" DROP CONSTRAINT "invites_invited_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "member" DROP CONSTRAINT "team_members_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "member" DROP CONSTRAINT "team_members_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "test_wallets" DROP CONSTRAINT "test_wallets_team_id_teams_id_fk";
--> statement-breakpoint
DROP INDEX "apps_team_idx";--> statement-breakpoint
DROP INDEX "domains_team_host";--> statement-breakpoint
DROP INDEX "integrations_team_kind";--> statement-breakpoint
DROP INDEX "team_members_pk";--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
-- Existing invites: the link token becomes the id (old links keep working), open ones get a week.
DELETE FROM "invitation" WHERE "inviter_id" IS NULL;--> statement-breakpoint
UPDATE "invitation" SET "id" = "token", "status" = CASE WHEN "accepted_at" IS NULL THEN 'pending' ELSE 'accepted' END, "expires_at" = now() + interval '7 days';--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "inviter_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "id" text;--> statement-breakpoint
UPDATE "member" SET "id" = 'mem_' || substr(md5("organization_id" || ':' || "user_id"), 1, 20);--> statement-breakpoint
ALTER TABLE "member" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "organization" SET "slug" = concat_ws('-', nullif(trim(both '-' from lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'))), ''), substr(md5("id"), 1, 6));--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "metadata" text;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_wallets" ADD CONSTRAINT "test_wallets_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apps_org_idx" ON "apps" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_org_host" ON "domains" USING btree ("organization_id","host");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_kind" ON "integrations" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE INDEX "invitation_org_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_org_user" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "member_user_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "invitation" DROP COLUMN "token";--> statement-breakpoint
ALTER TABLE "invitation" DROP COLUMN "accepted_at";--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_slug_unique" UNIQUE("slug");