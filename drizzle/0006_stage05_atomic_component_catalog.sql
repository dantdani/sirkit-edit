CREATE TABLE "atomic_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"event" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atomic_cad_assets" (
	"version_id" text PRIMARY KEY NOT NULL,
	"logical_asset_id" text NOT NULL,
	"kind" text NOT NULL,
	"content_hash" text NOT NULL,
	"semantic_hash" text NOT NULL,
	"source_record_id" text NOT NULL,
	"license_id" text NOT NULL,
	"validation_state" text NOT NULL,
	"raw_object_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atomic_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"property" text NOT NULL,
	"facet" text NOT NULL,
	"state" text NOT NULL,
	"claim" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atomic_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"source_record_id" text NOT NULL,
	"locator" text NOT NULL,
	"record" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atomic_exact_parts" (
	"id" text PRIMARY KEY NOT NULL,
	"manufacturer_id" text NOT NULL,
	"exact_mpn" text NOT NULL,
	"normalized_search_key" text NOT NULL,
	"family_id" text,
	"state" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atomic_families" (
	"id" text PRIMARY KEY NOT NULL,
	"manufacturer_id" text NOT NULL,
	"published_name" text NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atomic_generic_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atomic_guidance" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"status" text NOT NULL,
	"guidance" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atomic_licenses" (
	"id" text PRIMARY KEY NOT NULL,
	"spdx_id" text,
	"disposition" text NOT NULL,
	"record" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atomic_manufacturers" (
	"id" text PRIMARY KEY NOT NULL,
	"canonical_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"official_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atomic_mapping_certificates" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol_version_id" text NOT NULL,
	"footprint_version_id" text NOT NULL,
	"state" text NOT NULL,
	"semantic_hash" text NOT NULL,
	"certificate" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atomic_offer_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_part_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atomic_part_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"logical_part_id" text NOT NULL,
	"revision" integer NOT NULL,
	"exact_part_id" text,
	"generic_device_id" text,
	"publication_state" text NOT NULL,
	"semantic_hash" text NOT NULL,
	"revision_data" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "atomic_part_identity_xor" CHECK (("atomic_part_revisions"."exact_part_id" IS NULL) <> ("atomic_part_revisions"."generic_device_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "atomic_selections" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"component_instance_id" text NOT NULL,
	"atomic_revision_id" text NOT NULL,
	"selection" jsonb NOT NULL,
	"offline_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atomic_source_records" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"revision" text NOT NULL,
	"content_hash" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"record" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atomic_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"source_class" text NOT NULL,
	"name" text NOT NULL,
	"official_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"license_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atomic_supplier_parts" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"supplier_sku" text NOT NULL,
	"exact_part_id" text NOT NULL,
	"packaging" text NOT NULL,
	"region" text,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "atomic_cad_assets" ADD CONSTRAINT "atomic_cad_assets_source_record_id_atomic_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."atomic_source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atomic_cad_assets" ADD CONSTRAINT "atomic_cad_assets_license_id_atomic_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."atomic_licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atomic_evidence" ADD CONSTRAINT "atomic_evidence_source_record_id_atomic_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."atomic_source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atomic_exact_parts" ADD CONSTRAINT "atomic_exact_parts_manufacturer_id_atomic_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."atomic_manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atomic_exact_parts" ADD CONSTRAINT "atomic_exact_parts_family_id_atomic_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."atomic_families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atomic_families" ADD CONSTRAINT "atomic_families_manufacturer_id_atomic_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."atomic_manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atomic_mapping_certificates" ADD CONSTRAINT "atomic_mapping_certificates_symbol_version_id_atomic_cad_assets_version_id_fk" FOREIGN KEY ("symbol_version_id") REFERENCES "public"."atomic_cad_assets"("version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atomic_mapping_certificates" ADD CONSTRAINT "atomic_mapping_certificates_footprint_version_id_atomic_cad_assets_version_id_fk" FOREIGN KEY ("footprint_version_id") REFERENCES "public"."atomic_cad_assets"("version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atomic_offer_snapshots" ADD CONSTRAINT "atomic_offer_snapshots_supplier_part_id_atomic_supplier_parts_id_fk" FOREIGN KEY ("supplier_part_id") REFERENCES "public"."atomic_supplier_parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atomic_part_revisions" ADD CONSTRAINT "atomic_part_revisions_exact_part_id_atomic_exact_parts_id_fk" FOREIGN KEY ("exact_part_id") REFERENCES "public"."atomic_exact_parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atomic_selections" ADD CONSTRAINT "atomic_selections_atomic_revision_id_atomic_part_revisions_id_fk" FOREIGN KEY ("atomic_revision_id") REFERENCES "public"."atomic_part_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atomic_source_records" ADD CONSTRAINT "atomic_source_records_source_id_atomic_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."atomic_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atomic_sources" ADD CONSTRAINT "atomic_sources_license_id_atomic_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."atomic_licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atomic_supplier_parts" ADD CONSTRAINT "atomic_supplier_parts_exact_part_id_atomic_exact_parts_id_fk" FOREIGN KEY ("exact_part_id") REFERENCES "public"."atomic_exact_parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "atomic_audit_object_idx" ON "atomic_audit_events" USING btree ("object_type","object_id","at");--> statement-breakpoint
CREATE INDEX "atomic_cad_logical_version_idx" ON "atomic_cad_assets" USING btree ("logical_asset_id","version_id");--> statement-breakpoint
CREATE INDEX "atomic_cad_content_idx" ON "atomic_cad_assets" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "atomic_claim_property_state_idx" ON "atomic_claims" USING btree ("property","state");--> statement-breakpoint
CREATE INDEX "atomic_evidence_source_idx" ON "atomic_evidence" USING btree ("source_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "atomic_exact_part_identity_uniq" ON "atomic_exact_parts" USING btree ("manufacturer_id","exact_mpn");--> statement-breakpoint
CREATE INDEX "atomic_exact_part_search_idx" ON "atomic_exact_parts" USING btree ("normalized_search_key");--> statement-breakpoint
CREATE UNIQUE INDEX "atomic_family_identity_uniq" ON "atomic_families" USING btree ("manufacturer_id","published_name");--> statement-breakpoint
CREATE INDEX "atomic_guidance_category_status_idx" ON "atomic_guidance" USING btree ("category","status");--> statement-breakpoint
CREATE UNIQUE INDEX "atomic_manufacturer_name_uniq" ON "atomic_manufacturers" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "atomic_mapping_bundle_idx" ON "atomic_mapping_certificates" USING btree ("symbol_version_id","footprint_version_id","state");--> statement-breakpoint
CREATE INDEX "atomic_offer_freshness_idx" ON "atomic_offer_snapshots" USING btree ("supplier_part_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "atomic_part_logical_revision_uniq" ON "atomic_part_revisions" USING btree ("logical_part_id","revision");--> statement-breakpoint
CREATE INDEX "atomic_part_publication_idx" ON "atomic_part_revisions" USING btree ("publication_state");--> statement-breakpoint
CREATE INDEX "atomic_selection_project_component_idx" ON "atomic_selections" USING btree ("project_id","component_instance_id");--> statement-breakpoint
CREATE INDEX "atomic_source_content_idx" ON "atomic_source_records" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "atomic_source_revision_uniq" ON "atomic_source_records" USING btree ("source_id","revision","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "atomic_supplier_sku_uniq" ON "atomic_supplier_parts" USING btree ("supplier_id","supplier_sku","region");