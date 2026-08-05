CREATE TABLE "interface_upstream_signoffs" (
  "signoff_digest" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL,
  "requirements_digest" text NOT NULL, "architecture_candidate_digest" text NOT NULL, "architecture_decision_digest" text NOT NULL,
  "power_candidate_digest" text NOT NULL, "power_decision_digest" text NOT NULL, "approver_actor_id" text NOT NULL,
  "signoff" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "interface_upstream_signoff_project_idx" ON "interface_upstream_signoffs" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "interface_planning_problems" (
  "problem_id" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "problem_digest" text NOT NULL,
  "requirements_digest" text NOT NULL, "architecture_candidate_digest" text NOT NULL, "power_candidate_digest" text NOT NULL,
  "upstream_signoff_digest" text NOT NULL, "compiler_version" text NOT NULL, "problem" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "interface_planning_problem_identity" ON "interface_planning_problems" USING btree ("problem_id","problem_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "interface_planning_problem_digest_uniq" ON "interface_planning_problems" USING btree ("problem_digest");
--> statement-breakpoint
CREATE INDEX "interface_planning_problem_project_idx" ON "interface_planning_problems" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "interface_planning_candidates" (
  "candidate_id" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "revision" integer NOT NULL,
  "candidate_digest" text NOT NULL, "problem_digest" text NOT NULL, "structural_signature" text NOT NULL, "feasibility_state" text NOT NULL,
  "candidate" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "interface_planning_candidate_identity" ON "interface_planning_candidates" USING btree ("candidate_id","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "interface_planning_candidate_digest_uniq" ON "interface_planning_candidates" USING btree ("candidate_digest");
--> statement-breakpoint
CREATE INDEX "interface_planning_candidate_problem_idx" ON "interface_planning_candidates" USING btree ("tenant_id","project_id","branch_id","problem_digest");
--> statement-breakpoint
CREATE TABLE "interface_selection_decisions" (
  "decision_id" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL,
  "candidate_id" text NOT NULL, "candidate_digest" text NOT NULL, "problem_digest" text NOT NULL, "approver_actor_id" text NOT NULL,
  "decision_digest" text NOT NULL, "decision" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "interface_selection_decision_digest_uniq" ON "interface_selection_decisions" USING btree ("decision_digest");
--> statement-breakpoint
CREATE INDEX "interface_selection_decision_project_idx" ON "interface_selection_decisions" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "interface_pin_fact_snapshots" (
  "snapshot_id" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL,
  "atomic_part_revision_id" text NOT NULL, "package_revision_id" text NOT NULL, "snapshot_digest" text NOT NULL,
  "snapshot" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "interface_pin_fact_snapshot_digest_uniq" ON "interface_pin_fact_snapshots" USING btree ("snapshot_digest");
--> statement-breakpoint
CREATE INDEX "interface_pin_fact_snapshot_project_idx" ON "interface_pin_fact_snapshots" USING btree ("tenant_id","project_id","created_at");
--> statement-breakpoint
CREATE TABLE "interface_pin_allocations" (
  "allocation_candidate_id" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL,
  "interface_candidate_id" text NOT NULL, "allocation_problem_id" text NOT NULL, "allocation_digest" text NOT NULL,
  "feasibility_state" text NOT NULL, "allocation" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "interface_pin_allocation_digest_uniq" ON "interface_pin_allocations" USING btree ("allocation_digest");
--> statement-breakpoint
CREATE INDEX "interface_pin_allocation_candidate_idx" ON "interface_pin_allocations" USING btree ("tenant_id","project_id","branch_id","interface_candidate_id");
--> statement-breakpoint
CREATE TABLE "interface_transaction_records" (
  "transaction_id" text PRIMARY KEY NOT NULL, "idempotency_key" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL,
  "branch_id" text NOT NULL, "actor_id" text NOT NULL, "status" text NOT NULL, "integrity_digest" text NOT NULL,
  "record" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "interface_transaction_idempotency_uniq" ON "interface_transaction_records" USING btree ("tenant_id","project_id","branch_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "interface_transaction_project_idx" ON "interface_transaction_records" USING btree ("tenant_id","project_id","branch_id","created_at");
