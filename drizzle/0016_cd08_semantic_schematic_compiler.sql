CREATE TABLE "schematic_compiler_upstream_signoffs" ("signoff_digest" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "approver_actor_id" text NOT NULL, "signoff" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE INDEX "schematic_compiler_signoff_project_idx" ON "schematic_compiler_upstream_signoffs" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "schematic_compilation_problems" ("problem_id" text NOT NULL, "problem_digest" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "upstream_signoff_digest" text NOT NULL, "lifecycle_state" text NOT NULL, "problem" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "schematic_compilation_problem_identity" ON "schematic_compilation_problems" USING btree ("problem_id","problem_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "schematic_compilation_problem_digest_uniq" ON "schematic_compilation_problems" USING btree ("problem_digest");
--> statement-breakpoint
CREATE INDEX "schematic_compilation_problem_project_idx" ON "schematic_compilation_problems" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "schematic_semantic_graphs" ("graph_id" text NOT NULL, "revision" integer NOT NULL, "project_id" text NOT NULL, "problem_id" text NOT NULL, "deterministic_digest" text NOT NULL, "validation_state" text NOT NULL, "graph" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "schematic_semantic_graph_identity" ON "schematic_semantic_graphs" USING btree ("graph_id","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "schematic_semantic_graph_digest_uniq" ON "schematic_semantic_graphs" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "schematic_semantic_graph_project_idx" ON "schematic_semantic_graphs" USING btree ("project_id","problem_id","created_at");
--> statement-breakpoint
CREATE TABLE "schematic_diagram_views" ("diagram_view_id" text PRIMARY KEY NOT NULL, "graph_digest" text NOT NULL, "sheet_instance_id" text NOT NULL, "deterministic_digest" text NOT NULL, "readability_state" text NOT NULL, "view" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "schematic_diagram_view_digest_uniq" ON "schematic_diagram_views" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "schematic_diagram_view_graph_idx" ON "schematic_diagram_views" USING btree ("graph_digest","sheet_instance_id");
--> statement-breakpoint
CREATE TABLE "schematic_artifact_manifests" ("manifest_id" text PRIMARY KEY NOT NULL, "candidate_id" text NOT NULL, "deterministic_digest" text NOT NULL, "publication_state" text NOT NULL, "manifest" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "schematic_artifact_manifest_digest_uniq" ON "schematic_artifact_manifests" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "schematic_artifact_manifest_candidate_idx" ON "schematic_artifact_manifests" USING btree ("candidate_id","publication_state");
--> statement-breakpoint
CREATE TABLE "schematic_round_trip_certificates" ("certificate_id" text PRIMARY KEY NOT NULL, "graph_digest" text NOT NULL, "manifest_id" text NOT NULL, "deterministic_digest" text NOT NULL, "certificate_state" text NOT NULL, "certificate" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "schematic_round_trip_digest_uniq" ON "schematic_round_trip_certificates" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "schematic_round_trip_graph_idx" ON "schematic_round_trip_certificates" USING btree ("graph_digest","certificate_state");
--> statement-breakpoint
CREATE TABLE "schematic_completeness_reports" ("report_id" text PRIMARY KEY NOT NULL, "graph_revision_id" text NOT NULL, "deterministic_digest" text NOT NULL, "readiness_state" text NOT NULL, "report" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "schematic_completeness_digest_uniq" ON "schematic_completeness_reports" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "schematic_completeness_graph_idx" ON "schematic_completeness_reports" USING btree ("graph_revision_id","readiness_state");
--> statement-breakpoint
CREATE TABLE "schematic_semantic_diffs" ("diff_id" text PRIMARY KEY NOT NULL, "base_graph_revision_id" text NOT NULL, "candidate_graph_revision_id" text NOT NULL, "deterministic_digest" text NOT NULL, "diff" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "schematic_semantic_diff_digest_uniq" ON "schematic_semantic_diffs" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "schematic_semantic_diff_graph_idx" ON "schematic_semantic_diffs" USING btree ("base_graph_revision_id","candidate_graph_revision_id");
--> statement-breakpoint
CREATE TABLE "schematic_pcb_sync_contracts" ("contract_id" text PRIMARY KEY NOT NULL, "candidate_id" text NOT NULL, "graph_digest" text NOT NULL, "deterministic_digest" text NOT NULL, "synchronization_state" text NOT NULL, "contract" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "schematic_pcb_sync_digest_uniq" ON "schematic_pcb_sync_contracts" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "schematic_pcb_sync_candidate_idx" ON "schematic_pcb_sync_contracts" USING btree ("candidate_id","synchronization_state");
--> statement-breakpoint
CREATE TABLE "schematic_candidates" ("candidate_id" text PRIMARY KEY NOT NULL, "problem_id" text NOT NULL, "graph_digest" text NOT NULL, "deterministic_digest" text NOT NULL, "lifecycle_state" text NOT NULL, "approval_state" text NOT NULL, "candidate" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "schematic_candidate_digest_uniq" ON "schematic_candidates" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "schematic_candidate_problem_idx" ON "schematic_candidates" USING btree ("problem_id","lifecycle_state","created_at");
--> statement-breakpoint
CREATE TABLE "schematic_decisions" ("decision_id" text PRIMARY KEY NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "candidate_id" text NOT NULL, "candidate_digest" text NOT NULL, "approver_actor_id" text, "deterministic_digest" text NOT NULL, "decision" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "schematic_decision_digest_uniq" ON "schematic_decisions" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "schematic_decision_project_idx" ON "schematic_decisions" USING btree ("project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "schematic_transaction_records" ("transaction_id" text PRIMARY KEY NOT NULL, "idempotency_key" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "actor_id" text NOT NULL, "status" text NOT NULL, "integrity_digest" text NOT NULL, "record" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "schematic_transaction_idempotency_uniq" ON "schematic_transaction_records" USING btree ("tenant_id","project_id","branch_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "schematic_transaction_project_idx" ON "schematic_transaction_records" USING btree ("tenant_id","project_id","branch_id","created_at");
