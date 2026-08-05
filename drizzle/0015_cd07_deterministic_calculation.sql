CREATE TABLE "calculation_upstream_signoffs" ("signoff_digest" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "approver_actor_id" text NOT NULL, "signoff" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE INDEX "calculation_signoff_project_idx" ON "calculation_upstream_signoffs" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "calculation_registry_snapshots" ("registry_snapshot_id" text PRIMARY KEY NOT NULL, "deterministic_digest" text NOT NULL, "policy_revision" text NOT NULL, "snapshot" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "calculation_registry_snapshot_digest_uniq" ON "calculation_registry_snapshots" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE TABLE "calculation_problems" ("problem_id" text NOT NULL, "problem_digest" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "upstream_signoff_digest" text NOT NULL, "registry_snapshot_id" text NOT NULL, "lifecycle_state" text NOT NULL, "problem" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "calculation_problem_identity" ON "calculation_problems" USING btree ("problem_id","problem_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "calculation_problem_digest_uniq" ON "calculation_problems" USING btree ("problem_digest");
--> statement-breakpoint
CREATE INDEX "calculation_problem_project_idx" ON "calculation_problems" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "calculation_graphs" ("graph_id" text PRIMARY KEY NOT NULL, "problem_id" text NOT NULL, "deterministic_digest" text NOT NULL, "validation_state" text NOT NULL, "graph" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "calculation_graph_digest_uniq" ON "calculation_graphs" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "calculation_graph_problem_idx" ON "calculation_graphs" USING btree ("problem_id","validation_state");
--> statement-breakpoint
CREATE TABLE "calculation_reports" ("report_id" text PRIMARY KEY NOT NULL, "project_id" text NOT NULL, "problem_id" text NOT NULL, "deterministic_digest" text NOT NULL, "lifecycle_state" text NOT NULL, "approval_state" text NOT NULL, "report" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "calculation_report_digest_uniq" ON "calculation_reports" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "calculation_report_problem_idx" ON "calculation_reports" USING btree ("project_id","problem_id","created_at");
--> statement-breakpoint
CREATE TABLE "calculation_decisions" ("decision_id" text PRIMARY KEY NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "report_id" text NOT NULL, "report_digest" text NOT NULL, "approver_actor_id" text, "deterministic_digest" text NOT NULL, "decision" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "calculation_decision_digest_uniq" ON "calculation_decisions" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "calculation_decision_project_idx" ON "calculation_decisions" USING btree ("project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "calculation_transaction_records" ("transaction_id" text PRIMARY KEY NOT NULL, "idempotency_key" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "actor_id" text NOT NULL, "status" text NOT NULL, "integrity_digest" text NOT NULL, "record" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "calculation_transaction_idempotency_uniq" ON "calculation_transaction_records" USING btree ("tenant_id","project_id","branch_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "calculation_transaction_project_idx" ON "calculation_transaction_records" USING btree ("tenant_id","project_id","branch_id","created_at");
