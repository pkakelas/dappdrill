-- Flag issues that only a model check found (Issue.byModel), as the engine now does:
-- the recovery judge's findings, and signing issues whose only failing or warning check is the
-- button comparison made by the model. Replays run without the model, so they can't close these.
UPDATE issues SET data = data || '{"byModel": true}'::jsonb
WHERE category = 'ui' AND title LIKE 'The page doesn''t explain what happened after %';
--> statement-breakpoint
UPDATE issues SET data = issues.data || '{"byModel": true}'::jsonb
FROM signing_reviews s
WHERE issues.category = 'signing'
  AND s.app_id = issues.app_id
  AND (s.id = issues.data->'evidence'->>'signingReviewId' OR s.data->>'id' = issues.data->'evidence'->>'signingReviewId')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.data->'checks') c WHERE c->>'status' IN ('fail', 'warn'))
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(s.data->'checks') c
    WHERE c->>'status' IN ('fail', 'warn') AND NOT (c->>'id' = 'ui-match' AND c->'evidence'->>'via' = 'model')
  );
--> statement-breakpoint
-- Close issues that a later run already showed fixed, before the worker started doing this itself.
-- Same rule as closeFixedIssues: the latest later run of the same flow and edge case (no variation)
-- passed, or filed issues (and says which) but nothing with the issue's fingerprint; a replay
-- (a run in a batch) can't vouch for a model-only issue.
WITH latest AS (
  SELECT DISTINCT ON (i.id) i.id AS issue_id, r.id AS run_id, r.batch_id, r.created_at, r.status, r.result
  FROM issues i
  JOIN runs r ON r.flow_id = i.flow_id
    AND r.edge_case = i.data->>'edgeCase'
    AND r.created_at > i.created_at
    AND r.id IS DISTINCT FROM i.run_id
    AND r.result->>'variationId' IS NULL
  WHERE i.status = 'open'
  ORDER BY i.id, r.created_at DESC
)
UPDATE issues SET status = 'fixed', fixed_by_run_id = latest.run_id, fixed_at = latest.created_at
FROM latest
WHERE issues.id = latest.issue_id
  AND (latest.status = 'pass' OR (latest.status = 'issue' AND jsonb_array_length(latest.result->'issueIds') > 0))
  AND NOT (latest.batch_id IS NOT NULL AND coalesce((issues.data->>'byModel')::boolean, false))
  AND NOT EXISTS (
    SELECT 1 FROM issues j
    WHERE j.app_id = issues.app_id
      AND j.fingerprint = issues.fingerprint
      AND (j.run_id = latest.run_id OR latest.result->'issueIds' ? j.id)
  );
