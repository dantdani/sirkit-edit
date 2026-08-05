CREATE TABLE "circuit_knowledge_upstream_signoffs" ("signoff_digest" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "approver_actor_id" text NOT NULL, "signoff" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE INDEX "circuit_knowledge_signoff_project_idx" ON "circuit_knowledge_upstream_signoffs" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "circuit_knowledge_pcb_foundation_signoffs" ("signoff_digest" text PRIMARY KEY NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "approver_actor_id" text NOT NULL, "signoff" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE INDEX "circuit_knowledge_pcb_foundation_project_idx" ON "circuit_knowledge_pcb_foundation_signoffs" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "circuit_knowledge_problems" ("problem_id" text NOT NULL, "problem_digest" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "upstream_signoff_digest" text NOT NULL, "problem" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_knowledge_problem_identity" ON "circuit_knowledge_problems" USING btree ("problem_id","problem_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_knowledge_problem_digest_uniq" ON "circuit_knowledge_problems" USING btree ("problem_digest");
--> statement-breakpoint
CREATE INDEX "circuit_knowledge_problem_project_idx" ON "circuit_knowledge_problems" USING btree ("tenant_id","project_id","branch_id","created_at");
--> statement-breakpoint
CREATE TABLE "circuit_recipe_source_bundles" ("source_bundle_id" text NOT NULL, "source_bundle_digest" text NOT NULL, "tenant_id" text NOT NULL, "visibility" text NOT NULL, "bundle" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_recipe_source_bundle_identity" ON "circuit_recipe_source_bundles" USING btree ("source_bundle_id","source_bundle_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_recipe_source_bundle_digest_uniq" ON "circuit_recipe_source_bundles" USING btree ("source_bundle_digest");
--> statement-breakpoint
CREATE TABLE "circuit_recipe_definitions" ("recipe_id" text NOT NULL, "revision_id" text PRIMARY KEY NOT NULL, "semantic_version" text NOT NULL, "lifecycle_state" text NOT NULL, "semantic_role" text NOT NULL, "deterministic_digest" text NOT NULL, "recipe" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_recipe_definition_digest_uniq" ON "circuit_recipe_definitions" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "circuit_recipe_definition_role_idx" ON "circuit_recipe_definitions" USING btree ("semantic_role","lifecycle_state");
--> statement-breakpoint
CREATE TABLE "compiled_circuit_recipes" ("compiled_recipe_id" text PRIMARY KEY NOT NULL, "recipe_revision_id" text NOT NULL, "compiler_version" text NOT NULL, "deterministic_digest" text NOT NULL, "publication_eligible" boolean NOT NULL, "compiled" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "compiled_circuit_recipe_digest_uniq" ON "compiled_circuit_recipes" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE INDEX "compiled_circuit_recipe_revision_idx" ON "compiled_circuit_recipes" USING btree ("recipe_revision_id","compiler_version");
--> statement-breakpoint
CREATE TABLE "circuit_recipe_libraries" ("library_id" text NOT NULL, "revision" integer NOT NULL, "deterministic_digest" text NOT NULL, "library" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_recipe_library_identity" ON "circuit_recipe_libraries" USING btree ("library_id","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_recipe_library_digest_uniq" ON "circuit_recipe_libraries" USING btree ("deterministic_digest");
--> statement-breakpoint
CREATE TABLE "circuit_knowledge_transaction_records" ("transaction_id" text PRIMARY KEY NOT NULL, "idempotency_key" text NOT NULL, "tenant_id" text NOT NULL, "project_id" text NOT NULL, "branch_id" text NOT NULL, "actor_id" text NOT NULL, "status" text NOT NULL, "integrity_digest" text NOT NULL, "record" jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX "circuit_knowledge_transaction_idempotency_uniq" ON "circuit_knowledge_transaction_records" USING btree ("tenant_id","project_id","branch_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "circuit_knowledge_transaction_project_idx" ON "circuit_knowledge_transaction_records" USING btree ("tenant_id","project_id","branch_id","created_at");
