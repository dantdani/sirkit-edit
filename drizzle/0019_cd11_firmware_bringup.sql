CREATE TABLE "firmware_bringup_problems" ("problem_id" text NOT NULL, "problem_digest" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "simulation_campaign_digest" text NOT NULL, "lifecycle_state" text NOT NULL, "problem" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "firmware_bringup_problem_identity" ON "firmware_bringup_problems" USING btree ("problem_id","problem_digest");
--> statement-breakpoint
CREATE INDEX "firmware_bringup_problem_project_idx" ON "firmware_bringup_problems" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "programmable_device_evidence_snapshots" ("snapshot_id" text NOT NULL, "revision" integer NOT NULL, "deterministic_digest" text NOT NULL, "lifecycle_state" text NOT NULL, "snapshot" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "programmable_device_evidence_identity" ON "programmable_device_evidence_snapshots" USING btree ("snapshot_id","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "programmable_device_evidence_digest_uniq" ON "programmable_device_evidence_snapshots" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE TABLE "firmware_bringup_coverage_reports" ("report_id" text PRIMARY KEY NOT NULL, "problem_digest" text NOT NULL, "denominator_digest" text NOT NULL, "deterministic_digest" text NOT NULL, "report" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "firmware_bringup_coverage_digest_uniq" ON "firmware_bringup_coverage_reports" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "firmware_bringup_coverage_problem_idx" ON "firmware_bringup_coverage_reports" USING btree ("problem_digest","created_at");
--> statement-breakpoint
CREATE TABLE "firmware_bringup_readiness_decisions" ("decision_id" text PRIMARY KEY NOT NULL, "problem_digest" text NOT NULL, "verdict" text NOT NULL, "deterministic_digest" text NOT NULL, "decision" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "firmware_bringup_readiness_digest_uniq" ON "firmware_bringup_readiness_decisions" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "firmware_bringup_readiness_problem_idx" ON "firmware_bringup_readiness_decisions" USING btree ("problem_digest","created_at");
--> statement-breakpoint
CREATE TABLE "firmware_bringup_packages" ("package_id" text NOT NULL, "package_digest" text NOT NULL, "problem_digest" text NOT NULL, "readiness_state" text NOT NULL, "hardware_execution_state" text NOT NULL, "package" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "firmware_bringup_package_identity" ON "firmware_bringup_packages" USING btree ("package_id","package_digest");
--> statement-breakpoint
CREATE INDEX "firmware_bringup_package_problem_idx" ON "firmware_bringup_packages" USING btree ("problem_digest","created_at");
--> statement-breakpoint
CREATE TABLE "firmware_bringup_project_states" ("project_id" text NOT NULL, "branch_id" text NOT NULL, "state_digest" text NOT NULL, "problem_digest" text NOT NULL, "state" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "firmware_bringup_project_state_identity" ON "firmware_bringup_project_states" USING btree ("project_id","branch_id","state_digest");
--> statement-breakpoint
CREATE INDEX "firmware_bringup_project_state_current_idx" ON "firmware_bringup_project_states" USING btree ("project_id","branch_id","created_at");
