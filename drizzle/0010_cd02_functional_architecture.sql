CREATE TABLE "architecture_problems" (
	"problem_id" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL,
	"problem_digest" text NOT NULL, "requirements_package_digest" text NOT NULL, "compiler_version" text NOT NULL, "problem" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "architecture_problem_identity" ON "architecture_problems" USING btree ("problem_id","problem_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "architecture_problem_digest_uniq" ON "architecture_problems" USING btree ("problem_digest");
--> statement-breakpoint
CREATE INDEX "architecture_problem_project_idx" ON "architecture_problems" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "architecture_candidates" (
	"candidate_id" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "lineage_id" text NOT NULL, "revision" integer NOT NULL,
	"candidate_digest" text NOT NULL, "problem_digest" text NOT NULL, "structural_signature" text NOT NULL, "status" text NOT NULL, "candidate" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "architecture_candidate_identity" ON "architecture_candidates" USING btree ("candidate_id","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "architecture_candidate_digest_uniq" ON "architecture_candidates" USING btree ("candidate_digest");
--> statement-breakpoint
CREATE INDEX "architecture_candidate_problem_idx" ON "architecture_candidates" USING btree ("tenant_id","project_id","branch_id","problem_digest");
--> statement-breakpoint
CREATE TABLE "architecture_comparisons" (
	"comparison_id" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL,
	"problem_digest" text NOT NULL, "comparison_digest" text NOT NULL, "comparison" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "architecture_comparison_digest_uniq" ON "architecture_comparisons" USING btree ("comparison_digest");
--> statement-breakpoint
CREATE INDEX "architecture_comparison_project_idx" ON "architecture_comparisons" USING btree ("tenant_id","project_id","branch_id");
--> statement-breakpoint
CREATE TABLE "architecture_selection_decisions" (
	"decision_id" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL,
	"candidate_id" text NOT NULL, "candidate_digest" text NOT NULL, "problem_digest" text NOT NULL, "approver_actor_id" text NOT NULL,
	"decision_digest" text NOT NULL, "decision" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "architecture_selection_digest_uniq" ON "architecture_selection_decisions" USING btree ("decision_digest");
--> statement-breakpoint
CREATE INDEX "architecture_selection_project_idx" ON "architecture_selection_decisions" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "architecture_transaction_records" (
	"transaction_id" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL,
	"actor_id" text NOT NULL, "status" text NOT NULL, "integrity_digest" text NOT NULL, "record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "architecture_transaction_project_idx" ON "architecture_transaction_records" USING btree ("tenant_id","project_id","branch_id","created_at");
