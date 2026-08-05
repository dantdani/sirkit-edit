CREATE TABLE "full_flow_run_contexts" ("context_id" text NOT NULL, "deterministic_digest" text NOT NULL, "request_digest" text NOT NULL, "registry_digest" text NOT NULL, "budget_digest" text NOT NULL, "context" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "full_flow_run_context_identity" ON "full_flow_run_contexts" USING btree ("context_id","deterministic_digest");
--> statement-breakpoint
CREATE INDEX "full_flow_run_context_request_idx" ON "full_flow_run_contexts" USING btree ("request_digest","created_at");
--> statement-breakpoint
CREATE TABLE "autonomous_hardware_design_runs" ("run_id" text NOT NULL, "revision" integer NOT NULL, "deterministic_digest" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "lifecycle_state" text NOT NULL, "requested_outcome" text NOT NULL, "run" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "autonomous_hardware_design_run_identity" ON "autonomous_hardware_design_runs" USING btree ("run_id","revision");
--> statement-breakpoint
CREATE INDEX "autonomous_hardware_design_run_current_idx" ON "autonomous_hardware_design_runs" USING btree ("project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "full_flow_run_events" ("event_id" text PRIMARY KEY NOT NULL, "run_id" text NOT NULL, "sequence" integer NOT NULL, "deterministic_digest" text NOT NULL, "event_type" text NOT NULL, "event" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "full_flow_run_event_sequence_uniq" ON "full_flow_run_events" USING btree ("run_id","sequence");
--> statement-breakpoint
CREATE INDEX "full_flow_run_event_run_idx" ON "full_flow_run_events" USING btree ("run_id","created_at");
--> statement-breakpoint
CREATE TABLE "full_flow_stage_invocations" ("invocation_id" text NOT NULL, "deterministic_digest" text NOT NULL, "run_id" text NOT NULL, "candidate_ref" text NOT NULL, "stage_id" text NOT NULL, "idempotency_key" text NOT NULL, "lifecycle_state" text NOT NULL, "invocation" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "full_flow_stage_invocation_identity" ON "full_flow_stage_invocations" USING btree ("invocation_id","deterministic_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "full_flow_stage_invocation_idempotency_uniq" ON "full_flow_stage_invocations" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "full_flow_stage_invocation_run_idx" ON "full_flow_stage_invocations" USING btree ("run_id","created_at");
--> statement-breakpoint
CREATE TABLE "full_flow_candidate_graphs" ("graph_id" text NOT NULL, "revision" integer NOT NULL, "deterministic_digest" text NOT NULL, "run_id" text NOT NULL, "graph" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "full_flow_candidate_graph_identity" ON "full_flow_candidate_graphs" USING btree ("graph_id","revision");
--> statement-breakpoint
CREATE INDEX "full_flow_candidate_graph_run_idx" ON "full_flow_candidate_graphs" USING btree ("run_id","created_at");
--> statement-breakpoint
CREATE TABLE "full_flow_final_verdicts" ("verdict_id" text PRIMARY KEY NOT NULL, "run_id" text NOT NULL, "verdict" text NOT NULL, "achieved_outcome" text, "deterministic_digest" text NOT NULL, "final_verdict" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "full_flow_final_verdict_digest_uniq" ON "full_flow_final_verdicts" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "full_flow_final_verdict_run_idx" ON "full_flow_final_verdicts" USING btree ("run_id","created_at");
--> statement-breakpoint
CREATE TABLE "full_flow_replay_bundles" ("bundle_id" text NOT NULL, "deterministic_digest" text NOT NULL, "source_run_id" text NOT NULL, "bundle" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "full_flow_replay_bundle_identity" ON "full_flow_replay_bundles" USING btree ("bundle_id","deterministic_digest");
--> statement-breakpoint
CREATE INDEX "full_flow_replay_bundle_source_idx" ON "full_flow_replay_bundles" USING btree ("source_run_id","created_at");
--> statement-breakpoint
CREATE TABLE "full_flow_project_states" ("project_id" text NOT NULL, "branch_id" text NOT NULL, "state_digest" text NOT NULL, "prerequisite_digest" text NOT NULL, "state" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "full_flow_project_state_identity" ON "full_flow_project_states" USING btree ("project_id","branch_id","state_digest");
--> statement-breakpoint
CREATE INDEX "full_flow_project_state_current_idx" ON "full_flow_project_states" USING btree ("project_id","branch_id","created_at");
