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
  boolean,
  timestamp,
  index,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { KicadPin } from "../kicad/types";
import type { SnapshotRow, BomSnapshotMeta } from "../snapshots";
import type { Pad, FootprintModelRef } from "../pcb/types";
import type { BBox } from "../pcb/geometry";
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
    /**
     * True for KiCad generic template symbols (Device.R, Connector_Generic_*,
     * power ports, …) that have no orderable MPN. The Build-mode AI search
     * excludes these by default so the model only picks buyable parts.
     */
    isGeneric: boolean("is_generic").default(false).notNull(),
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
    /** Fast `WHERE is_generic = false` filtering in AI/browse search. */
    isGenericIdx: index("parts_is_generic_idx").on(table.isGeneric),
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
    /** Per-distributor lifecycle, normalized (Stage 3). */
    lifecycleStatus: text("lifecycle_status")
      .$type<"active" | "nrnd" | "last_time_buy" | "eol" | "obsolete" | "unknown">()
      .default("unknown"),
    /** The distributor's original lifecycle term, kept for debugging. */
    lifecycleRaw: text("lifecycle_raw"),
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

/**
 * A point-in-time capture of a BOM's supply-chain state (Stage 7). Stores a
 * compact SnapshotRow array — NOT the full SchematicState.
 */
export const bomSnapshots = pgTable(
  "bom_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Arbitrary identifier the caller provides (project id or state hash). */
    projectKey: text("project_key").notNull(),
    /** Optional user-facing label, e.g. "Pre-EVT 2026-06-24". */
    label: text("label"),
    takenAt: timestamp("taken_at", { withTimezone: true }).defaultNow().notNull(),
    /** Serialized SnapshotRow[]. */
    snapshotData: jsonb("snapshot_data").$type<SnapshotRow[]>().notNull().default([]),
    /** Small summary: totals + design risk. */
    bomMeta: jsonb("bom_meta").$type<BomSnapshotMeta>().notNull(),
  },
  (table) => ({
    /** "list recent snapshots for project". */
    projectKeyIdx: index("bom_snapshots_project_idx").on(table.projectKey, table.takenAt.desc()),
  }),
);

/**
 * Supply-chain change notifications (Stage 7), produced by diffing a project's
 * latest snapshot against refreshed market data.
 */
export const bomNotifications = pgTable(
  "bom_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectKey: text("project_key").notNull(),
    /** The snapshot the diff was made against. */
    sourceSnapshotId: uuid("source_snapshot_id").references(() => bomSnapshots.id, {
      onDelete: "set null",
    }),
    type: text("type")
      .$type<
        | "stock_dropped"
        | "lifecycle_changed"
        | "price_spike"
        | "alternate_available"
        | "alternate_obsolete"
        | "supplier_lost"
      >()
      .notNull(),
    severity: text("severity").$type<"info" | "warning" | "critical">().notNull(),
    partId: uuid("part_id").references(() => parts.id, { onDelete: "cascade" }),
    /** Human-readable, ≤200 chars. */
    summary: text("summary").notNull(),
    /** Structured before/after data. */
    detailsJson: jsonb("details_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (table) => ({
    /** Fast unread lookup (partial). */
    unreadIdx: index("bom_notifications_unread_idx")
      .on(table.projectKey, table.readAt)
      .where(sql`${table.readAt} IS NULL`),
    createdAtIdx: index("bom_notifications_created_idx").on(
      table.projectKey,
      table.createdAt.desc(),
    ),
  }),
);

/**
 * KiCad official footprint library (PCB Stage 2), ingested from
 * https://github.com/KiCad/kicad-footprints (CC-BY-SA 4.0 with KiCad Libraries
 * Exception). `source` distinguishes future LCSC/EasyEDA-converted footprints
 * from the official set without a migration.
 */
export const pcbFootprints = pgTable(
  "pcb_footprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Library (`.pretty` dir basename), e.g. "Resistor_SMD". */
    libName: text("lib_name").notNull(),
    /** Footprint name, e.g. "R_0805_2012Metric". */
    name: text("name").notNull(),
    description: text("description"),
    tags: text("tags"),
    attrSmd: boolean("attr_smd").notNull().default(false),
    attrTht: boolean("attr_tht").notNull().default(false),
    /** Electrical pads (pads with a non-empty number; NPTH excluded). */
    padCount: integer("pad_count").notNull(),
    smdPadCount: integer("smd_pad_count").notNull().default(0),
    thtPadCount: integer("tht_pad_count").notNull().default(0),
    /** Pad[] per app/lib/pcb/types.ts — integer-nanometer coordinates. */
    pads: jsonb("pads").$type<Pad[]>().notNull(),
    courtyardBbox: jsonb("courtyard_bbox").$type<BBox>(),
    bodyBbox: jsonb("body_bbox").$type<BBox>().notNull(),
    models: jsonb("models").$type<FootprintModelRef[]>().notNull().default([]),
    /** VERBATIM file content — Stage 13 re-emits this; never reformat. */
    rawSexpr: text("raw_sexpr").notNull(),
    source: text("source").notNull().default("kicad-footprints"),
    /** Git SHA of the ingested kicad-footprints checkout. */
    sourceCommit: text("source_commit").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    embeddingIdx: index("pcb_footprints_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    /** Serves trigram similarity on "Lib:Name" in the hybrid search re-rank. */
    trgmIdx: index("pcb_footprints_trgm_idx").using(
      "gin",
      sql`(${table.libName} || ':' || ${table.name}) gin_trgm_ops`,
    ),
    padCountIdx: index("pcb_footprints_pad_count_idx").on(table.padCount),
    /** Upsert key — one row per (source, library, footprint name). */
    sourceLibNameUniq: uniqueIndex("pcb_footprints_source_lib_name_uniq").on(
      table.source,
      table.libName,
      table.name,
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
export type BomSnapshotRecord = typeof bomSnapshots.$inferSelect;
export type NewBomSnapshot = typeof bomSnapshots.$inferInsert;
export type BomNotification = typeof bomNotifications.$inferSelect;
export type NewBomNotification = typeof bomNotifications.$inferInsert;
export type PcbFootprint = typeof pcbFootprints.$inferSelect;
export type NewPcbFootprint = typeof pcbFootprints.$inferInsert;
