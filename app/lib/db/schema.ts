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
  integer,
  timestamp,
  index,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { KicadPin } from "../kicad/types";
import { EMBEDDING_DIMENSIONS } from "../embeddings";

/**
 * Category-dependent "key specs" extracted from a part's text/properties.
 * The discriminant `kind` selects which fields are meaningful; `{}` (empty) is
 * the not-yet-backfilled default.
 */
export type KeySpecs =
  | { kind: "resistor"; resistance?: string; tolerance?: string; powerRating?: string }
  | { kind: "capacitor"; capacitance?: string; tolerance?: string; voltageRating?: string; dielectric?: string }
  | { kind: "inductor"; inductance?: string; currentRating?: string; tolerance?: string }
  | { kind: "diode"; forwardVoltage?: string; reverseVoltage?: string; currentRating?: string }
  | { kind: "ic"; pinCount?: number; supplyVoltageMin?: string; supplyVoltageMax?: string }
  | { kind: "unknown" }
  | Record<string, never>;

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

    // ── BOM data-model extension (Stage 1) ──────────────────────────────────
    /** Uppercased, alphanumeric-only MPN for fuzzy distributor matching. */
    normalizedMpn: text("normalized_mpn"),
    /** SIRKIT-CAT-VALUE-PKG style id; groups equivalent parts in the BOM. */
    internalPartNumber: text("internal_part_number"),
    /** Lifecycle state; "active"/"unknown" until Stage 3 fills real data. */
    lifecycleStatus: text("lifecycle_status")
      .$type<"active" | "nrnd" | "last_time_buy" | "eol" | "obsolete" | "unknown">()
      .default("unknown"),
    /** RoHS compliance; "unknown" until Stage 3 fills it from distributors. */
    rohsStatus: text("rohs_status")
      .$type<"compliant" | "non_compliant" | "unknown">()
      .default("unknown"),
    /** Canonical package name, e.g. "0805", "SOT-23", "TQFP-32". */
    packageNormalized: text("package_normalized"),
    /** Category-dependent extracted specs (see KeySpecs). */
    keySpecs: jsonb("key_specs").$type<KeySpecs>().default({}),
    /** When the per-part normalized data was last refreshed. */
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),

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
    /** Fast MPN lookup from distributor APIs; partial so null MPNs don't clash. */
    normalizedMpnUniq: uniqueIndex("parts_normalized_mpn_uniq")
      .on(table.normalizedMpn)
      .where(sql`${table.normalizedMpn} IS NOT NULL`),
  }),
);

/**
 * Cached distributor pricing/stock so the BOM endpoint doesn't always hit live
 * APIs. One row per (part, distributor); refreshed by Stage 2.
 */
export const partOffers = pgTable(
  "part_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    /** "digikey" | "mouser" | "octopart" | "lcsc". */
    distributor: text("distributor").notNull(),
    distributorSku: text("distributor_sku"),
    priceBreaks: jsonb("price_breaks")
      .$type<Array<{ qty: number; price: number; currency: string }>>()
      .notNull()
      .default([]),
    stock: integer("stock"),
    minOrderQty: integer("min_order_qty"),
    leadTimeDays: integer("lead_time_days"),
    productUrl: text("product_url"),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    /** One offer row per part per distributor. */
    partDistributorIdx: uniqueIndex("part_offers_part_distributor_uniq").on(
      table.partId,
      table.distributor,
    ),
    partIdx: index("part_offers_part_idx").on(table.partId),
    /** Drives "find stale offers to refresh". */
    refreshedIdx: index("part_offers_refreshed_idx").on(table.lastRefreshedAt),
  }),
);

/**
 * Precomputed part-substitution relationships for the Stage 4 alternates
 * engine. Empty in Stage 1; populated by a future script.
 */
export const alternates = pgTable(
  "alternates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    alternatePartId: uuid("alternate_part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"exact" | "drop_in" | "fff" | "substitute">().notNull(),
    /** 0-100, higher = better match. */
    score: integer("score").notNull(),
    /** Human-readable reasons, e.g. ["same package", "different manufacturer"]. */
    matchReasons: jsonb("match_reasons").$type<string[]>().notNull().default([]),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    /** "find all drop-in alternates for this part". */
    partKindIdx: index("alternates_part_kind_idx").on(table.partId, table.kind),
    uniquePair: uniqueIndex("alternates_pair_uniq").on(
      table.partId,
      table.alternatePartId,
    ),
  }),
);

// ─── Inferred row types (consumed across the codebase) ──────────────────────

export type Library = typeof libraries.$inferSelect;
export type NewLibrary = typeof libraries.$inferInsert;
export type Part = typeof parts.$inferSelect;
export type NewPart = typeof parts.$inferInsert;
export type PartOffer = typeof partOffers.$inferSelect;
export type NewPartOffer = typeof partOffers.$inferInsert;
export type Alternate = typeof alternates.$inferSelect;
export type NewAlternate = typeof alternates.$inferInsert;
