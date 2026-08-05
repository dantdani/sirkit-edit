CREATE TABLE "circuit_verification_upstream_signoffs" ("signoff_digest" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "approver_actor_id" text NOT NULL, "signoff" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE INDEX "circuit_verification_signoff_project_idx" ON "circuit_verification_upstream_signoffs" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "circuit_verification_problems" ("problem_id" text NOT NULL, "problem_digest" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "graph_digest" text NOT NULL, "registry_digest" text NOT NULL, "lifecycle_state" text NOT NULL, "problem" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_verification_problem_identity" ON "circuit_verification_problems" USING btree ("problem_id","problem_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_verification_problem_digest_uniq" ON "circuit_verification_problems" USING btree ("problem_digest");
--> statement-breakpoint
CREATE INDEX "circuit_verification_problem_project_idx" ON "circuit_verification_problems" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "circuit_rule_registries" ("registry_id" text NOT NULL, "revision" integer NOT NULL, "deterministic_digest" text NOT NULL, "lifecycle_state" text NOT NULL, "approved_by_actor_id" text, "registry" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_rule_registry_identity" ON "circuit_rule_registries" USING btree ("registry_id","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_rule_registry_digest_uniq" ON "circuit_rule_registries" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE TABLE "circuit_rule_denominators" ("denominator_id" text PRIMARY KEY NOT NULL, "problem_id" text NOT NULL, "graph_digest" text NOT NULL, "registry_digest" text NOT NULL, "deterministic_digest" text NOT NULL, "instance_count" integer NOT NULL, "denominator" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_rule_denominator_digest_uniq" ON "circuit_rule_denominators" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "circuit_rule_denominator_input_idx" ON "circuit_rule_denominators" USING btree ("problem_id","graph_digest","registry_digest");
--> statement-breakpoint
CREATE TABLE "circuit_oracle_runs" ("run_id" text PRIMARY KEY NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "run_kind" text NOT NULL, "graph_digest" text NOT NULL, "registry_digest" text NOT NULL, "denominator_digest" text NOT NULL, "execution_state" text NOT NULL, "deterministic_digest" text NOT NULL, "run" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_oracle_run_digest_uniq" ON "circuit_oracle_runs" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "circuit_oracle_run_project_idx" ON "circuit_oracle_runs" USING btree ("project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "circuit_findings" ("finding_id" text NOT NULL, "stable_identity" text NOT NULL, "run_id" text NOT NULL, "rule_id" text NOT NULL, "graph_digest" text NOT NULL, "workflow_state" text NOT NULL, "engineering_result" text NOT NULL, "deterministic_digest" text NOT NULL, "finding" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_finding_run_identity" ON "circuit_findings" USING btree ("finding_id","run_id");
--> statement-breakpoint
CREATE INDEX "circuit_finding_stable_idx" ON "circuit_findings" USING btree ("stable_identity","graph_digest","workflow_state");
--> statement-breakpoint
CREATE TABLE "circuit_waivers" ("waiver_id" text PRIMARY KEY NOT NULL, "graph_digest" text NOT NULL, "registry_digest" text NOT NULL, "state" text NOT NULL, "requested_by_actor_id" text NOT NULL, "approved_by_actor_id" text NOT NULL, "expires_at" timestamp with time zone NOT NULL, "deterministic_digest" text NOT NULL, "waiver" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_waiver_digest_uniq" ON "circuit_waivers" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "circuit_waiver_current_idx" ON "circuit_waivers" USING btree ("graph_digest","registry_digest","state","expires_at");
--> statement-breakpoint
CREATE TABLE "circuit_oracle_parity_reports" ("parity_id" text PRIMARY KEY NOT NULL, "full_run_id" text NOT NULL, "incremental_run_id" text NOT NULL, "state" text NOT NULL, "deterministic_digest" text NOT NULL, "report" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_oracle_parity_digest_uniq" ON "circuit_oracle_parity_reports" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "circuit_oracle_parity_runs_idx" ON "circuit_oracle_parity_reports" USING btree ("full_run_id","incremental_run_id");
--> statement-breakpoint
CREATE TABLE "circuit_readiness_reports" ("report_id" text PRIMARY KEY NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "graph_digest" text NOT NULL, "registry_digest" text NOT NULL, "verdict" text NOT NULL, "deterministic_digest" text NOT NULL, "report" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_readiness_digest_uniq" ON "circuit_readiness_reports" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "circuit_readiness_project_idx" ON "circuit_readiness_reports" USING btree ("project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "circuit_verification_project_states" ("project_id" text NOT NULL, "branch_id" text NOT NULL, "state_digest" text NOT NULL, "graph_digest" text NOT NULL, "registry_digest" text NOT NULL, "state" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_verification_project_state_identity" ON "circuit_verification_project_states" USING btree ("project_id","branch_id","state_digest");
--> statement-breakpoint
CREATE INDEX "circuit_verification_project_state_current_idx" ON "circuit_verification_project_states" USING btree ("project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "circuit_verification_transaction_records" ("transaction_id" text PRIMARY KEY NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "actor_id" text NOT NULL, "operation" text NOT NULL, "integrity_digest" text NOT NULL, "record" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE INDEX "circuit_verification_transaction_project_idx" ON "circuit_verification_transaction_records" USING btree ("project_id","branch_id","created_at");
