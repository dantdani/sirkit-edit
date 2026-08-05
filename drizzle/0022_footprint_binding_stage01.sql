CREATE TABLE "physical_binding_revisions" (
  "revision_id" text PRIMARY KEY NOT NULL,
  "binding_id" text NOT NULL,
  "lineage_id" text NOT NULL,
  "revision" integer NOT NULL,
  "tenant_id" text NOT NULL,
  "project_id" text NOT NULL,
  "branch_id" text NOT NULL,
  "board_instance_id" text NOT NULL,
  "component_instance_id" text NOT NULL,
  "variant_scope_digest" text NOT NULL,
  "technical_digest" text NOT NULL,
  "record_digest" text NOT NULL,
  "lifecycle_state" text NOT NULL,
  "approval_state" text NOT NULL,
  "technical_state" text NOT NULL,
  "freshness_state" text NOT NULL,
  "conflict_state" text NOT NULL,
  "applicability_state" text NOT NULL,
  "binding" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "created_by" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "physical_binding_logical_revision_uniq" ON "physical_binding_revisions" USING btree ("binding_id","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "physical_binding_record_digest_uniq" ON "physical_binding_revisions" USING btree ("record_digest");
--> statement-breakpoint
CREATE INDEX "physical_binding_project_component_idx" ON "physical_binding_revisions" USING btree ("tenant_id","project_id","branch_id","component_instance_id","variant_scope_digest");
--> statement-breakpoint
CREATE INDEX "physical_binding_technical_digest_idx" ON "physical_binding_revisions" USING btree ("technical_digest");
--> statement-breakpoint
CREATE TABLE "physical_binding_sets" (
  "set_id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "project_id" text NOT NULL,
  "branch_id" text NOT NULL,
  "board_instance_id" text NOT NULL,
  "component_instance_id" text NOT NULL,
  "variant_scope_digest" text NOT NULL,
  "revision" integer NOT NULL,
  "effective_selected_revision_id" text,
  "record_digest" text NOT NULL,
  "binding_set" jsonb NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "physical_binding_set_scope_uniq" ON "physical_binding_sets" USING btree ("tenant_id","project_id","branch_id","board_instance_id","component_instance_id","variant_scope_digest");
--> statement-breakpoint
CREATE INDEX "physical_binding_set_project_idx" ON "physical_binding_sets" USING btree ("tenant_id","project_id","branch_id","updated_at");
--> statement-breakpoint
CREATE INDEX "physical_binding_set_selected_idx" ON "physical_binding_sets" USING btree ("effective_selected_revision_id");
--> statement-breakpoint
CREATE TABLE "physical_binding_audit_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "project_id" text NOT NULL,
  "branch_id" text NOT NULL,
  "component_instance_id" text NOT NULL,
  "binding_id" text NOT NULL,
  "action" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "event_digest" text NOT NULL,
  "event" jsonb NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "physical_binding_audit_idempotency_uniq" ON "physical_binding_audit_events" USING btree ("tenant_id","project_id","branch_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "physical_binding_audit_binding_idx" ON "physical_binding_audit_events" USING btree ("binding_id","occurred_at");
--> statement-breakpoint
CREATE TABLE "physical_binding_migration_records" (
  "migration_key" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "project_id" text NOT NULL,
  "branch_id" text NOT NULL,
  "component_instance_id" text NOT NULL,
  "source_schema_version" text NOT NULL,
  "candidate_revision_id" text NOT NULL,
  "status" text NOT NULL,
  "dry_run" boolean NOT NULL,
  "record_digest" text NOT NULL,
  "record" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "physical_binding_migration_project_idx" ON "physical_binding_migration_records" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "physical_binding_migration_digest_uniq" ON "physical_binding_migration_records" USING btree ("record_digest");
--> statement-breakpoint
CREATE TABLE "physical_readiness_assessments" (
  "assessment_id" text PRIMARY KEY NOT NULL,
  "binding_revision_id" text NOT NULL,
  "binding_record_digest" text NOT NULL,
  "policy_version" text NOT NULL,
  "layout_state" text NOT NULL,
  "manufacturing_state" text NOT NULL,
  "assessment_digest" text NOT NULL,
  "assessment" jsonb NOT NULL,
  "assessed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "physical_readiness_assessment_digest_uniq" ON "physical_readiness_assessments" USING btree ("assessment_digest");
--> statement-breakpoint
CREATE INDEX "physical_readiness_binding_idx" ON "physical_readiness_assessments" USING btree ("binding_revision_id","assessed_at");
