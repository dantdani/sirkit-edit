CREATE TABLE "simulation_verification_problems" ("problem_id" text NOT NULL, "problem_digest" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "graph_digest" text NOT NULL, "circuit_verification_digest" text NOT NULL, "lifecycle_state" text NOT NULL, "problem" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "simulation_problem_identity" ON "simulation_verification_problems" USING btree ("problem_id","problem_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "simulation_problem_digest_uniq" ON "simulation_verification_problems" USING btree ("problem_digest");
--> statement-breakpoint
CREATE INDEX "simulation_problem_project_idx" ON "simulation_verification_problems" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "simulation_model_registries" ("registry_id" text NOT NULL, "revision" integer NOT NULL, "deterministic_digest" text NOT NULL, "lifecycle_state" text NOT NULL, "registry" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "simulation_model_registry_identity" ON "simulation_model_registries" USING btree ("registry_id","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "simulation_model_registry_digest_uniq" ON "simulation_model_registries" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE TABLE "simulation_testbench_registries" ("registry_id" text NOT NULL, "revision" integer NOT NULL, "deterministic_digest" text NOT NULL, "lifecycle_state" text NOT NULL, "registry" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "simulation_testbench_registry_identity" ON "simulation_testbench_registries" USING btree ("registry_id","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "simulation_testbench_registry_digest_uniq" ON "simulation_testbench_registries" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE TABLE "simulation_coverage_denominators" ("denominator_id" text PRIMARY KEY NOT NULL, "problem_digest" text NOT NULL, "graph_digest" text NOT NULL, "model_registry_digest" text NOT NULL, "testbench_registry_digest" text NOT NULL, "instance_count" integer NOT NULL, "deterministic_digest" text NOT NULL, "denominator" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "simulation_denominator_digest_uniq" ON "simulation_coverage_denominators" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "simulation_denominator_input_idx" ON "simulation_coverage_denominators" USING btree ("problem_digest","graph_digest","model_registry_digest","testbench_registry_digest");
--> statement-breakpoint
CREATE TABLE "simulation_runs" ("run_id" text PRIMARY KEY NOT NULL, "campaign_id" text NOT NULL, "required_instance_id" text NOT NULL, "provider_revision_id" text NOT NULL, "environment_id" text NOT NULL, "run_state" text NOT NULL, "process_state" text NOT NULL, "deterministic_digest" text NOT NULL, "run" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "simulation_run_digest_uniq" ON "simulation_runs" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "simulation_run_campaign_idx" ON "simulation_runs" USING btree ("campaign_id","required_instance_id","created_at");
--> statement-breakpoint
CREATE TABLE "simulation_waveform_artifacts" ("waveform_artifact_id" text PRIMARY KEY NOT NULL, "run_id" text NOT NULL, "immutable_artifact_digest" text NOT NULL, "authority_state" text NOT NULL, "validation_state" text NOT NULL, "artifact" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "simulation_waveform_digest_uniq" ON "simulation_waveform_artifacts" USING btree ("immutable_artifact_digest");
--> statement-breakpoint
CREATE INDEX "simulation_waveform_run_idx" ON "simulation_waveform_artifacts" USING btree ("run_id","authority_state");
--> statement-breakpoint
CREATE TABLE "simulation_coverage_matrices" ("coverage_matrix_id" text PRIMARY KEY NOT NULL, "problem_revision_id" text NOT NULL, "denominator_digest" text NOT NULL, "coverage_digest" text NOT NULL, "matrix" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "simulation_coverage_digest_uniq" ON "simulation_coverage_matrices" USING btree ("coverage_digest");
--> statement-breakpoint
CREATE INDEX "simulation_coverage_problem_idx" ON "simulation_coverage_matrices" USING btree ("problem_revision_id","created_at");
--> statement-breakpoint
CREATE TABLE "simulation_campaigns" ("campaign_id" text PRIMARY KEY NOT NULL, "problem_revision_id" text NOT NULL, "graph_revision_id" text NOT NULL, "readiness_state" text NOT NULL, "lifecycle_state" text NOT NULL, "deterministic_digest" text NOT NULL, "campaign" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "simulation_campaign_digest_uniq" ON "simulation_campaigns" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "simulation_campaign_problem_idx" ON "simulation_campaigns" USING btree ("problem_revision_id","created_at");
--> statement-breakpoint
CREATE TABLE "simulation_readiness_reports" ("report_id" text PRIMARY KEY NOT NULL, "problem_digest" text NOT NULL, "campaign_id" text, "readiness_state" text NOT NULL, "graph_digest" text NOT NULL, "deterministic_digest" text NOT NULL, "report" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "simulation_readiness_digest_uniq" ON "simulation_readiness_reports" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "simulation_readiness_problem_idx" ON "simulation_readiness_reports" USING btree ("problem_digest","created_at");
--> statement-breakpoint
CREATE TABLE "model_simulation_project_states" ("project_id" text NOT NULL, "branch_id" text NOT NULL, "state_digest" text NOT NULL, "graph_digest" text NOT NULL, "model_registry_digest" text NOT NULL, "testbench_registry_digest" text NOT NULL, "state" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_simulation_project_state_identity" ON "model_simulation_project_states" USING btree ("project_id","branch_id","state_digest");
--> statement-breakpoint
CREATE INDEX "model_simulation_project_state_current_idx" ON "model_simulation_project_states" USING btree ("project_id","branch_id","created_at");
