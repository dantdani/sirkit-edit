CREATE TABLE "component_selection_upstream_signoffs" ("signoff_digest" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "approver_actor_id" text NOT NULL, "signoff" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE INDEX "component_selection_signoff_project_idx" ON "component_selection_upstream_signoffs" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "component_selection_problems" ("problem_id" text NOT NULL, "problem_digest" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "upstream_signoff_digest" text NOT NULL, "catalog_snapshot_digest" text NOT NULL, "problem" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "component_selection_problem_identity" ON "component_selection_problems" USING btree ("problem_id","problem_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "component_selection_problem_digest_uniq" ON "component_selection_problems" USING btree ("problem_digest");
--> statement-breakpoint
CREATE INDEX "component_selection_problem_project_idx" ON "component_selection_problems" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "component_selection_catalog_snapshots" ("catalog_snapshot_id" text PRIMARY KEY NOT NULL, "deterministic_digest" text NOT NULL, "publication_policy_revision" text NOT NULL, "snapshot" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "component_selection_catalog_snapshot_digest_uniq" ON "component_selection_catalog_snapshots" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE TABLE "component_selection_sourcing_snapshots" ("snapshot_id" text PRIMARY KEY NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "deterministic_digest" text NOT NULL, "observed_at" timestamp with time zone NOT NULL, "provider_id" text NOT NULL, "error_partial_state" text NOT NULL, "snapshot" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "component_selection_sourcing_snapshot_digest_uniq" ON "component_selection_sourcing_snapshots" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "component_selection_sourcing_project_idx" ON "component_selection_sourcing_snapshots" USING btree ("project_id","branch_id","observed_at");
--> statement-breakpoint
CREATE TABLE "component_selection_offer_observations" ("offer_observation_id" text PRIMARY KEY NOT NULL, "snapshot_id" text NOT NULL, "exact_manufacturer_part_id" text NOT NULL, "supplier_id" text NOT NULL, "supplier_sku" text NOT NULL, "deterministic_digest" text NOT NULL, "observation" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "component_selection_offer_observation_digest_uniq" ON "component_selection_offer_observations" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "component_selection_offer_part_idx" ON "component_selection_offer_observations" USING btree ("snapshot_id","exact_manufacturer_part_id");
--> statement-breakpoint
CREATE TABLE "component_selection_evaluations" ("evaluation_id" text PRIMARY KEY NOT NULL, "problem_id" text NOT NULL, "role_requirement_id" text NOT NULL, "atomic_part_revision_id" text NOT NULL, "deterministic_digest" text NOT NULL, "feasibility_state" text NOT NULL, "evaluation" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "component_selection_evaluation_digest_uniq" ON "component_selection_evaluations" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "component_selection_evaluation_problem_role_idx" ON "component_selection_evaluations" USING btree ("problem_id","role_requirement_id","feasibility_state");
--> statement-breakpoint
CREATE TABLE "component_selection_candidates" ("candidate_id" text PRIMARY KEY NOT NULL, "problem_id" text NOT NULL, "deterministic_digest" text NOT NULL, "feasibility_state" text NOT NULL, "lifecycle_state" text NOT NULL, "candidate" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "component_selection_candidate_digest_uniq" ON "component_selection_candidates" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "component_selection_candidate_problem_idx" ON "component_selection_candidates" USING btree ("problem_id","feasibility_state","created_at");
--> statement-breakpoint
CREATE TABLE "component_selection_alternatives" ("alternative_plan_id" text PRIMARY KEY NOT NULL, "primary_atomic_part_revision_id" text NOT NULL, "alternative_atomic_part_revision_id" text NOT NULL, "deterministic_digest" text NOT NULL, "alternative" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "component_selection_alternative_digest_uniq" ON "component_selection_alternatives" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "component_selection_alternative_pair_idx" ON "component_selection_alternatives" USING btree ("primary_atomic_part_revision_id","alternative_atomic_part_revision_id");
--> statement-breakpoint
CREATE TABLE "component_selection_decisions" ("decision_id" text PRIMARY KEY NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "problem_digest" text NOT NULL, "selected_candidate_id" text, "approver_actor_id" text, "deterministic_digest" text NOT NULL, "decision" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "component_selection_decision_digest_uniq" ON "component_selection_decisions" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "component_selection_decision_project_idx" ON "component_selection_decisions" USING btree ("project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "component_selection_transaction_records" ("transaction_id" text PRIMARY KEY NOT NULL, "idempotency_key" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "actor_id" text NOT NULL, "status" text NOT NULL, "integrity_digest" text NOT NULL, "record" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "component_selection_transaction_idempotency_uniq" ON "component_selection_transaction_records" USING btree ("tenant_id","project_id","branch_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "component_selection_transaction_project_idx" ON "component_selection_transaction_records" USING btree ("tenant_id","project_id","branch_id","created_at");
