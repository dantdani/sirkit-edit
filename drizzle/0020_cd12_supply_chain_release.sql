CREATE TABLE "release_engineering_problems" ("problem_id" text NOT NULL, "problem_digest" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "firmware_bringup_digest" text NOT NULL, "requested_level" text NOT NULL, "lifecycle_state" text NOT NULL, "problem" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "release_engineering_problem_identity" ON "release_engineering_problems" USING btree ("problem_id","problem_digest");
--> statement-breakpoint
CREATE INDEX "release_engineering_problem_project_idx" ON "release_engineering_problems" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "authoritative_boms" ("bom_id" text NOT NULL, "revision" integer NOT NULL, "deterministic_digest" text NOT NULL, "variant_matrix_digest" text NOT NULL, "approval_state" text NOT NULL, "bom" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "authoritative_bom_identity" ON "authoritative_boms" USING btree ("bom_id","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "authoritative_bom_digest_uniq" ON "authoritative_boms" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE TABLE "procurement_snapshots" ("snapshot_id" text NOT NULL, "deterministic_digest" text NOT NULL, "bom_digest" text NOT NULL, "build_scenario_digest" text NOT NULL, "observed_at" timestamp with time zone NOT NULL, "completeness" text NOT NULL, "snapshot" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "procurement_snapshot_identity" ON "procurement_snapshots" USING btree ("snapshot_id","deterministic_digest");
--> statement-breakpoint
CREATE INDEX "procurement_snapshot_bom_idx" ON "procurement_snapshots" USING btree ("bom_digest","observed_at");
--> statement-breakpoint
CREATE TABLE "manufacturing_artifact_manifests" ("manifest_id" text NOT NULL, "deterministic_digest" text NOT NULL, "candidate_ref" text NOT NULL, "lifecycle_state" text NOT NULL, "manifest" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "manufacturing_artifact_manifest_identity" ON "manufacturing_artifact_manifests" USING btree ("manifest_id","deterministic_digest");
--> statement-breakpoint
CREATE INDEX "manufacturing_artifact_manifest_candidate_idx" ON "manufacturing_artifact_manifests" USING btree ("candidate_ref","created_at");
--> statement-breakpoint
CREATE TABLE "hardware_release_candidates" ("candidate_id" text NOT NULL, "revision" integer NOT NULL, "deterministic_digest" text NOT NULL, "problem_digest" text NOT NULL, "lifecycle_state" text NOT NULL, "candidate" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "hardware_release_candidate_identity" ON "hardware_release_candidates" USING btree ("candidate_id","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "hardware_release_candidate_digest_uniq" ON "hardware_release_candidates" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE TABLE "release_manifests" ("manifest_id" text NOT NULL, "revision" integer NOT NULL, "deterministic_digest" text NOT NULL, "problem_digest" text NOT NULL, "achieved_level" text NOT NULL, "manifest" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "release_manifest_identity" ON "release_manifests" USING btree ("manifest_id","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "release_manifest_digest_uniq" ON "release_manifests" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE TABLE "release_level_assessments" ("assessment_id" text PRIMARY KEY NOT NULL, "candidate_ref" text NOT NULL, "current_justified_level" text NOT NULL, "verdict" text NOT NULL, "deterministic_digest" text NOT NULL, "assessment" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "release_level_assessment_digest_uniq" ON "release_level_assessments" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "release_level_assessment_candidate_idx" ON "release_level_assessments" USING btree ("candidate_ref","created_at");
--> statement-breakpoint
CREATE TABLE "release_engineering_project_states" ("project_id" text NOT NULL, "branch_id" text NOT NULL, "state_digest" text NOT NULL, "problem_digest" text NOT NULL, "state" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "release_engineering_project_state_identity" ON "release_engineering_project_states" USING btree ("project_id","branch_id","state_digest");
--> statement-breakpoint
CREATE INDEX "release_engineering_project_state_current_idx" ON "release_engineering_project_states" USING btree ("project_id","branch_id","created_at");

