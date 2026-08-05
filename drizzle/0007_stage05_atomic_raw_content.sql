CREATE TABLE "atomic_raw_objects" (
	"id" text PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"media_type" text NOT NULL,
	"encoding" text NOT NULL,
	"content" text NOT NULL,
	"bytes" integer NOT NULL,
	"license_id" text NOT NULL,
	"confidential" boolean DEFAULT false NOT NULL,
	"record" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "atomic_raw_objects" ADD CONSTRAINT "atomic_raw_objects_license_id_atomic_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."atomic_licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "atomic_raw_content_idx" ON "atomic_raw_objects" USING btree ("content_hash");--> statement-breakpoint
ALTER TABLE "atomic_cad_assets" ADD CONSTRAINT "atomic_cad_assets_raw_object_id_atomic_raw_objects_id_fk" FOREIGN KEY ("raw_object_id") REFERENCES "public"."atomic_raw_objects"("id") ON DELETE no action ON UPDATE no action;