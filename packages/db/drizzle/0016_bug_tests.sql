ALTER TABLE "tests" ADD COLUMN "bug_id" text;--> statement-breakpoint
-- Tests written from a bug before the link existed carry the bug's name.
UPDATE "tests" t SET "bug_id" = b->>'id'
FROM "explorations" e, jsonb_array_elements(e."state"->'bugs') b
WHERE e."app_id" = t."app_id" AND b->>'status' = 'confirmed' AND lower(b->>'name') = lower(t."name") AND t."base_id" IS NULL;--> statement-breakpoint
-- A bug is now open, fixed or dismissed. Accepted was an open bug with a test; the rest were ways of setting one aside.
UPDATE "explorations" SET "triage" = (
  SELECT jsonb_object_agg(key, CASE WHEN value = 'accepted' THEN 'open' WHEN value IN ('duplicate', 'cant-reproduce', 'works-as-intended') THEN 'dismissed' ELSE value END)
  FROM jsonb_each_text("triage")
) WHERE "triage" <> '{}'::jsonb;
