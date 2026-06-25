ALTER TABLE "parts" ADD COLUMN "is_generic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "parts_is_generic_idx" ON "parts" USING btree ("is_generic");