CREATE TABLE IF NOT EXISTS "durable_workflow_heads" (
  "head_id" text PRIMARY KEY NOT NULL,
  "aggregate_type" text NOT NULL,
  "aggregate_key" text NOT NULL,
  "tenant_id" text NOT NULL,
  "project_id" text NOT NULL,
  "branch_id" text NOT NULL,
  "revision" integer NOT NULL,
  "record_id" text NOT NULL,
  "record_digest" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "durable_workflow_head_aggregate_uniq" ON "durable_workflow_heads" USING btree ("aggregate_type", "aggregate_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "durable_workflow_head_project_idx" ON "durable_workflow_heads" USING btree ("tenant_id", "project_id", "branch_id", "aggregate_type");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "durable_workflow_records" (
  "record_id" text PRIMARY KEY NOT NULL,
  "head_id" text NOT NULL,
  "aggregate_type" text NOT NULL,
  "aggregate_key" text NOT NULL,
  "tenant_id" text NOT NULL,
  "project_id" text NOT NULL,
  "branch_id" text NOT NULL,
  "revision" integer NOT NULL,
  "record_digest" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "durable_workflow_record_revision_uniq" ON "durable_workflow_records" USING btree ("aggregate_type", "aggregate_key", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "durable_workflow_record_history_idx" ON "durable_workflow_records" USING btree ("aggregate_type", "aggregate_key", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "durable_workflow_record_project_idx" ON "durable_workflow_records" USING btree ("tenant_id", "project_id", "branch_id", "aggregate_type", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "durable_workflow_replays" (
  "replay_id" text PRIMARY KEY NOT NULL,
  "scope_key" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "result" jsonb NOT NULL,
  "committed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "durable_workflow_replay_uniq" ON "durable_workflow_replays" USING btree ("scope_key", "idempotency_key");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "durable_workflow_outbox" (
  "event_id" text PRIMARY KEY NOT NULL,
  "scope_key" text NOT NULL,
  "topic" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "payload_digest" text NOT NULL,
  "payload" jsonb NOT NULL,
  "state" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone NOT NULL,
  "lease_owner" text,
  "lease_expires_at" timestamp with time zone,
  "last_error_code" text,
  "created_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "durable_workflow_outbox_semantic_uniq" ON "durable_workflow_outbox" USING btree ("scope_key", "topic", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "durable_workflow_outbox_dispatch_idx" ON "durable_workflow_outbox" USING btree ("state", "available_at", "created_at");
