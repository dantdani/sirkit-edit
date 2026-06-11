/**
 * Drizzle schema for the KiCad parts data layer.
 *
 * This file is the single source of truth for the shape of the data. Other
 * modules (ingestion script, search API) derive their row types from the
 * inferred `$inferSelect` / `$inferInsert` types exported at the bottom.
 */

import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import type { KicadPin } from "../kicad/types";
import { EMBEDDING_DIMENSIONS } from "../embeddings";

/**
 * A KiCad symbol library file (one `.kicad_sym`), e.g. "Device" or
 * "MCU_Espressif". `fileHash` lets ingestion skip libraries that haven't
 * changed since the last run.
 */
export const libraries = pgTable("libraries", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** KiCad library basename, e.g. "Device", "MCU_ST_STM32F4". */
  name: text("name").notNull().unique(),
  /** User-facing top-level category, e.g. "Microcontrollers". */
  mainCategory: text("main_category").notNull(),
  /** SHA-256 of the source `.kicad_sym` at ingest time (change detection). */
  fileHash: text("file_hash"),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow(),
});

/** A single part/symbol within a library. */
export const parts = pgTable(
  "parts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    libraryId: uuid("library_id")
      .notNull()
      .references(() => libraries.id, { onDelete: "cascade" }),
    /** KiCad symbol name, e.g. "ATmega328P-AU". */
    name: text("name").notNull(),
    description: text("description"),
    /** From `ki_keywords` — space-separated, kept as-is for full-text use. */
    keywords: text("keywords"),
    /** Manufacturer part number, if present. */
    mpn: text("mpn"),
    manufacturer: text("manufacturer"),
    /** Datasheet URL, if present. */
    datasheet: text("datasheet"),
    /** Suggested footprint reference, if present. */
    footprintHint: text("footprint_hint"),
    /** ALL KiCad properties verbatim, for future use. */
    properties: jsonb("properties").$type<Record<string, string>>().notNull(),
    /** Structured pin list. */
    pins: jsonb("pins").$type<KicadPin[]>().notNull(),
    /** Full S-expression source of this symbol, for re-rendering later. */
    symbolRaw: text("symbol_raw").notNull(),
    /** OpenAI text-embedding-3-small vector. */
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    libraryIdx: index("parts_library_idx").on(table.libraryId),
    embeddingIdx: index("parts_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    nameIdx: index("parts_name_idx").on(table.name),
    /** Upsert key — one row per (library, symbol name). */
    libraryNameUniq: uniqueIndex("parts_library_name_uniq").on(
      table.libraryId,
      table.name,
    ),
  }),
);

// ─── Inferred row types (consumed across the codebase) ──────────────────────

export type Library = typeof libraries.$inferSelect;
export type NewLibrary = typeof libraries.$inferInsert;
export type Part = typeof parts.$inferSelect;
export type NewPart = typeof parts.$inferInsert;
