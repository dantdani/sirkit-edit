CREATE TABLE "power_upstream_signoffs" (
  "signoff_digest" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL,
  "requirements_digest" text NOT NULL, "architecture_candidate_digest" text NOT NULL, "architecture_decision_digest" text NOT NULL,
  "approver_actor_id" text NOT NULL, "signoff" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "power_upstream_signoff_project_idx" ON "power_upstream_signoffs" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "power_architecture_problems" (
  "problem_id" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "problem_digest" text NOT NULL,
  "requirements_digest" text NOT NULL, "architecture_candidate_digest" text NOT NULL, "upstream_signoff_digest" text NOT NULL,
  "compiler_version" text NOT NULL, "problem" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "power_architecture_problem_identity" ON "power_architecture_problems" USING btree ("problem_id","problem_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "power_architecture_problem_digest_uniq" ON "power_architecture_problems" USING btree ("problem_digest");
--> statement-breakpoint
CREATE INDEX "power_architecture_problem_project_idx" ON "power_architecture_problems" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "power_architecture_candidates" (
  "candidate_id" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "revision" integer NOT NULL,
  "candidate_digest" text NOT NULL, "problem_digest" text NOT NULL, "structural_signature" text NOT NULL, "feasibility_state" text NOT NULL,
  "candidate" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "power_architecture_candidate_identity" ON "power_architecture_candidates" USING btree ("candidate_id","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "power_architecture_candidate_digest_uniq" ON "power_architecture_candidates" USING btree ("candidate_digest");
--> statement-breakpoint
CREATE INDEX "power_architecture_candidate_problem_idx" ON "power_architecture_candidates" USING btree ("tenant_id","project_id","branch_id","problem_digest");
--> statement-breakpoint
CREATE TABLE "power_selection_decisions" (
  "decision_id" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL,
  "candidate_id" text NOT NULL, "candidate_digest" text NOT NULL, "problem_digest" text NOT NULL, "approver_actor_id" text NOT NULL,
  "decision_digest" text NOT NULL, "decision" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "power_selection_decision_digest_uniq" ON "power_selection_decisions" USING btree ("decision_digest");
--> statement-breakpoint
CREATE INDEX "power_selection_decision_project_idx" ON "power_selection_decisions" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "power_transaction_records" (
  "transaction_id" text PRIMARY KEY NOT NULL, "idempotency_key" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL,
  "branch_id" text NOT NULL, "actor_id" text NOT NULL, "status" text NOT NULL, "integrity_digest" text NOT NULL,
  "record" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "power_transaction_idempotency_uniq" ON "power_transaction_records" USING btree ("tenant_id","project_id","branch_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "power_transaction_project_idx" ON "power_transaction_records" USING btree ("tenant_id","project_id","branch_id","created_at");
