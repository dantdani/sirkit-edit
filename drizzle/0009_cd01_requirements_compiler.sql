CREATE TABLE "requirement_source_revisions" (
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_id" text NOT NULL,
	"source_version" text NOT NULL,
	"artifact_digest" text NOT NULL,
	"access_policy" text NOT NULL,
	"privacy_classification" text NOT NULL,
	"artifact" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_source_revision_identity" ON "requirement_source_revisions" USING btree ("tenant_id","project_id","source_id","source_version");
--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_source_revision_digest_uniq" ON "requirement_source_revisions" USING btree ("artifact_digest");
--> statement-breakpoint
CREATE INDEX "requirement_source_project_idx" ON "requirement_source_revisions" USING btree ("tenant_id","project_id","created_at");
--> statement-breakpoint
CREATE TABLE "design_requirement_packages" (
	"package_id" text NOT NULL,
	"project_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"revision" integer NOT NULL,
	"package_digest" text NOT NULL,
	"source_set_digest" text NOT NULL,
	"status" text NOT NULL,
	"compiler_version" text NOT NULL,
	"package" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "design_requirement_package_identity" ON "design_requirement_packages" USING btree ("package_id","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "design_requirement_package_digest_uniq" ON "design_requirement_packages" USING btree ("package_digest");
--> statement-breakpoint
CREATE INDEX "design_requirement_package_project_idx" ON "design_requirement_packages" USING btree ("tenant_id","project_id","revision");
--> statement-breakpoint
CREATE TABLE "requirement_transaction_records" (
	"transaction_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"package_revision" integer,
	"actor_id" text NOT NULL,
	"status" text NOT NULL,
	"integrity_digest" text NOT NULL,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "requirement_transaction_project_revision_idx" ON "requirement_transaction_records" USING btree ("tenant_id","project_id","package_revision");
--> statement-breakpoint
CREATE TABLE "design_capability_profiles" (
	"profile_id" text NOT NULL,
	"version" text NOT NULL,
	"deterministic_digest" text NOT NULL,
	"profile" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "design_capability_profile_identity" ON "design_capability_profiles" USING btree ("profile_id","version");
--> statement-breakpoint
CREATE UNIQUE INDEX "design_capability_profile_digest_uniq" ON "design_capability_profiles" USING btree ("deterministic_digest");
