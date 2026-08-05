CREATE TABLE "constraint_evaluations" (
	"evaluation_hash" text PRIMARY KEY NOT NULL,
	"program_hash" text NOT NULL,
	"design_revision" text NOT NULL,
	"readiness_state" text NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "constraint_program_activations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"program_hash" text NOT NULL,
	"previous_program_hash" text,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "constraint_programs" (
	"program_hash" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"design_revision" text NOT NULL,
	"catalog_revision" text NOT NULL,
	"variant_revision" text NOT NULL,
	"manufacturing_profile_revision" text NOT NULL,
	"compiler_version" text NOT NULL,
	"merge_policy_version" text NOT NULL,
	"program" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "constraint_set_revisions" (
	"id" text NOT NULL,
	"revision" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"semantic_hash" text NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "constraint_waivers" (
	"id" text PRIMARY KEY NOT NULL,
	"program_hash" text NOT NULL,
	"design_revision" text NOT NULL,
	"release_profile_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"authorized_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"waiver" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "constraint_evaluations" ADD CONSTRAINT "constraint_evaluations_program_hash_constraint_programs_program_hash_fk" FOREIGN KEY ("program_hash") REFERENCES "public"."constraint_programs"("program_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constraint_program_activations" ADD CONSTRAINT "constraint_program_activations_program_hash_constraint_programs_program_hash_fk" FOREIGN KEY ("program_hash") REFERENCES "public"."constraint_programs"("program_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constraint_waivers" ADD CONSTRAINT "constraint_waivers_program_hash_constraint_programs_program_hash_fk" FOREIGN KEY ("program_hash") REFERENCES "public"."constraint_programs"("program_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "constraint_evaluation_program_idx" ON "constraint_evaluations" USING btree ("program_hash","design_revision");--> statement-breakpoint
CREATE INDEX "constraint_activation_project_idx" ON "constraint_program_activations" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "constraint_program_project_revision_idx" ON "constraint_programs" USING btree ("project_id","design_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "constraint_set_revision_identity" ON "constraint_set_revisions" USING btree ("id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "constraint_set_revision_hash_uniq" ON "constraint_set_revisions" USING btree ("semantic_hash");--> statement-breakpoint
CREATE INDEX "constraint_waiver_scope_idx" ON "constraint_waivers" USING btree ("program_hash","design_revision","release_profile_id");