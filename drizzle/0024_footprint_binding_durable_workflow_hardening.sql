CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM durable_workflow_heads
    WHERE btrim(tenant_id) = '' OR btrim(project_id) = '' OR btrim(branch_id) = '' OR btrim(aggregate_type) = '' OR btrim(aggregate_key) = ''
  ) OR EXISTS (
    SELECT 1 FROM durable_workflow_records
    WHERE btrim(tenant_id) = '' OR btrim(project_id) = '' OR btrim(branch_id) = '' OR btrim(aggregate_type) = '' OR btrim(aggregate_key) = ''
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'DW0024_MALFORMED_AGGREGATE_SCOPE'; END IF;

  IF EXISTS (
    SELECT 1 FROM durable_workflow_heads h LEFT JOIN durable_workflow_records r ON r.record_id = h.record_id
    WHERE r.record_id IS NULL OR (h.head_id, h.tenant_id, h.project_id, h.branch_id, h.aggregate_type, h.aggregate_key, h.revision, h.record_digest)
      IS DISTINCT FROM (r.head_id, r.tenant_id, r.project_id, r.branch_id, r.aggregate_type, r.aggregate_key, r.revision, r.record_digest)
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'DW0024_HEAD_CURRENT_RECORD_INCONSISTENT'; END IF;

  IF EXISTS (
    SELECT 1 FROM durable_workflow_records r LEFT JOIN durable_workflow_heads h ON h.head_id = r.head_id
    WHERE h.head_id IS NULL OR (h.tenant_id, h.project_id, h.branch_id, h.aggregate_type, h.aggregate_key)
      IS DISTINCT FROM (r.tenant_id, r.project_id, r.branch_id, r.aggregate_type, r.aggregate_key) OR r.revision > h.revision
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'DW0024_HISTORY_OWNER_INCONSISTENT'; END IF;

  IF EXISTS (SELECT 1 FROM durable_workflow_heads GROUP BY tenant_id, project_id, branch_id, aggregate_type, aggregate_key HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM durable_workflow_records GROUP BY tenant_id, project_id, branch_id, aggregate_type, aggregate_key, revision HAVING count(*) > 1)
  THEN RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'DW0024_SCOPED_AGGREGATE_AMBIGUOUS'; END IF;

  IF EXISTS (SELECT 1 FROM durable_workflow_replays WHERE COALESCE(jsonb_typeof(result->'records'), '') <> 'array')
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'DW0024_REPLAY_RECORDS_INVALID'; END IF;
  IF EXISTS (SELECT 1 FROM durable_workflow_replays WHERE jsonb_array_length(result->'records') = 0)
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'DW0024_REPLAY_OWNER_MISSING'; END IF;
  IF EXISTS (
    SELECT 1 FROM durable_workflow_replays rp CROSS JOIN LATERAL jsonb_array_elements(rp.result->'records') rr
    WHERE COALESCE(btrim(rr->'scope'->>'tenantId'), '') = '' OR COALESCE(btrim(rr->'scope'->>'projectId'), '') = '' OR COALESCE(btrim(rr->'scope'->>'branchId'), '') = ''
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'DW0024_REPLAY_SCOPE_MALFORMED'; END IF;
  IF EXISTS (
    SELECT 1 FROM durable_workflow_replays rp CROSS JOIN LATERAL jsonb_array_elements(rp.result->'records') rr
    LEFT JOIN durable_workflow_records r ON r.record_id = rr->>'recordId'
    WHERE r.record_id IS NULL OR (r.tenant_id, r.project_id, r.branch_id, r.aggregate_type, r.aggregate_key, r.revision)
      IS DISTINCT FROM (rr->'scope'->>'tenantId', rr->'scope'->>'projectId', rr->'scope'->>'branchId', rr->>'aggregateType', rr->>'aggregateKey', (rr->>'revision')::integer)
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'DW0024_REPLAY_RECORD_REFERENCE_INVALID'; END IF;
  IF EXISTS (
    SELECT replay_id FROM durable_workflow_replays rp CROSS JOIN LATERAL jsonb_array_elements(rp.result->'records') rr
    GROUP BY replay_id HAVING count(DISTINCT (rr->'scope'->>'tenantId', rr->'scope'->>'projectId', rr->'scope'->>'branchId')) <> 1
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'DW0024_REPLAY_CROSS_SCOPE'; END IF;

  IF EXISTS (SELECT 1 FROM durable_workflow_replays WHERE COALESCE(jsonb_typeof(result->'outbox'), '') <> 'array')
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'DW0024_REPLAY_OUTBOX_INVALID'; END IF;
  IF EXISTS (
    SELECT 1 FROM durable_workflow_outbox WHERE topic NOT IN ('pcb-sync.snapshot-published','pcb-sync.applied','pcb-sync.plan-staled','mapping.stage1-project','mapping.invalidate','passive-policy.invalidate')
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'DW0024_OUTBOX_EVENT_SEMANTICS_UNSUPPORTED'; END IF;
  IF EXISTS (
    WITH bindings AS (
      SELECT o.event_id, count(DISTINCT rr->>'recordId') AS owners
      FROM durable_workflow_outbox o JOIN durable_workflow_replays rp ON rp.scope_key = o.scope_key
      CROSS JOIN LATERAL jsonb_array_elements(rp.result->'outbox') oe
      CROSS JOIN LATERAL jsonb_array_elements(rp.result->'records') rr
      WHERE oe->>'eventId' = o.event_id
        AND oe->>'scopeKey' = o.scope_key AND oe->>'topic' = o.topic
        AND oe->>'idempotencyKey' = o.idempotency_key AND oe->>'payloadDigest' = o.payload_digest
      GROUP BY o.event_id
    ) SELECT 1 FROM durable_workflow_outbox o LEFT JOIN bindings b ON b.event_id = o.event_id WHERE b.event_id IS NULL OR b.owners <> 1
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'DW0024_OUTBOX_OWNER_AMBIGUOUS'; END IF;
END $$;
--> statement-breakpoint

ALTER TABLE durable_workflow_replays ADD COLUMN tenant_id text;
ALTER TABLE durable_workflow_replays ADD COLUMN project_id text;
ALTER TABLE durable_workflow_replays ADD COLUMN branch_id text;
--> statement-breakpoint
WITH replay_scopes AS (
  SELECT replay_id, min(rr->'scope'->>'tenantId') AS tenant_id, min(rr->'scope'->>'projectId') AS project_id, min(rr->'scope'->>'branchId') AS branch_id
  FROM durable_workflow_replays rp CROSS JOIN LATERAL jsonb_array_elements(rp.result->'records') rr GROUP BY replay_id
)
UPDATE durable_workflow_replays rp SET tenant_id = s.tenant_id, project_id = s.project_id, branch_id = s.branch_id FROM replay_scopes s WHERE s.replay_id = rp.replay_id;
ALTER TABLE durable_workflow_replays ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE durable_workflow_replays ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE durable_workflow_replays ALTER COLUMN branch_id SET NOT NULL;
--> statement-breakpoint

ALTER TABLE durable_workflow_outbox ADD COLUMN tenant_id text;
ALTER TABLE durable_workflow_outbox ADD COLUMN project_id text;
ALTER TABLE durable_workflow_outbox ADD COLUMN branch_id text;
ALTER TABLE durable_workflow_outbox ADD COLUMN owner_aggregate_type text;
ALTER TABLE durable_workflow_outbox ADD COLUMN owner_aggregate_key text;
ALTER TABLE durable_workflow_outbox ADD COLUMN owner_aggregate_revision integer;
ALTER TABLE durable_workflow_outbox ADD COLUMN event_type text;
ALTER TABLE durable_workflow_outbox ADD COLUMN event_version integer;
ALTER TABLE durable_workflow_outbox ADD COLUMN event_digest text;
ALTER TABLE durable_workflow_outbox ADD COLUMN lease_token text;
ALTER TABLE durable_workflow_outbox ADD COLUMN terminal_at timestamp with time zone;
--> statement-breakpoint
WITH event_owners AS (
  SELECT DISTINCT ON (o.event_id) o.event_id, r.tenant_id, r.project_id, r.branch_id, r.aggregate_type, r.aggregate_key, r.revision
  FROM durable_workflow_outbox o JOIN durable_workflow_replays rp ON rp.scope_key = o.scope_key
  CROSS JOIN LATERAL jsonb_array_elements(rp.result->'outbox') oe
  CROSS JOIN LATERAL jsonb_array_elements(rp.result->'records') rr
  JOIN durable_workflow_records r ON r.record_id = rr->>'recordId'
  WHERE oe->>'eventId' = o.event_id
  ORDER BY o.event_id, r.record_id
)
UPDATE durable_workflow_outbox o SET tenant_id = e.tenant_id, project_id = e.project_id, branch_id = e.branch_id,
  owner_aggregate_type = e.aggregate_type, owner_aggregate_key = e.aggregate_key, owner_aggregate_revision = e.revision,
  event_type = o.topic, event_version = 1,
  lease_token = CASE WHEN o.state = 'processing' THEN 'legacy-lease:' || o.event_id || ':' || o.attempts::text ELSE NULL END
FROM event_owners e WHERE e.event_id = o.event_id;
--> statement-breakpoint
UPDATE durable_workflow_outbox SET event_digest = 'dw1-' || encode(digest(
  '{' ||
  '"branchId":' || to_jsonb(branch_id)::text || ',' ||
  '"eventId":' || to_jsonb(event_id)::text || ',' ||
  '"eventType":' || to_jsonb(event_type)::text || ',' ||
  '"eventVersion":' || event_version::text || ',' ||
  '"idempotencyKey":' || to_jsonb(idempotency_key)::text || ',' ||
  '"ownerAggregateKey":' || to_jsonb(owner_aggregate_key)::text || ',' ||
  '"ownerAggregateRevision":' || owner_aggregate_revision::text || ',' ||
  '"ownerAggregateType":' || to_jsonb(owner_aggregate_type)::text || ',' ||
  '"payloadDigest":' || to_jsonb(payload_digest)::text || ',' ||
  '"projectId":' || to_jsonb(project_id)::text || ',' ||
  '"tenantId":' || to_jsonb(tenant_id)::text || ',' ||
  '"topic":' || to_jsonb(topic)::text || '}', 'sha256'), 'hex');
--> statement-breakpoint

ALTER TABLE durable_workflow_outbox ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE durable_workflow_outbox ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE durable_workflow_outbox ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE durable_workflow_outbox ALTER COLUMN owner_aggregate_type SET NOT NULL;
ALTER TABLE durable_workflow_outbox ALTER COLUMN owner_aggregate_key SET NOT NULL;
ALTER TABLE durable_workflow_outbox ALTER COLUMN owner_aggregate_revision SET NOT NULL;
ALTER TABLE durable_workflow_outbox ALTER COLUMN event_type SET NOT NULL;
ALTER TABLE durable_workflow_outbox ALTER COLUMN event_version SET NOT NULL;
ALTER TABLE durable_workflow_outbox ALTER COLUMN event_digest SET NOT NULL;
--> statement-breakpoint

DROP INDEX durable_workflow_head_aggregate_uniq;
DROP INDEX durable_workflow_record_revision_uniq;
DROP INDEX durable_workflow_record_history_idx;
DROP INDEX durable_workflow_replay_uniq;
DROP INDEX durable_workflow_outbox_semantic_uniq;
DROP INDEX durable_workflow_outbox_dispatch_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX durable_workflow_head_scoped_aggregate_uniq ON durable_workflow_heads (tenant_id, project_id, branch_id, aggregate_type, aggregate_key);
CREATE UNIQUE INDEX durable_workflow_record_scoped_revision_uniq ON durable_workflow_records (tenant_id, project_id, branch_id, aggregate_type, aggregate_key, revision);
CREATE INDEX durable_workflow_record_scoped_history_idx ON durable_workflow_records (tenant_id, project_id, branch_id, aggregate_type, aggregate_key, revision);
CREATE UNIQUE INDEX durable_workflow_replay_scoped_uniq ON durable_workflow_replays (tenant_id, project_id, branch_id, scope_key, idempotency_key);
CREATE UNIQUE INDEX durable_workflow_outbox_owner_event_uniq ON durable_workflow_outbox (tenant_id, project_id, branch_id, owner_aggregate_type, owner_aggregate_key, owner_aggregate_revision, event_type, event_version, idempotency_key);
CREATE INDEX durable_workflow_outbox_scoped_dispatch_idx ON durable_workflow_outbox (tenant_id, project_id, branch_id, state, available_at, created_at);
CREATE INDEX durable_workflow_outbox_owner_idx ON durable_workflow_outbox (tenant_id, project_id, branch_id, owner_aggregate_type, owner_aggregate_key, owner_aggregate_revision);
--> statement-breakpoint

ALTER TABLE durable_workflow_heads ADD CONSTRAINT durable_workflow_head_scope_check CHECK (btrim(tenant_id) <> '' AND btrim(project_id) <> '' AND btrim(branch_id) <> '' AND btrim(aggregate_type) <> '' AND btrim(aggregate_key) <> '' AND revision > 0);
ALTER TABLE durable_workflow_records ADD CONSTRAINT durable_workflow_record_scope_check CHECK (btrim(tenant_id) <> '' AND btrim(project_id) <> '' AND btrim(branch_id) <> '' AND btrim(aggregate_type) <> '' AND btrim(aggregate_key) <> '' AND revision > 0);
ALTER TABLE durable_workflow_replays ADD CONSTRAINT durable_workflow_replay_scope_check CHECK (btrim(tenant_id) <> '' AND btrim(project_id) <> '' AND btrim(branch_id) <> '' AND btrim(scope_key) <> '' AND btrim(idempotency_key) <> '');
ALTER TABLE durable_workflow_outbox ADD CONSTRAINT durable_workflow_outbox_scope_check CHECK (btrim(tenant_id) <> '' AND btrim(project_id) <> '' AND btrim(branch_id) <> '');
ALTER TABLE durable_workflow_outbox ADD CONSTRAINT durable_workflow_outbox_owner_check CHECK (btrim(owner_aggregate_type) <> '' AND btrim(owner_aggregate_key) <> '' AND owner_aggregate_revision > 0);
ALTER TABLE durable_workflow_outbox ADD CONSTRAINT durable_workflow_outbox_event_check CHECK (btrim(event_type) <> '' AND event_version > 0 AND btrim(event_digest) <> '' AND btrim(payload_digest) <> '');
ALTER TABLE durable_workflow_outbox ADD CONSTRAINT durable_workflow_outbox_state_check CHECK (state IN ('pending','processing','completed','failed') AND attempts >= 0);
ALTER TABLE durable_workflow_outbox ADD CONSTRAINT durable_workflow_outbox_lease_check CHECK ((state = 'processing' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR (state <> 'processing' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL));
ALTER TABLE durable_workflow_outbox ADD CONSTRAINT durable_workflow_outbox_completion_check CHECK ((state = 'completed' AND completed_at IS NOT NULL) OR state <> 'completed');
ALTER TABLE durable_workflow_outbox ADD CONSTRAINT durable_workflow_outbox_terminal_check CHECK (terminal_at IS NULL OR state = 'failed');
ALTER TABLE durable_workflow_heads ADD CONSTRAINT durable_workflow_head_record_fk FOREIGN KEY (record_id) REFERENCES durable_workflow_records(record_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE durable_workflow_records ADD CONSTRAINT durable_workflow_record_head_fk FOREIGN KEY (head_id) REFERENCES durable_workflow_heads(head_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE durable_workflow_outbox ADD CONSTRAINT durable_workflow_outbox_owner_fk FOREIGN KEY (tenant_id, project_id, branch_id, owner_aggregate_type, owner_aggregate_key, owner_aggregate_revision) REFERENCES durable_workflow_records(tenant_id, project_id, branch_id, aggregate_type, aggregate_key, revision) DEFERRABLE INITIALLY DEFERRED;
