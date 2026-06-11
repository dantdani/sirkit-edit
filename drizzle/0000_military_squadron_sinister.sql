CREATE TABLE "libraries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"main_category" text NOT NULL,
	"file_hash" text,
	"ingested_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "libraries_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"keywords" text,
	"mpn" text,
	"manufacturer" text,
	"datasheet" text,
	"footprint_hint" text,
	"properties" jsonb NOT NULL,
	"pins" jsonb NOT NULL,
	"symbol_raw" text NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parts_library_idx" ON "parts" USING btree ("library_id");--> statement-breakpoint
CREATE INDEX "parts_embedding_idx" ON "parts" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "parts_name_idx" ON "parts" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "parts_library_name_uniq" ON "parts" USING btree ("library_id","name");