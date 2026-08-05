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
  check,
  foreignKey,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { KicadPin } from "../kicad/types";
import type { SnapshotRow, BomSnapshotMeta } from "../snapshots";
import type { Pad, FootprintModelRef } from "../pcb/types";
import type { BBox } from "../pcb/geometry";
import { EMBEDDING_DIMENSIONS } from "../embeddings";
import type {
  AtomicPartRevision,
  AuditEvent,
  EngineeringClaim,
  EvidenceRef,
  ApplicationGuidance,
  MappingCertificate,
  LicenseRecord,
  PortableAtomicSnapshot,
  SelectionRecord,
  SourceRecord,
  RawContentObject,
} from "../atomic/types";
import type {
  ConstraintDocument,
  ConstraintEvaluationReport,
  ConstraintProgram,
  ConstraintWaiver,
} from "../constraints/types";
import type {
  DesignCapabilityProfile,
  DesignRequirementsPackage,
  RequirementSourceArtifact,
  RequirementsTransactionRecord,
} from "../requirements/types";
import type {
  ArchitectureComparison,
  ArchitectureProblem,
  ArchitectureSelectionDecision,
  ArchitectureTransactionRecord,
  SystemArchitectureCandidate,
} from "../architecture/types";
import type {
  PowerArchitectureCandidate,
  PowerArchitectureProblem,
  PowerSelectionDecision,
  PowerTransactionRecord,
  UpstreamCompletionSignoff,
} from "../power/types";
import type {
  Cd4UpstreamCompletionSignoff,
  InterfacePlanningCandidate,
  InterfacePlanningDecision,
  InterfacePlanningProblem,
  InterfaceTransactionRecord,
  PinFunctionAllocationCandidate,
  PinFunctionFactSnapshot,
} from "../interfaces/types";
import type {
  Cd5PcbFoundationSignoff,
  Cd5UpstreamCompletionSignoff,
  CircuitKnowledgeProblem,
  CircuitKnowledgeTransactionRecord,
  CircuitRecipeDefinition,
  CircuitRecipeLibrary,
  CompiledCircuitRecipe,
  RecipeSourceBundle,
} from "../circuit-knowledge/types";
import type {
  Cd6UpstreamCompletionSignoff,
  ComponentAlternativePlan,
  ComponentSelectionCandidate,
  ComponentSelectionDecision,
  ComponentSelectionProblem,
  ComponentSelectionTransactionRecord,
  EngineeringCatalogSnapshot,
  PartCompatibilityEvaluation,
  SupplierOfferObservation,
  SupplierSourcingSnapshot,
} from "../component-selection/types";
import type {
  CalculationDecision,
  CalculationDerivationGraph,
  CalculationTransactionRecord,
  Cd7UpstreamCompletionSignoff,
  CircuitCalculationProblem,
  CircuitCalculationReport,
  EquationModelRegistrySnapshot,
} from "../calculation/types";
import type {
  Cd8UpstreamCompletionSignoff,
  KiCadRoundTripCertificate,
  KiCadSchematicArtifactManifest,
  PCBSynchronizationContract,
  SchematicCandidate,
  SchematicCompilationProblem,
  SchematicDecision,
  SchematicDiagramView,
  SchematicSemanticDiff,
  SchematicSemanticGraph,
  SchematicTransactionRecord,
  StructuralCompletenessReport,
} from "../schematic-compiler/types";
import type {
  Cd9UpstreamCompletionSignoff,
  CircuitFinding,
  CircuitReadinessReport,
  CircuitVerificationProjectState,
  CircuitVerificationProblem,
  CircuitWaiver,
  FullOracleRun,
  OracleParityReport,
  RequiredRuleDenominator,
  RuleRegistrySnapshot,
} from "../circuit-verification/types";
import type {
  ModelRegistrySnapshot,
  ModelSimulationProjectState,
  SimulationCampaign,
  SimulationCoverageDenominator,
  SimulationCoverageMatrix,
  SimulationReadinessReport,
  SimulationRun,
  SimulationVerificationProblem,
  TestbenchRegistrySnapshot,
  WaveformArtifact,
} from "../model-simulation/types";
import type { DeviceEvidenceSnapshot, FirmwareBringUpProjectState, FirmwareTestBringUpPackage, FirmwareTestBringUpProblem, Cd11CoverageReport, Cd11ReadinessDecision } from "../firmware-bringup/types";
import type { AuthoritativeBom, HardwareReleaseCandidate, ManufacturingArtifactManifest, ProcurementSnapshot, ReleaseEngineeringProblem, ReleaseEngineeringProjectState, ReleaseLevelAssessment, ReleaseManifest } from "../release-engineering/types";
import type { AutonomousHardwareDesignRun, AutonomousRunFinalVerdict, CandidateGraph, FullFlowProjectState, PinnedRunContext, ReplayBundle, RunEvent, StageInvocation } from "../full-flow/types";
import type { ComponentPhysicalBinding, ComponentPhysicalBindingSet, PhysicalBindingAuditEvent, PhysicalBindingMigrationRecord, PhysicalReadinessAssessment } from "../physical-binding/types";

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
 * Join from the KiCad search catalog (`parts`) to a published atomic part
 * revision. Written only after `publishPortableAtomicSnapshot` succeeds;
 * read by /api/parts/[id] so search results carry the exact `atomicAssignment`
 * (symbol/footprint/mapping authority) that makes generated instances
 * footprint-ready for durable PCB publication.
 */
export const partsAtomicLinks = pgTable(
  "parts_atomic_links",
  {
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    /**
     * Normalized component value ("47k", "1u", …) for value-specific exact
     * parts sharing one symbol; '' is the value-agnostic default link.
     */
    valueKey: text("value_key").notNull().default(""),
    atomicPartRevisionId: text("atomic_part_revision_id").notNull(),
    symbolAssetVersionId: text("symbol_asset_version_id").notNull(),
    footprintAssetVersionId: text("footprint_asset_version_id").notNull(),
    mappingCertificateId: text("mapping_certificate_id").notNull(),
    footprintFullName: text("footprint_full_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.partId, table.valueKey] })],
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

// ── Stage 5: immutable atomic component catalog ─────────────────────────────
// Content-addressed IDs are text, not UUIDs. Legacy `parts`/`pcb_footprints`
// remain as discovery indexes; approval and project pinning use these tables.

export const atomicManufacturers = pgTable("atomic_manufacturers", {
  id: text("id").primaryKey(),
  canonicalName: text("canonical_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
  officialDomains: jsonb("official_domains").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ normalizedNameUniq: uniqueIndex("atomic_manufacturer_name_uniq").on(table.normalizedName) }));

export const atomicFamilies = pgTable("atomic_families", {
  id: text("id").primaryKey(),
  manufacturerId: text("manufacturer_id").notNull().references(() => atomicManufacturers.id),
  publishedName: text("published_name").notNull(),
  evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
}, (table) => ({ identityUniq: uniqueIndex("atomic_family_identity_uniq").on(table.manufacturerId, table.publishedName) }));

export const atomicGenericDevices = pgTable("atomic_generic_devices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
});

export const atomicExactParts = pgTable("atomic_exact_parts", {
  id: text("id").primaryKey(),
  manufacturerId: text("manufacturer_id").notNull().references(() => atomicManufacturers.id),
  exactMpn: text("exact_mpn").notNull(),
  normalizedSearchKey: text("normalized_search_key").notNull(),
  familyId: text("family_id").references(() => atomicFamilies.id),
  state: text("state").$type<"active" | "deprecated" | "revoked">().notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
}, (table) => ({ identityUniq: uniqueIndex("atomic_exact_part_identity_uniq").on(table.manufacturerId, table.exactMpn), searchIdx: index("atomic_exact_part_search_idx").on(table.normalizedSearchKey) }));

export const atomicSupplierParts = pgTable("atomic_supplier_parts", {
  id: text("id").primaryKey(),
  supplierId: text("supplier_id").notNull(),
  supplierSku: text("supplier_sku").notNull(),
  exactPartId: text("exact_part_id").notNull().references(() => atomicExactParts.id),
  packaging: text("packaging").notNull(),
  region: text("region"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
}, (table) => ({ skuUniq: uniqueIndex("atomic_supplier_sku_uniq").on(table.supplierId, table.supplierSku, table.region) }));

export const atomicLicenses = pgTable("atomic_licenses", {
  id: text("id").primaryKey(),
  spdxId: text("spdx_id"),
  disposition: text("disposition").notNull(),
  record: jsonb("record").$type<LicenseRecord>().notNull(),
});

export const atomicSources = pgTable("atomic_sources", {
  id: text("id").primaryKey(),
  sourceClass: text("source_class").notNull(),
  name: text("name").notNull(),
  officialDomains: jsonb("official_domains").$type<string[]>().notNull().default([]),
  licenseId: text("license_id").notNull().references(() => atomicLicenses.id),
});

export const atomicSourceRecords = pgTable("atomic_source_records", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => atomicSources.id),
  revision: text("revision").notNull(),
  contentHash: text("content_hash").notNull(),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  record: jsonb("record").$type<SourceRecord>().notNull(),
}, (table) => ({ contentIdx: index("atomic_source_content_idx").on(table.contentHash), sourceRevisionUniq: uniqueIndex("atomic_source_revision_uniq").on(table.sourceId, table.revision, table.contentHash) }));

export const atomicRawObjects = pgTable("atomic_raw_objects", {
  id: text("id").primaryKey(),
  contentHash: text("content_hash").notNull(),
  mediaType: text("media_type").notNull(),
  encoding: text("encoding").$type<"utf8" | "base64">().notNull(),
  content: text("content").notNull(),
  bytes: integer("bytes").notNull(),
  licenseId: text("license_id").notNull().references(() => atomicLicenses.id),
  confidential: boolean("confidential").notNull().default(false),
  record: jsonb("record").$type<RawContentObject>().notNull(),
}, (table) => ({ contentIdx: index("atomic_raw_content_idx").on(table.contentHash) }));

export const atomicEvidence = pgTable("atomic_evidence", {
  id: text("id").primaryKey(),
  sourceRecordId: text("source_record_id").notNull().references(() => atomicSourceRecords.id),
  locator: text("locator").notNull(),
  record: jsonb("record").$type<EvidenceRef>().notNull(),
}, (table) => ({ sourceIdx: index("atomic_evidence_source_idx").on(table.sourceRecordId) }));

export const atomicCadAssets = pgTable("atomic_cad_assets", {
  versionId: text("version_id").primaryKey(),
  logicalAssetId: text("logical_asset_id").notNull(),
  kind: text("kind").$type<"symbol" | "footprint" | "model">().notNull(),
  contentHash: text("content_hash").notNull(),
  semanticHash: text("semantic_hash").notNull(),
  sourceRecordId: text("source_record_id").notNull().references(() => atomicSourceRecords.id),
  licenseId: text("license_id").notNull().references(() => atomicLicenses.id),
  validationState: text("validation_state").notNull(),
  rawObjectId: text("raw_object_id").notNull().references(() => atomicRawObjects.id),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ logicalVersionIdx: index("atomic_cad_logical_version_idx").on(table.logicalAssetId, table.versionId), contentIdx: index("atomic_cad_content_idx").on(table.contentHash) }));

export const atomicClaims = pgTable("atomic_claims", {
  id: text("id").primaryKey(),
  property: text("property").notNull(),
  facet: text("facet").notNull(),
  state: text("state").notNull(),
  claim: jsonb("claim").$type<EngineeringClaim>().notNull(),
}, (table) => ({ propertyStateIdx: index("atomic_claim_property_state_idx").on(table.property, table.state) }));

export const atomicGuidance = pgTable("atomic_guidance", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  status: text("status").notNull(),
  guidance: jsonb("guidance").$type<ApplicationGuidance>().notNull(),
}, (table) => ({ categoryStatusIdx: index("atomic_guidance_category_status_idx").on(table.category, table.status) }));

export const atomicMappingCertificates = pgTable("atomic_mapping_certificates", {
  id: text("id").primaryKey(),
  symbolVersionId: text("symbol_version_id").notNull().references(() => atomicCadAssets.versionId),
  footprintVersionId: text("footprint_version_id").notNull().references(() => atomicCadAssets.versionId),
  state: text("state").notNull(),
  semanticHash: text("semantic_hash").notNull(),
  certificate: jsonb("certificate").$type<MappingCertificate>().notNull(),
}, (table) => ({ bundleIdx: index("atomic_mapping_bundle_idx").on(table.symbolVersionId, table.footprintVersionId, table.state) }));

export const atomicOfferSnapshots = pgTable("atomic_offer_snapshots", {
  id: text("id").primaryKey(),
  supplierPartId: text("supplier_part_id").notNull().references(() => atomicSupplierParts.id),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
}, (table) => ({ freshnessIdx: index("atomic_offer_freshness_idx").on(table.supplierPartId, table.expiresAt) }));

export const atomicPartRevisions = pgTable("atomic_part_revisions", {
  id: text("id").primaryKey(),
  logicalPartId: text("logical_part_id").notNull(),
  revision: integer("revision").notNull(),
  exactPartId: text("exact_part_id").references(() => atomicExactParts.id),
  genericDeviceId: text("generic_device_id"),
  publicationState: text("publication_state").notNull(),
  semanticHash: text("semantic_hash").notNull(),
  revisionData: jsonb("revision_data").$type<AtomicPartRevision>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: text("created_by").notNull(),
}, (table) => ({
  logicalRevisionUniq: uniqueIndex("atomic_part_logical_revision_uniq").on(table.logicalPartId, table.revision),
  publicationIdx: index("atomic_part_publication_idx").on(table.publicationState),
  identityXor: check("atomic_part_identity_xor", sql`(${table.exactPartId} IS NULL) <> (${table.genericDeviceId} IS NULL)`),
}));

export const atomicSelections = pgTable("atomic_selections", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  componentInstanceId: text("component_instance_id").notNull(),
  atomicRevisionId: text("atomic_revision_id").notNull().references(() => atomicPartRevisions.id),
  selection: jsonb("selection").$type<SelectionRecord>().notNull(),
  offlineSnapshot: jsonb("offline_snapshot").$type<PortableAtomicSnapshot>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ projectComponentIdx: index("atomic_selection_project_component_idx").on(table.projectId, table.componentInstanceId) }));

export const atomicAuditEvents = pgTable("atomic_audit_events", {
  id: text("id").primaryKey(),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  action: text("action").notNull(),
  actorId: text("actor_id").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  event: jsonb("event").$type<AuditEvent>().notNull(),
}, (table) => ({ objectIdx: index("atomic_audit_object_idx").on(table.objectType, table.objectId, table.at) }));

// ─── Stage 6 immutable hierarchical constraint records ─────────────────────

export const constraintSetRevisions = pgTable("constraint_set_revisions", {
  id: text("id").notNull(),
  revision: integer("revision").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  semanticHash: text("semantic_hash").notNull(),
  document: jsonb("document").$type<ConstraintDocument>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  identity: uniqueIndex("constraint_set_revision_identity").on(table.id, table.revision),
  semanticHashUniq: uniqueIndex("constraint_set_revision_hash_uniq").on(table.semanticHash),
}));

export const constraintPrograms = pgTable("constraint_programs", {
  programHash: text("program_hash").primaryKey(),
  projectId: text("project_id").notNull(),
  designRevision: text("design_revision").notNull(),
  catalogRevision: text("catalog_revision").notNull(),
  variantRevision: text("variant_revision").notNull(),
  manufacturingProfileRevision: text("manufacturing_profile_revision").notNull(),
  compilerVersion: text("compiler_version").notNull(),
  mergePolicyVersion: text("merge_policy_version").notNull(),
  program: jsonb("program").$type<ConstraintProgram>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ projectRevisionIdx: index("constraint_program_project_revision_idx").on(table.projectId, table.designRevision) }));

export const constraintProgramActivations = pgTable("constraint_program_activations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  programHash: text("program_hash").notNull().references(() => constraintPrograms.programHash),
  previousProgramHash: text("previous_program_hash"),
  actorId: text("actor_id").notNull(),
  action: text("action").$type<"activate" | "revert">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ projectIdx: index("constraint_activation_project_idx").on(table.projectId, table.createdAt) }));

export const constraintEvaluations = pgTable("constraint_evaluations", {
  evaluationHash: text("evaluation_hash").primaryKey(),
  programHash: text("program_hash").notNull().references(() => constraintPrograms.programHash),
  designRevision: text("design_revision").notNull(),
  readinessState: text("readiness_state").notNull(),
  report: jsonb("report").$type<ConstraintEvaluationReport>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ programIdx: index("constraint_evaluation_program_idx").on(table.programHash, table.designRevision) }));

export const constraintWaivers = pgTable("constraint_waivers", {
  id: text("id").primaryKey(),
  programHash: text("program_hash").notNull().references(() => constraintPrograms.programHash),
  designRevision: text("design_revision").notNull(),
  releaseProfileId: text("release_profile_id").notNull(),
  actorId: text("actor_id").notNull(),
  authorizedBy: text("authorized_by").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  waiver: jsonb("waiver").$type<ConstraintWaiver>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ scopeIdx: index("constraint_waiver_scope_idx").on(table.programHash, table.designRevision, table.releaseProfileId) }));

// ─── CD-1 immutable requirements, sources, and semantic transactions ────────

export const requirementSourceRevisions = pgTable("requirement_source_revisions", {
  tenantId: text("tenant_id").notNull(),
  projectId: text("project_id").notNull(),
  sourceId: text("source_id").notNull(),
  sourceVersion: text("source_version").notNull(),
  artifactDigest: text("artifact_digest").notNull(),
  accessPolicy: text("access_policy").notNull(),
  privacyClassification: text("privacy_classification").notNull(),
  artifact: jsonb("artifact").$type<RequirementSourceArtifact>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  identity: uniqueIndex("requirement_source_revision_identity").on(table.tenantId, table.projectId, table.sourceId, table.sourceVersion),
  digestUniq: uniqueIndex("requirement_source_revision_digest_uniq").on(table.artifactDigest),
  projectIdx: index("requirement_source_project_idx").on(table.tenantId, table.projectId, table.createdAt),
}));

export const designRequirementPackages = pgTable("design_requirement_packages", {
  packageId: text("package_id").notNull(),
  projectId: text("project_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  revision: integer("revision").notNull(),
  packageDigest: text("package_digest").notNull(),
  sourceSetDigest: text("source_set_digest").notNull(),
  status: text("status").notNull(),
  compilerVersion: text("compiler_version").notNull(),
  package: jsonb("package").$type<DesignRequirementsPackage>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  identity: uniqueIndex("design_requirement_package_identity").on(table.packageId, table.revision),
  digestUniq: uniqueIndex("design_requirement_package_digest_uniq").on(table.packageDigest),
  projectIdx: index("design_requirement_package_project_idx").on(table.tenantId, table.projectId, table.revision),
}));

export const requirementTransactionRecords = pgTable("requirement_transaction_records", {
  transactionId: text("transaction_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  projectId: text("project_id").notNull(),
  branchId: text("branch_id").notNull(),
  packageRevision: integer("package_revision"),
  actorId: text("actor_id").notNull(),
  status: text("status").notNull(),
  integrityDigest: text("integrity_digest").notNull(),
  record: jsonb("record").$type<RequirementsTransactionRecord>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ projectRevisionIdx: index("requirement_transaction_project_revision_idx").on(table.tenantId, table.projectId, table.packageRevision) }));

export const designCapabilityProfiles = pgTable("design_capability_profiles", {
  profileId: text("profile_id").notNull(),
  version: text("version").notNull(),
  deterministicDigest: text("deterministic_digest").notNull(),
  profile: jsonb("profile").$type<DesignCapabilityProfile>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  identity: uniqueIndex("design_capability_profile_identity").on(table.profileId, table.version),
  digestUniq: uniqueIndex("design_capability_profile_digest_uniq").on(table.deterministicDigest),
}));

// ─── CD-2 immutable functional architecture and human decisions ────────────

export const architectureProblems = pgTable("architecture_problems", {
  problemId: text("problem_id").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(),
  problemDigest: text("problem_digest").notNull(), requirementsPackageDigest: text("requirements_package_digest").notNull(), compilerVersion: text("compiler_version").notNull(),
  problem: jsonb("problem").$type<ArchitectureProblem>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("architecture_problem_identity").on(table.problemId, table.problemDigest), digestUniq: uniqueIndex("architecture_problem_digest_uniq").on(table.problemDigest), projectIdx: index("architecture_problem_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const architectureCandidates = pgTable("architecture_candidates", {
  candidateId: text("candidate_id").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), lineageId: text("lineage_id").notNull(), revision: integer("revision").notNull(),
  candidateDigest: text("candidate_digest").notNull(), problemDigest: text("problem_digest").notNull(), structuralSignature: text("structural_signature").notNull(), status: text("status").notNull(),
  candidate: jsonb("candidate").$type<SystemArchitectureCandidate>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("architecture_candidate_identity").on(table.candidateId, table.revision), digestUniq: uniqueIndex("architecture_candidate_digest_uniq").on(table.candidateDigest), problemIdx: index("architecture_candidate_problem_idx").on(table.tenantId, table.projectId, table.branchId, table.problemDigest) }));

export const architectureComparisons = pgTable("architecture_comparisons", {
  comparisonId: text("comparison_id").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), problemDigest: text("problem_digest").notNull(), comparisonDigest: text("comparison_digest").notNull(),
  comparison: jsonb("comparison").$type<ArchitectureComparison>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("architecture_comparison_digest_uniq").on(table.comparisonDigest), projectIdx: index("architecture_comparison_project_idx").on(table.tenantId, table.projectId, table.branchId) }));

export const architectureSelectionDecisions = pgTable("architecture_selection_decisions", {
  decisionId: text("decision_id").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), candidateId: text("candidate_id").notNull(), candidateDigest: text("candidate_digest").notNull(), problemDigest: text("problem_digest").notNull(), approverActorId: text("approver_actor_id").notNull(), decisionDigest: text("decision_digest").notNull(),
  decision: jsonb("decision").$type<ArchitectureSelectionDecision>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("architecture_selection_digest_uniq").on(table.decisionDigest), projectIdx: index("architecture_selection_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const architectureTransactionRecords = pgTable("architecture_transaction_records", {
  transactionId: text("transaction_id").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), actorId: text("actor_id").notNull(), status: text("status").notNull(), integrityDigest: text("integrity_digest").notNull(),
  record: jsonb("record").$type<ArchitectureTransactionRecord>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ projectIdx: index("architecture_transaction_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

// ─── CD-3 immutable power architecture and human decisions ──────────────

export const powerUpstreamSignoffs = pgTable("power_upstream_signoffs", {
  signoffDigest: text("signoff_digest").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), requirementsDigest: text("requirements_digest").notNull(), architectureCandidateDigest: text("architecture_candidate_digest").notNull(), architectureDecisionDigest: text("architecture_decision_digest").notNull(), approverActorId: text("approver_actor_id").notNull(), signoff: jsonb("signoff").$type<UpstreamCompletionSignoff>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ projectIdx: index("power_upstream_signoff_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const powerArchitectureProblems = pgTable("power_architecture_problems", {
  problemId: text("problem_id").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), problemDigest: text("problem_digest").notNull(), requirementsDigest: text("requirements_digest").notNull(), architectureCandidateDigest: text("architecture_candidate_digest").notNull(), upstreamSignoffDigest: text("upstream_signoff_digest").notNull(), compilerVersion: text("compiler_version").notNull(), problem: jsonb("problem").$type<PowerArchitectureProblem>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("power_architecture_problem_identity").on(table.problemId, table.problemDigest), digestUniq: uniqueIndex("power_architecture_problem_digest_uniq").on(table.problemDigest), projectIdx: index("power_architecture_problem_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const powerArchitectureCandidates = pgTable("power_architecture_candidates", {
  candidateId: text("candidate_id").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), revision: integer("revision").notNull(), candidateDigest: text("candidate_digest").notNull(), problemDigest: text("problem_digest").notNull(), structuralSignature: text("structural_signature").notNull(), feasibilityState: text("feasibility_state").notNull(), candidate: jsonb("candidate").$type<PowerArchitectureCandidate>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("power_architecture_candidate_identity").on(table.candidateId, table.revision), digestUniq: uniqueIndex("power_architecture_candidate_digest_uniq").on(table.candidateDigest), problemIdx: index("power_architecture_candidate_problem_idx").on(table.tenantId, table.projectId, table.branchId, table.problemDigest) }));

export const powerSelectionDecisions = pgTable("power_selection_decisions", {
  decisionId: text("decision_id").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), candidateId: text("candidate_id").notNull(), candidateDigest: text("candidate_digest").notNull(), problemDigest: text("problem_digest").notNull(), approverActorId: text("approver_actor_id").notNull(), decisionDigest: text("decision_digest").notNull(), decision: jsonb("decision").$type<PowerSelectionDecision>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("power_selection_decision_digest_uniq").on(table.decisionDigest), projectIdx: index("power_selection_decision_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const powerTransactionRecords = pgTable("power_transaction_records", {
  transactionId: text("transaction_id").primaryKey(), idempotencyKey: text("idempotency_key").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), actorId: text("actor_id").notNull(), status: text("status").notNull(), integrityDigest: text("integrity_digest").notNull(), record: jsonb("record").$type<PowerTransactionRecord>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ idempotencyUniq: uniqueIndex("power_transaction_idempotency_uniq").on(table.tenantId, table.projectId, table.branchId, table.idempotencyKey), projectIdx: index("power_transaction_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

// ─── CD-4 immutable interface planning, exact pin facts, and human decisions ───

export const interfaceUpstreamSignoffs = pgTable("interface_upstream_signoffs", {
  signoffDigest: text("signoff_digest").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), requirementsDigest: text("requirements_digest").notNull(), architectureCandidateDigest: text("architecture_candidate_digest").notNull(), architectureDecisionDigest: text("architecture_decision_digest").notNull(), powerCandidateDigest: text("power_candidate_digest").notNull(), powerDecisionDigest: text("power_decision_digest").notNull(), approverActorId: text("approver_actor_id").notNull(), signoff: jsonb("signoff").$type<Cd4UpstreamCompletionSignoff>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ projectIdx: index("interface_upstream_signoff_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const interfacePlanningProblems = pgTable("interface_planning_problems", {
  problemId: text("problem_id").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), problemDigest: text("problem_digest").notNull(), requirementsDigest: text("requirements_digest").notNull(), architectureCandidateDigest: text("architecture_candidate_digest").notNull(), powerCandidateDigest: text("power_candidate_digest").notNull(), upstreamSignoffDigest: text("upstream_signoff_digest").notNull(), compilerVersion: text("compiler_version").notNull(), problem: jsonb("problem").$type<InterfacePlanningProblem>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("interface_planning_problem_identity").on(table.problemId, table.problemDigest), digestUniq: uniqueIndex("interface_planning_problem_digest_uniq").on(table.problemDigest), projectIdx: index("interface_planning_problem_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const interfacePlanningCandidates = pgTable("interface_planning_candidates", {
  candidateId: text("candidate_id").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), revision: integer("revision").notNull(), candidateDigest: text("candidate_digest").notNull(), problemDigest: text("problem_digest").notNull(), structuralSignature: text("structural_signature").notNull(), feasibilityState: text("feasibility_state").notNull(), candidate: jsonb("candidate").$type<InterfacePlanningCandidate>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("interface_planning_candidate_identity").on(table.candidateId, table.revision), digestUniq: uniqueIndex("interface_planning_candidate_digest_uniq").on(table.candidateDigest), problemIdx: index("interface_planning_candidate_problem_idx").on(table.tenantId, table.projectId, table.branchId, table.problemDigest) }));

export const interfaceSelectionDecisions = pgTable("interface_selection_decisions", {
  decisionId: text("decision_id").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), candidateId: text("candidate_id").notNull(), candidateDigest: text("candidate_digest").notNull(), problemDigest: text("problem_digest").notNull(), approverActorId: text("approver_actor_id").notNull(), decisionDigest: text("decision_digest").notNull(), decision: jsonb("decision").$type<InterfacePlanningDecision>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("interface_selection_decision_digest_uniq").on(table.decisionDigest), projectIdx: index("interface_selection_decision_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const interfacePinFactSnapshots = pgTable("interface_pin_fact_snapshots", {
  snapshotId: text("snapshot_id").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), atomicPartRevisionId: text("atomic_part_revision_id").notNull(), packageRevisionId: text("package_revision_id").notNull(), snapshotDigest: text("snapshot_digest").notNull(), snapshot: jsonb("snapshot").$type<PinFunctionFactSnapshot>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("interface_pin_fact_snapshot_digest_uniq").on(table.snapshotDigest), projectIdx: index("interface_pin_fact_snapshot_project_idx").on(table.tenantId, table.projectId, table.createdAt) }));

export const interfacePinAllocations = pgTable("interface_pin_allocations", {
  allocationCandidateId: text("allocation_candidate_id").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), interfaceCandidateId: text("interface_candidate_id").notNull(), allocationProblemId: text("allocation_problem_id").notNull(), allocationDigest: text("allocation_digest").notNull(), feasibilityState: text("feasibility_state").notNull(), allocation: jsonb("allocation").$type<PinFunctionAllocationCandidate>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("interface_pin_allocation_digest_uniq").on(table.allocationDigest), candidateIdx: index("interface_pin_allocation_candidate_idx").on(table.tenantId, table.projectId, table.branchId, table.interfaceCandidateId) }));

export const interfaceTransactionRecords = pgTable("interface_transaction_records", {
  transactionId: text("transaction_id").primaryKey(), idempotencyKey: text("idempotency_key").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), actorId: text("actor_id").notNull(), status: text("status").notNull(), integrityDigest: text("integrity_digest").notNull(), record: jsonb("record").$type<InterfaceTransactionRecord>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ idempotencyUniq: uniqueIndex("interface_transaction_idempotency_uniq").on(table.tenantId, table.projectId, table.branchId, table.idempotencyKey), projectIdx: index("interface_transaction_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

// --- CD-5 immutable sources, executable recipe revisions, compiler artifacts, and project transactions ---

export const circuitKnowledgeUpstreamSignoffs = pgTable("circuit_knowledge_upstream_signoffs", {
  signoffDigest: text("signoff_digest").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), approverActorId: text("approver_actor_id").notNull(), signoff: jsonb("signoff").$type<Cd5UpstreamCompletionSignoff>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ projectIdx: index("circuit_knowledge_signoff_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const circuitKnowledgePcbFoundationSignoffs = pgTable("circuit_knowledge_pcb_foundation_signoffs", {
  signoffDigest: text("signoff_digest").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), approverActorId: text("approver_actor_id").notNull(), signoff: jsonb("signoff").$type<Cd5PcbFoundationSignoff>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ projectIdx: index("circuit_knowledge_pcb_foundation_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const circuitKnowledgeProblems = pgTable("circuit_knowledge_problems", {
  problemId: text("problem_id").notNull(), problemDigest: text("problem_digest").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), upstreamSignoffDigest: text("upstream_signoff_digest").notNull(), problem: jsonb("problem").$type<CircuitKnowledgeProblem>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("circuit_knowledge_problem_identity").on(table.problemId, table.problemDigest), digestUniq: uniqueIndex("circuit_knowledge_problem_digest_uniq").on(table.problemDigest), projectIdx: index("circuit_knowledge_problem_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const circuitRecipeSourceBundles = pgTable("circuit_recipe_source_bundles", {
  sourceBundleId: text("source_bundle_id").notNull(), sourceBundleDigest: text("source_bundle_digest").notNull(), tenantId: text("tenant_id").notNull(), visibility: text("visibility").notNull(), bundle: jsonb("bundle").$type<RecipeSourceBundle>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("circuit_recipe_source_bundle_identity").on(table.sourceBundleId, table.sourceBundleDigest), digestUniq: uniqueIndex("circuit_recipe_source_bundle_digest_uniq").on(table.sourceBundleDigest) }));

export const circuitRecipeDefinitions = pgTable("circuit_recipe_definitions", {
  recipeId: text("recipe_id").notNull(), revisionId: text("revision_id").primaryKey(), semanticVersion: text("semantic_version").notNull(), lifecycleState: text("lifecycle_state").notNull(), semanticRole: text("semantic_role").notNull(), deterministicDigest: text("deterministic_digest").notNull(), recipe: jsonb("recipe").$type<CircuitRecipeDefinition>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("circuit_recipe_definition_digest_uniq").on(table.deterministicDigest), roleIdx: index("circuit_recipe_definition_role_idx").on(table.semanticRole, table.lifecycleState) }));

export const compiledCircuitRecipes = pgTable("compiled_circuit_recipes", {
  compiledRecipeId: text("compiled_recipe_id").primaryKey(), recipeRevisionId: text("recipe_revision_id").notNull(), compilerVersion: text("compiler_version").notNull(), deterministicDigest: text("deterministic_digest").notNull(), publicationEligible: boolean("publication_eligible").notNull(), compiled: jsonb("compiled").$type<CompiledCircuitRecipe>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("compiled_circuit_recipe_digest_uniq").on(table.deterministicDigest), recipeIdx: index("compiled_circuit_recipe_revision_idx").on(table.recipeRevisionId, table.compilerVersion) }));

export const circuitRecipeLibraries = pgTable("circuit_recipe_libraries", {
  libraryId: text("library_id").notNull(), revision: integer("revision").notNull(), deterministicDigest: text("deterministic_digest").notNull(), library: jsonb("library").$type<CircuitRecipeLibrary>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("circuit_recipe_library_identity").on(table.libraryId, table.revision), digestUniq: uniqueIndex("circuit_recipe_library_digest_uniq").on(table.deterministicDigest) }));

export const circuitKnowledgeTransactionRecords = pgTable("circuit_knowledge_transaction_records", {
  transactionId: text("transaction_id").primaryKey(), idempotencyKey: text("idempotency_key").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), actorId: text("actor_id").notNull(), status: text("status").notNull(), integrityDigest: text("integrity_digest").notNull(), record: jsonb("record").$type<CircuitKnowledgeTransactionRecord>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ idempotencyUniq: uniqueIndex("circuit_knowledge_transaction_idempotency_uniq").on(table.tenantId, table.projectId, table.branchId, table.idempotencyKey), projectIdx: index("circuit_knowledge_transaction_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

// --- CD-6 exact evidence-backed component selection and preliminary BOM records ---

export const componentSelectionUpstreamSignoffs = pgTable("component_selection_upstream_signoffs", {
  signoffDigest: text("signoff_digest").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), approverActorId: text("approver_actor_id").notNull(), signoff: jsonb("signoff").$type<Cd6UpstreamCompletionSignoff>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ projectIdx: index("component_selection_signoff_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const componentSelectionProblems = pgTable("component_selection_problems", {
  problemId: text("problem_id").notNull(), problemDigest: text("problem_digest").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), upstreamSignoffDigest: text("upstream_signoff_digest").notNull(), catalogSnapshotDigest: text("catalog_snapshot_digest").notNull(), problem: jsonb("problem").$type<ComponentSelectionProblem>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("component_selection_problem_identity").on(table.problemId, table.problemDigest), digestUniq: uniqueIndex("component_selection_problem_digest_uniq").on(table.problemDigest), projectIdx: index("component_selection_problem_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const componentSelectionCatalogSnapshots = pgTable("component_selection_catalog_snapshots", {
  catalogSnapshotId: text("catalog_snapshot_id").primaryKey(), deterministicDigest: text("deterministic_digest").notNull(), publicationPolicyRevision: text("publication_policy_revision").notNull(), snapshot: jsonb("snapshot").$type<EngineeringCatalogSnapshot>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("component_selection_catalog_snapshot_digest_uniq").on(table.deterministicDigest) }));

export const componentSelectionSourcingSnapshots = pgTable("component_selection_sourcing_snapshots", {
  snapshotId: text("snapshot_id").primaryKey(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), observedAt: timestamp("observed_at", { withTimezone: true }).notNull(), providerId: text("provider_id").notNull(), errorPartialState: text("error_partial_state").notNull(), snapshot: jsonb("snapshot").$type<SupplierSourcingSnapshot>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("component_selection_sourcing_snapshot_digest_uniq").on(table.deterministicDigest), projectIdx: index("component_selection_sourcing_project_idx").on(table.projectId, table.branchId, table.observedAt) }));

export const componentSelectionOfferObservations = pgTable("component_selection_offer_observations", {
  offerObservationId: text("offer_observation_id").primaryKey(), snapshotId: text("snapshot_id").notNull(), exactManufacturerPartId: text("exact_manufacturer_part_id").notNull(), supplierId: text("supplier_id").notNull(), supplierSku: text("supplier_sku").notNull(), deterministicDigest: text("deterministic_digest").notNull(), observation: jsonb("observation").$type<SupplierOfferObservation>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("component_selection_offer_observation_digest_uniq").on(table.deterministicDigest), partIdx: index("component_selection_offer_part_idx").on(table.snapshotId, table.exactManufacturerPartId) }));

export const componentSelectionEvaluations = pgTable("component_selection_evaluations", {
  evaluationId: text("evaluation_id").primaryKey(), problemId: text("problem_id").notNull(), roleRequirementId: text("role_requirement_id").notNull(), atomicPartRevisionId: text("atomic_part_revision_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), feasibilityState: text("feasibility_state").notNull(), evaluation: jsonb("evaluation").$type<PartCompatibilityEvaluation>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("component_selection_evaluation_digest_uniq").on(table.deterministicDigest), problemRoleIdx: index("component_selection_evaluation_problem_role_idx").on(table.problemId, table.roleRequirementId, table.feasibilityState) }));

export const componentSelectionCandidates = pgTable("component_selection_candidates", {
  candidateId: text("candidate_id").primaryKey(), problemId: text("problem_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), feasibilityState: text("feasibility_state").notNull(), lifecycleState: text("lifecycle_state").notNull(), candidate: jsonb("candidate").$type<ComponentSelectionCandidate>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("component_selection_candidate_digest_uniq").on(table.deterministicDigest), problemIdx: index("component_selection_candidate_problem_idx").on(table.problemId, table.feasibilityState, table.createdAt) }));

export const componentSelectionAlternatives = pgTable("component_selection_alternatives", {
  alternativePlanId: text("alternative_plan_id").primaryKey(), primaryAtomicPartRevisionId: text("primary_atomic_part_revision_id").notNull(), alternativeAtomicPartRevisionId: text("alternative_atomic_part_revision_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), alternative: jsonb("alternative").$type<ComponentAlternativePlan>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("component_selection_alternative_digest_uniq").on(table.deterministicDigest), pairIdx: index("component_selection_alternative_pair_idx").on(table.primaryAtomicPartRevisionId, table.alternativeAtomicPartRevisionId) }));

export const componentSelectionDecisions = pgTable("component_selection_decisions", {
  decisionId: text("decision_id").primaryKey(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), problemDigest: text("problem_digest").notNull(), selectedCandidateId: text("selected_candidate_id"), approverActorId: text("approver_actor_id"), deterministicDigest: text("deterministic_digest").notNull(), decision: jsonb("decision").$type<ComponentSelectionDecision>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("component_selection_decision_digest_uniq").on(table.deterministicDigest), projectIdx: index("component_selection_decision_project_idx").on(table.projectId, table.branchId, table.createdAt) }));

export const componentSelectionTransactionRecords = pgTable("component_selection_transaction_records", {
  transactionId: text("transaction_id").primaryKey(), idempotencyKey: text("idempotency_key").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), actorId: text("actor_id").notNull(), status: text("status").notNull(), integrityDigest: text("integrity_digest").notNull(), record: jsonb("record").$type<ComponentSelectionTransactionRecord>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ idempotencyUniq: uniqueIndex("component_selection_transaction_idempotency_uniq").on(table.tenantId, table.projectId, table.branchId, table.idempotencyKey), projectIdx: index("component_selection_transaction_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

// --- CD-7 deterministic electrical calculations, proofs, and human decisions ---

export const calculationUpstreamSignoffs = pgTable("calculation_upstream_signoffs", {
  signoffDigest: text("signoff_digest").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), approverActorId: text("approver_actor_id").notNull(), signoff: jsonb("signoff").$type<Cd7UpstreamCompletionSignoff>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ projectIdx: index("calculation_signoff_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const calculationRegistrySnapshots = pgTable("calculation_registry_snapshots", {
  registrySnapshotId: text("registry_snapshot_id").primaryKey(), deterministicDigest: text("deterministic_digest").notNull(), policyRevision: text("policy_revision").notNull(), snapshot: jsonb("snapshot").$type<EquationModelRegistrySnapshot>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("calculation_registry_snapshot_digest_uniq").on(table.deterministicDigest) }));

export const calculationProblems = pgTable("calculation_problems", {
  problemId: text("problem_id").notNull(), problemDigest: text("problem_digest").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), upstreamSignoffDigest: text("upstream_signoff_digest").notNull(), registrySnapshotId: text("registry_snapshot_id").notNull(), lifecycleState: text("lifecycle_state").notNull(), problem: jsonb("problem").$type<CircuitCalculationProblem>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("calculation_problem_identity").on(table.problemId, table.problemDigest), digestUniq: uniqueIndex("calculation_problem_digest_uniq").on(table.problemDigest), projectIdx: index("calculation_problem_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const calculationGraphs = pgTable("calculation_graphs", {
  graphId: text("graph_id").primaryKey(), problemId: text("problem_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), validationState: text("validation_state").notNull(), graph: jsonb("graph").$type<CalculationDerivationGraph>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("calculation_graph_digest_uniq").on(table.deterministicDigest), problemIdx: index("calculation_graph_problem_idx").on(table.problemId, table.validationState) }));

export const calculationReports = pgTable("calculation_reports", {
  reportId: text("report_id").primaryKey(), projectId: text("project_id").notNull(), problemId: text("problem_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), lifecycleState: text("lifecycle_state").notNull(), approvalState: text("approval_state").notNull(), report: jsonb("report").$type<CircuitCalculationReport>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("calculation_report_digest_uniq").on(table.deterministicDigest), problemIdx: index("calculation_report_problem_idx").on(table.projectId, table.problemId, table.createdAt) }));

export const calculationDecisions = pgTable("calculation_decisions", {
  decisionId: text("decision_id").primaryKey(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), reportId: text("report_id").notNull(), reportDigest: text("report_digest").notNull(), approverActorId: text("approver_actor_id"), deterministicDigest: text("deterministic_digest").notNull(), decision: jsonb("decision").$type<CalculationDecision>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("calculation_decision_digest_uniq").on(table.deterministicDigest), projectIdx: index("calculation_decision_project_idx").on(table.projectId, table.branchId, table.createdAt) }));

export const calculationTransactionRecords = pgTable("calculation_transaction_records", {
  transactionId: text("transaction_id").primaryKey(), idempotencyKey: text("idempotency_key").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), actorId: text("actor_id").notNull(), status: text("status").notNull(), integrityDigest: text("integrity_digest").notNull(), record: jsonb("record").$type<CalculationTransactionRecord>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ idempotencyUniq: uniqueIndex("calculation_transaction_idempotency_uniq").on(table.tenantId, table.projectId, table.branchId, table.idempotencyKey), projectIdx: index("calculation_transaction_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

// --- CD-8 authoritative semantic graphs, view artifacts, equivalence, and human decisions ---

export const schematicCompilerUpstreamSignoffs = pgTable("schematic_compiler_upstream_signoffs", {
  signoffDigest: text("signoff_digest").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), approverActorId: text("approver_actor_id").notNull(), signoff: jsonb("signoff").$type<Cd8UpstreamCompletionSignoff>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ projectIdx: index("schematic_compiler_signoff_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const schematicCompilationProblems = pgTable("schematic_compilation_problems", {
  problemId: text("problem_id").notNull(), problemDigest: text("problem_digest").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), upstreamSignoffDigest: text("upstream_signoff_digest").notNull(), lifecycleState: text("lifecycle_state").notNull(), problem: jsonb("problem").$type<SchematicCompilationProblem>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("schematic_compilation_problem_identity").on(table.problemId, table.problemDigest), digestUniq: uniqueIndex("schematic_compilation_problem_digest_uniq").on(table.problemDigest), projectIdx: index("schematic_compilation_problem_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const schematicSemanticGraphs = pgTable("schematic_semantic_graphs", {
  graphId: text("graph_id").notNull(), revision: integer("revision").notNull(), projectId: text("project_id").notNull(), problemId: text("problem_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), validationState: text("validation_state").notNull(), graph: jsonb("graph").$type<SchematicSemanticGraph>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("schematic_semantic_graph_identity").on(table.graphId, table.revision), digestUniq: uniqueIndex("schematic_semantic_graph_digest_uniq").on(table.deterministicDigest), projectIdx: index("schematic_semantic_graph_project_idx").on(table.projectId, table.problemId, table.createdAt) }));

export const schematicDiagramViews = pgTable("schematic_diagram_views", {
  diagramViewId: text("diagram_view_id").primaryKey(), graphDigest: text("graph_digest").notNull(), sheetInstanceId: text("sheet_instance_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), readabilityState: text("readability_state").notNull(), view: jsonb("view").$type<SchematicDiagramView>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("schematic_diagram_view_digest_uniq").on(table.deterministicDigest), graphIdx: index("schematic_diagram_view_graph_idx").on(table.graphDigest, table.sheetInstanceId) }));

export const schematicArtifactManifests = pgTable("schematic_artifact_manifests", {
  manifestId: text("manifest_id").primaryKey(), candidateId: text("candidate_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), publicationState: text("publication_state").notNull(), manifest: jsonb("manifest").$type<KiCadSchematicArtifactManifest>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("schematic_artifact_manifest_digest_uniq").on(table.deterministicDigest), candidateIdx: index("schematic_artifact_manifest_candidate_idx").on(table.candidateId, table.publicationState) }));

export const schematicRoundTripCertificates = pgTable("schematic_round_trip_certificates", {
  certificateId: text("certificate_id").primaryKey(), graphDigest: text("graph_digest").notNull(), manifestId: text("manifest_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), certificateState: text("certificate_state").notNull(), certificate: jsonb("certificate").$type<KiCadRoundTripCertificate>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("schematic_round_trip_digest_uniq").on(table.deterministicDigest), graphIdx: index("schematic_round_trip_graph_idx").on(table.graphDigest, table.certificateState) }));

export const schematicCompletenessReports = pgTable("schematic_completeness_reports", {
  reportId: text("report_id").primaryKey(), graphRevisionId: text("graph_revision_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), readinessState: text("readiness_state").notNull(), report: jsonb("report").$type<StructuralCompletenessReport>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("schematic_completeness_digest_uniq").on(table.deterministicDigest), graphIdx: index("schematic_completeness_graph_idx").on(table.graphRevisionId, table.readinessState) }));

export const schematicSemanticDiffs = pgTable("schematic_semantic_diffs", {
  diffId: text("diff_id").primaryKey(), baseGraphRevisionId: text("base_graph_revision_id").notNull(), candidateGraphRevisionId: text("candidate_graph_revision_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), diff: jsonb("diff").$type<SchematicSemanticDiff>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("schematic_semantic_diff_digest_uniq").on(table.deterministicDigest), graphIdx: index("schematic_semantic_diff_graph_idx").on(table.baseGraphRevisionId, table.candidateGraphRevisionId) }));

export const schematicPcbSyncContracts = pgTable("schematic_pcb_sync_contracts", {
  contractId: text("contract_id").primaryKey(), candidateId: text("candidate_id").notNull(), graphDigest: text("graph_digest").notNull(), deterministicDigest: text("deterministic_digest").notNull(), synchronizationState: text("synchronization_state").notNull(), contract: jsonb("contract").$type<PCBSynchronizationContract>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("schematic_pcb_sync_digest_uniq").on(table.deterministicDigest), candidateIdx: index("schematic_pcb_sync_candidate_idx").on(table.candidateId, table.synchronizationState) }));

export const schematicCandidates = pgTable("schematic_candidates", {
  candidateId: text("candidate_id").primaryKey(), problemId: text("problem_id").notNull(), graphDigest: text("graph_digest").notNull(), deterministicDigest: text("deterministic_digest").notNull(), lifecycleState: text("lifecycle_state").notNull(), approvalState: text("approval_state").notNull(), candidate: jsonb("candidate").$type<SchematicCandidate>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("schematic_candidate_digest_uniq").on(table.deterministicDigest), problemIdx: index("schematic_candidate_problem_idx").on(table.problemId, table.lifecycleState, table.createdAt) }));

export const schematicDecisions = pgTable("schematic_decisions", {
  decisionId: text("decision_id").primaryKey(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), candidateId: text("candidate_id").notNull(), candidateDigest: text("candidate_digest").notNull(), approverActorId: text("approver_actor_id"), deterministicDigest: text("deterministic_digest").notNull(), decision: jsonb("decision").$type<SchematicDecision>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("schematic_decision_digest_uniq").on(table.deterministicDigest), projectIdx: index("schematic_decision_project_idx").on(table.projectId, table.branchId, table.createdAt) }));

export const schematicTransactionRecords = pgTable("schematic_transaction_records", {
  transactionId: text("transaction_id").primaryKey(), idempotencyKey: text("idempotency_key").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), actorId: text("actor_id").notNull(), status: text("status").notNull(), integrityDigest: text("integrity_digest").notNull(), record: jsonb("record").$type<SchematicTransactionRecord>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ idempotencyUniq: uniqueIndex("schematic_transaction_idempotency_uniq").on(table.tenantId, table.projectId, table.branchId, table.idempotencyKey), projectIdx: index("schematic_transaction_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

// --- CD-9 circuit verification, explicit denominator, full oracle, and workflow evidence ---

export const circuitVerificationUpstreamSignoffs = pgTable("circuit_verification_upstream_signoffs", {
  signoffDigest: text("signoff_digest").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), approverActorId: text("approver_actor_id").notNull(), signoff: jsonb("signoff").$type<Cd9UpstreamCompletionSignoff>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ projectIdx: index("circuit_verification_signoff_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const circuitVerificationProblems = pgTable("circuit_verification_problems", {
  problemId: text("problem_id").notNull(), problemDigest: text("problem_digest").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), graphDigest: text("graph_digest").notNull(), registryDigest: text("registry_digest").notNull(), lifecycleState: text("lifecycle_state").notNull(), problem: jsonb("problem").$type<CircuitVerificationProblem>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("circuit_verification_problem_identity").on(table.problemId, table.problemDigest), digestUniq: uniqueIndex("circuit_verification_problem_digest_uniq").on(table.problemDigest), projectIdx: index("circuit_verification_problem_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const circuitRuleRegistries = pgTable("circuit_rule_registries", {
  registryId: text("registry_id").notNull(), revision: integer("revision").notNull(), deterministicDigest: text("deterministic_digest").notNull(), lifecycleState: text("lifecycle_state").notNull(), approvedByActorId: text("approved_by_actor_id"), registry: jsonb("registry").$type<RuleRegistrySnapshot>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("circuit_rule_registry_identity").on(table.registryId, table.revision), digestUniq: uniqueIndex("circuit_rule_registry_digest_uniq").on(table.deterministicDigest) }));

export const circuitRuleDenominators = pgTable("circuit_rule_denominators", {
  denominatorId: text("denominator_id").primaryKey(), problemId: text("problem_id").notNull(), graphDigest: text("graph_digest").notNull(), registryDigest: text("registry_digest").notNull(), deterministicDigest: text("deterministic_digest").notNull(), instanceCount: integer("instance_count").notNull(), denominator: jsonb("denominator").$type<RequiredRuleDenominator>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("circuit_rule_denominator_digest_uniq").on(table.deterministicDigest), inputIdx: index("circuit_rule_denominator_input_idx").on(table.problemId, table.graphDigest, table.registryDigest) }));

export const circuitOracleRuns = pgTable("circuit_oracle_runs", {
  runId: text("run_id").primaryKey(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), runKind: text("run_kind").notNull(), graphDigest: text("graph_digest").notNull(), registryDigest: text("registry_digest").notNull(), denominatorDigest: text("denominator_digest").notNull(), executionState: text("execution_state").notNull(), deterministicDigest: text("deterministic_digest").notNull(), run: jsonb("run").$type<FullOracleRun>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("circuit_oracle_run_digest_uniq").on(table.deterministicDigest), projectIdx: index("circuit_oracle_run_project_idx").on(table.projectId, table.branchId, table.createdAt) }));

export const circuitFindings = pgTable("circuit_findings", {
  findingId: text("finding_id").notNull(), stableIdentity: text("stable_identity").notNull(), runId: text("run_id").notNull(), ruleId: text("rule_id").notNull(), graphDigest: text("graph_digest").notNull(), workflowState: text("workflow_state").notNull(), engineeringResult: text("engineering_result").notNull(), deterministicDigest: text("deterministic_digest").notNull(), finding: jsonb("finding").$type<CircuitFinding>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("circuit_finding_run_identity").on(table.findingId, table.runId), currentIdx: index("circuit_finding_stable_idx").on(table.stableIdentity, table.graphDigest, table.workflowState) }));

export const circuitWaivers = pgTable("circuit_waivers", {
  waiverId: text("waiver_id").primaryKey(), graphDigest: text("graph_digest").notNull(), registryDigest: text("registry_digest").notNull(), state: text("state").notNull(), requestedByActorId: text("requested_by_actor_id").notNull(), approvedByActorId: text("approved_by_actor_id").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), deterministicDigest: text("deterministic_digest").notNull(), waiver: jsonb("waiver").$type<CircuitWaiver>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("circuit_waiver_digest_uniq").on(table.deterministicDigest), currentIdx: index("circuit_waiver_current_idx").on(table.graphDigest, table.registryDigest, table.state, table.expiresAt) }));

export const circuitOracleParityReports = pgTable("circuit_oracle_parity_reports", {
  parityId: text("parity_id").primaryKey(), fullRunId: text("full_run_id").notNull(), incrementalRunId: text("incremental_run_id").notNull(), state: text("state").notNull(), deterministicDigest: text("deterministic_digest").notNull(), report: jsonb("report").$type<OracleParityReport>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("circuit_oracle_parity_digest_uniq").on(table.deterministicDigest), runsIdx: index("circuit_oracle_parity_runs_idx").on(table.fullRunId, table.incrementalRunId) }));

export const circuitReadinessReports = pgTable("circuit_readiness_reports", {
  reportId: text("report_id").primaryKey(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), graphDigest: text("graph_digest").notNull(), registryDigest: text("registry_digest").notNull(), verdict: text("verdict").notNull(), deterministicDigest: text("deterministic_digest").notNull(), report: jsonb("report").$type<CircuitReadinessReport>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("circuit_readiness_digest_uniq").on(table.deterministicDigest), projectIdx: index("circuit_readiness_project_idx").on(table.projectId, table.branchId, table.createdAt) }));

export const circuitVerificationProjectStates = pgTable("circuit_verification_project_states", {
  projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), stateDigest: text("state_digest").notNull(), graphDigest: text("graph_digest").notNull(), registryDigest: text("registry_digest").notNull(), state: jsonb("state").$type<CircuitVerificationProjectState>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("circuit_verification_project_state_identity").on(table.projectId, table.branchId, table.stateDigest), currentIdx: index("circuit_verification_project_state_current_idx").on(table.projectId, table.branchId, table.createdAt) }));

export const circuitVerificationTransactionRecords = pgTable("circuit_verification_transaction_records", {
  transactionId: text("transaction_id").primaryKey(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), actorId: text("actor_id").notNull(), operation: text("operation").notNull(), integrityDigest: text("integrity_digest").notNull(), record: jsonb("record").$type<CircuitVerificationProjectState["transactionRecords"][number]>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ projectIdx: index("circuit_verification_transaction_project_idx").on(table.projectId, table.branchId, table.createdAt) }));

// --- CD-10 model-backed simulation, exact evidence, and fail-closed readiness ---

export const simulationVerificationProblems = pgTable("simulation_verification_problems", {
  problemId: text("problem_id").notNull(), problemDigest: text("problem_digest").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), graphDigest: text("graph_digest").notNull(), circuitVerificationDigest: text("circuit_verification_digest").notNull(), lifecycleState: text("lifecycle_state").notNull(), problem: jsonb("problem").$type<SimulationVerificationProblem>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("simulation_problem_identity").on(table.problemId, table.problemDigest), digestUniq: uniqueIndex("simulation_problem_digest_uniq").on(table.problemDigest), projectIdx: index("simulation_problem_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));

export const simulationModelRegistries = pgTable("simulation_model_registries", {
  registryId: text("registry_id").notNull(), revision: integer("revision").notNull(), deterministicDigest: text("deterministic_digest").notNull(), lifecycleState: text("lifecycle_state").notNull(), registry: jsonb("registry").$type<ModelRegistrySnapshot>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("simulation_model_registry_identity").on(table.registryId, table.revision), digestUniq: uniqueIndex("simulation_model_registry_digest_uniq").on(table.deterministicDigest) }));

export const simulationTestbenchRegistries = pgTable("simulation_testbench_registries", {
  registryId: text("registry_id").notNull(), revision: integer("revision").notNull(), deterministicDigest: text("deterministic_digest").notNull(), lifecycleState: text("lifecycle_state").notNull(), registry: jsonb("registry").$type<TestbenchRegistrySnapshot>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("simulation_testbench_registry_identity").on(table.registryId, table.revision), digestUniq: uniqueIndex("simulation_testbench_registry_digest_uniq").on(table.deterministicDigest) }));

export const simulationCoverageDenominators = pgTable("simulation_coverage_denominators", {
  denominatorId: text("denominator_id").primaryKey(), problemDigest: text("problem_digest").notNull(), graphDigest: text("graph_digest").notNull(), modelRegistryDigest: text("model_registry_digest").notNull(), testbenchRegistryDigest: text("testbench_registry_digest").notNull(), instanceCount: integer("instance_count").notNull(), deterministicDigest: text("deterministic_digest").notNull(), denominator: jsonb("denominator").$type<SimulationCoverageDenominator>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("simulation_denominator_digest_uniq").on(table.deterministicDigest), inputIdx: index("simulation_denominator_input_idx").on(table.problemDigest, table.graphDigest, table.modelRegistryDigest, table.testbenchRegistryDigest) }));

export const simulationRuns = pgTable("simulation_runs", {
  runId: text("run_id").primaryKey(), campaignId: text("campaign_id").notNull(), requiredInstanceId: text("required_instance_id").notNull(), providerRevisionId: text("provider_revision_id").notNull(), environmentId: text("environment_id").notNull(), runState: text("run_state").notNull(), processState: text("process_state").notNull(), deterministicDigest: text("deterministic_digest").notNull(), run: jsonb("run").$type<SimulationRun>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("simulation_run_digest_uniq").on(table.deterministicDigest), campaignIdx: index("simulation_run_campaign_idx").on(table.campaignId, table.requiredInstanceId, table.createdAt) }));

export const simulationWaveformArtifacts = pgTable("simulation_waveform_artifacts", {
  waveformArtifactId: text("waveform_artifact_id").primaryKey(), runId: text("run_id").notNull(), immutableArtifactDigest: text("immutable_artifact_digest").notNull(), authorityState: text("authority_state").notNull(), validationState: text("validation_state").notNull(), artifact: jsonb("artifact").$type<WaveformArtifact>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("simulation_waveform_digest_uniq").on(table.immutableArtifactDigest), runIdx: index("simulation_waveform_run_idx").on(table.runId, table.authorityState) }));

export const simulationCoverageMatrices = pgTable("simulation_coverage_matrices", {
  coverageMatrixId: text("coverage_matrix_id").primaryKey(), problemRevisionId: text("problem_revision_id").notNull(), denominatorDigest: text("denominator_digest").notNull(), coverageDigest: text("coverage_digest").notNull(), matrix: jsonb("matrix").$type<SimulationCoverageMatrix>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ coverageUniq: uniqueIndex("simulation_coverage_digest_uniq").on(table.coverageDigest), problemIdx: index("simulation_coverage_problem_idx").on(table.problemRevisionId, table.createdAt) }));

export const simulationCampaigns = pgTable("simulation_campaigns", {
  campaignId: text("campaign_id").primaryKey(), problemRevisionId: text("problem_revision_id").notNull(), graphRevisionId: text("graph_revision_id").notNull(), readinessState: text("readiness_state").notNull(), lifecycleState: text("lifecycle_state").notNull(), deterministicDigest: text("deterministic_digest").notNull(), campaign: jsonb("campaign").$type<SimulationCampaign>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("simulation_campaign_digest_uniq").on(table.deterministicDigest), problemIdx: index("simulation_campaign_problem_idx").on(table.problemRevisionId, table.createdAt) }));

export const simulationReadinessReports = pgTable("simulation_readiness_reports", {
  reportId: text("report_id").primaryKey(), problemDigest: text("problem_digest").notNull(), campaignId: text("campaign_id"), readinessState: text("readiness_state").notNull(), graphDigest: text("graph_digest").notNull(), deterministicDigest: text("deterministic_digest").notNull(), report: jsonb("report").$type<SimulationReadinessReport>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ digestUniq: uniqueIndex("simulation_readiness_digest_uniq").on(table.deterministicDigest), problemIdx: index("simulation_readiness_problem_idx").on(table.problemDigest, table.createdAt) }));

export const modelSimulationProjectStates = pgTable("model_simulation_project_states", {
  projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), stateDigest: text("state_digest").notNull(), graphDigest: text("graph_digest").notNull(), modelRegistryDigest: text("model_registry_digest").notNull(), testbenchRegistryDigest: text("testbench_registry_digest").notNull(), state: jsonb("state").$type<ModelSimulationProjectState>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ identity: uniqueIndex("model_simulation_project_state_identity").on(table.projectId, table.branchId, table.stateDigest), currentIdx: index("model_simulation_project_state_current_idx").on(table.projectId, table.branchId, table.createdAt) }));

// --- CD-11 firmware/test/DFT/calibration/bring-up co-design metadata ---
export const firmwareBringUpProblems = pgTable("firmware_bringup_problems", { problemId: text("problem_id").notNull(), problemDigest: text("problem_digest").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), simulationCampaignDigest: text("simulation_campaign_digest").notNull(), lifecycleState: text("lifecycle_state").notNull(), problem: jsonb("problem").$type<FirmwareTestBringUpProblem>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("firmware_bringup_problem_identity").on(table.problemId, table.problemDigest), projectIdx: index("firmware_bringup_problem_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));
export const programmableDeviceEvidenceSnapshots = pgTable("programmable_device_evidence_snapshots", { snapshotId: text("snapshot_id").notNull(), revision: integer("revision").notNull(), deterministicDigest: text("deterministic_digest").notNull(), lifecycleState: text("lifecycle_state").notNull(), snapshot: jsonb("snapshot").$type<DeviceEvidenceSnapshot>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("programmable_device_evidence_identity").on(table.snapshotId, table.revision), digestUniq: uniqueIndex("programmable_device_evidence_digest_uniq").on(table.deterministicDigest) }));
export const firmwareBringUpCoverageReports = pgTable("firmware_bringup_coverage_reports", { reportId: text("report_id").primaryKey(), problemDigest: text("problem_digest").notNull(), denominatorDigest: text("denominator_digest").notNull(), deterministicDigest: text("deterministic_digest").notNull(), report: jsonb("report").$type<Cd11CoverageReport>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ digestUniq: uniqueIndex("firmware_bringup_coverage_digest_uniq").on(table.deterministicDigest), problemIdx: index("firmware_bringup_coverage_problem_idx").on(table.problemDigest, table.createdAt) }));
export const firmwareBringUpReadinessDecisions = pgTable("firmware_bringup_readiness_decisions", { decisionId: text("decision_id").primaryKey(), problemDigest: text("problem_digest").notNull(), verdict: text("verdict").notNull(), deterministicDigest: text("deterministic_digest").notNull(), decision: jsonb("decision").$type<Cd11ReadinessDecision>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ digestUniq: uniqueIndex("firmware_bringup_readiness_digest_uniq").on(table.deterministicDigest), problemIdx: index("firmware_bringup_readiness_problem_idx").on(table.problemDigest, table.createdAt) }));
export const firmwareBringUpPackages = pgTable("firmware_bringup_packages", { packageId: text("package_id").notNull(), packageDigest: text("package_digest").notNull(), problemDigest: text("problem_digest").notNull(), readinessState: text("readiness_state").notNull(), hardwareExecutionState: text("hardware_execution_state").notNull(), package: jsonb("package").$type<FirmwareTestBringUpPackage>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("firmware_bringup_package_identity").on(table.packageId, table.packageDigest), problemIdx: index("firmware_bringup_package_problem_idx").on(table.problemDigest, table.createdAt) }));
export const firmwareBringUpProjectStates = pgTable("firmware_bringup_project_states", { projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), stateDigest: text("state_digest").notNull(), problemDigest: text("problem_digest").notNull(), state: jsonb("state").$type<FirmwareBringUpProjectState>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("firmware_bringup_project_state_identity").on(table.projectId, table.branchId, table.stateDigest), currentIdx: index("firmware_bringup_project_state_current_idx").on(table.projectId, table.branchId, table.createdAt) }));

// --- CD-12 supply-chain, manufacturing, and controlled release engineering ---
export const releaseEngineeringProblems = pgTable("release_engineering_problems", { problemId: text("problem_id").notNull(), problemDigest: text("problem_digest").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), firmwareBringUpDigest: text("firmware_bringup_digest").notNull(), requestedLevel: text("requested_level").notNull(), lifecycleState: text("lifecycle_state").notNull(), problem: jsonb("problem").$type<ReleaseEngineeringProblem>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("release_engineering_problem_identity").on(table.problemId, table.problemDigest), projectIdx: index("release_engineering_problem_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt) }));
export const authoritativeBoms = pgTable("authoritative_boms", { bomId: text("bom_id").notNull(), revision: integer("revision").notNull(), deterministicDigest: text("deterministic_digest").notNull(), variantMatrixDigest: text("variant_matrix_digest").notNull(), approvalState: text("approval_state").notNull(), bom: jsonb("bom").$type<AuthoritativeBom>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("authoritative_bom_identity").on(table.bomId, table.revision), digestUniq: uniqueIndex("authoritative_bom_digest_uniq").on(table.deterministicDigest) }));
export const procurementSnapshots = pgTable("procurement_snapshots", { snapshotId: text("snapshot_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), bomDigest: text("bom_digest").notNull(), buildScenarioDigest: text("build_scenario_digest").notNull(), observedAt: timestamp("observed_at", { withTimezone: true }).notNull(), completeness: text("completeness").notNull(), snapshot: jsonb("snapshot").$type<ProcurementSnapshot>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("procurement_snapshot_identity").on(table.snapshotId, table.deterministicDigest), bomIdx: index("procurement_snapshot_bom_idx").on(table.bomDigest, table.observedAt) }));
export const manufacturingArtifactManifests = pgTable("manufacturing_artifact_manifests", { manifestId: text("manifest_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), candidateRef: text("candidate_ref").notNull(), lifecycleState: text("lifecycle_state").notNull(), manifest: jsonb("manifest").$type<ManufacturingArtifactManifest>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("manufacturing_artifact_manifest_identity").on(table.manifestId, table.deterministicDigest), candidateIdx: index("manufacturing_artifact_manifest_candidate_idx").on(table.candidateRef, table.createdAt) }));
export const hardwareReleaseCandidates = pgTable("hardware_release_candidates", { candidateId: text("candidate_id").notNull(), revision: integer("revision").notNull(), deterministicDigest: text("deterministic_digest").notNull(), problemDigest: text("problem_digest").notNull(), lifecycleState: text("lifecycle_state").notNull(), candidate: jsonb("candidate").$type<HardwareReleaseCandidate>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("hardware_release_candidate_identity").on(table.candidateId, table.revision), digestUniq: uniqueIndex("hardware_release_candidate_digest_uniq").on(table.deterministicDigest) }));
export const releaseManifests = pgTable("release_manifests", { manifestId: text("manifest_id").notNull(), revision: integer("revision").notNull(), deterministicDigest: text("deterministic_digest").notNull(), problemDigest: text("problem_digest").notNull(), achievedLevel: text("achieved_level").notNull(), manifest: jsonb("manifest").$type<ReleaseManifest>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("release_manifest_identity").on(table.manifestId, table.revision), digestUniq: uniqueIndex("release_manifest_digest_uniq").on(table.deterministicDigest) }));
export const releaseLevelAssessments = pgTable("release_level_assessments", { assessmentId: text("assessment_id").primaryKey(), candidateRef: text("candidate_ref").notNull(), currentJustifiedLevel: text("current_justified_level").notNull(), verdict: text("verdict").notNull(), deterministicDigest: text("deterministic_digest").notNull(), assessment: jsonb("assessment").$type<ReleaseLevelAssessment>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ digestUniq: uniqueIndex("release_level_assessment_digest_uniq").on(table.deterministicDigest), candidateIdx: index("release_level_assessment_candidate_idx").on(table.candidateRef, table.createdAt) }));
export const releaseEngineeringProjectStates = pgTable("release_engineering_project_states", { projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), stateDigest: text("state_digest").notNull(), problemDigest: text("problem_digest").notNull(), state: jsonb("state").$type<ReleaseEngineeringProjectState>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("release_engineering_project_state_identity").on(table.projectId, table.branchId, table.stateDigest), currentIdx: index("release_engineering_project_state_current_idx").on(table.projectId, table.branchId, table.createdAt) }));

// --- CD-13 durable full-flow orchestration metadata ---
export const fullFlowRunContexts = pgTable("full_flow_run_contexts", { contextId: text("context_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), requestDigest: text("request_digest").notNull(), registryDigest: text("registry_digest").notNull(), budgetDigest: text("budget_digest").notNull(), context: jsonb("context").$type<PinnedRunContext>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("full_flow_run_context_identity").on(table.contextId, table.deterministicDigest), requestIdx: index("full_flow_run_context_request_idx").on(table.requestDigest, table.createdAt) }));
export const autonomousHardwareDesignRuns = pgTable("autonomous_hardware_design_runs", { runId: text("run_id").notNull(), revision: integer("revision").notNull(), deterministicDigest: text("deterministic_digest").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), lifecycleState: text("lifecycle_state").notNull(), requestedOutcome: text("requested_outcome").notNull(), run: jsonb("run").$type<AutonomousHardwareDesignRun>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("autonomous_hardware_design_run_identity").on(table.runId, table.revision), currentIdx: index("autonomous_hardware_design_run_current_idx").on(table.projectId, table.branchId, table.createdAt) }));
export const fullFlowRunEvents = pgTable("full_flow_run_events", { eventId: text("event_id").primaryKey(), runId: text("run_id").notNull(), sequence: integer("sequence").notNull(), deterministicDigest: text("deterministic_digest").notNull(), eventType: text("event_type").notNull(), event: jsonb("event").$type<RunEvent>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ sequenceUniq: uniqueIndex("full_flow_run_event_sequence_uniq").on(table.runId, table.sequence), runIdx: index("full_flow_run_event_run_idx").on(table.runId, table.createdAt) }));
export const fullFlowStageInvocations = pgTable("full_flow_stage_invocations", { invocationId: text("invocation_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), runId: text("run_id").notNull(), candidateRef: text("candidate_ref").notNull(), stageId: text("stage_id").notNull(), idempotencyKey: text("idempotency_key").notNull(), lifecycleState: text("lifecycle_state").notNull(), invocation: jsonb("invocation").$type<StageInvocation>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("full_flow_stage_invocation_identity").on(table.invocationId, table.deterministicDigest), idempotencyUniq: uniqueIndex("full_flow_stage_invocation_idempotency_uniq").on(table.idempotencyKey), runIdx: index("full_flow_stage_invocation_run_idx").on(table.runId, table.createdAt) }));
export const fullFlowCandidateGraphs = pgTable("full_flow_candidate_graphs", { graphId: text("graph_id").notNull(), revision: integer("revision").notNull(), deterministicDigest: text("deterministic_digest").notNull(), runId: text("run_id").notNull(), graph: jsonb("graph").$type<CandidateGraph>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("full_flow_candidate_graph_identity").on(table.graphId, table.revision), runIdx: index("full_flow_candidate_graph_run_idx").on(table.runId, table.createdAt) }));
export const fullFlowFinalVerdicts = pgTable("full_flow_final_verdicts", { verdictId: text("verdict_id").primaryKey(), runId: text("run_id").notNull(), verdict: text("verdict").notNull(), achievedOutcome: text("achieved_outcome"), deterministicDigest: text("deterministic_digest").notNull(), finalVerdict: jsonb("final_verdict").$type<AutonomousRunFinalVerdict>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ digestUniq: uniqueIndex("full_flow_final_verdict_digest_uniq").on(table.deterministicDigest), runIdx: index("full_flow_final_verdict_run_idx").on(table.runId, table.createdAt) }));
export const fullFlowReplayBundles = pgTable("full_flow_replay_bundles", { bundleId: text("bundle_id").notNull(), deterministicDigest: text("deterministic_digest").notNull(), sourceRunId: text("source_run_id").notNull(), bundle: jsonb("bundle").$type<ReplayBundle>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("full_flow_replay_bundle_identity").on(table.bundleId, table.deterministicDigest), sourceIdx: index("full_flow_replay_bundle_source_idx").on(table.sourceRunId, table.createdAt) }));
export const fullFlowProjectStates = pgTable("full_flow_project_states", { projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), stateDigest: text("state_digest").notNull(), prerequisiteDigest: text("prerequisite_digest").notNull(), state: jsonb("state").$type<FullFlowProjectState>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ identity: uniqueIndex("full_flow_project_state_identity").on(table.projectId, table.branchId, table.stateDigest), currentIdx: index("full_flow_project_state_current_idx").on(table.projectId, table.branchId, table.createdAt) }));

// ─── Footprint Binding Stage 1: authoritative project physical-binding truth ───
// Atomic catalog rows remain the authority for exact parts, evidence and CAD
// assets. These rows own only project/variant candidate choice and readiness.
export const physicalBindingRevisions = pgTable("physical_binding_revisions", {
  revisionId: text("revision_id").primaryKey(), bindingId: text("binding_id").notNull(), lineageId: text("lineage_id").notNull(), revision: integer("revision").notNull(),
  tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), boardInstanceId: text("board_instance_id").notNull(), componentInstanceId: text("component_instance_id").notNull(), variantScopeDigest: text("variant_scope_digest").notNull(),
  technicalDigest: text("technical_digest").notNull(), recordDigest: text("record_digest").notNull(), lifecycleState: text("lifecycle_state").notNull(), approvalState: text("approval_state").notNull(), technicalState: text("technical_state").notNull(), freshnessState: text("freshness_state").notNull(), conflictState: text("conflict_state").notNull(), applicabilityState: text("applicability_state").notNull(),
  binding: jsonb("binding").$type<ComponentPhysicalBinding>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), createdBy: text("created_by").notNull(),
}, (table) => ({
  bindingRevisionUniq: uniqueIndex("physical_binding_logical_revision_uniq").on(table.bindingId, table.revision),
  recordDigestUniq: uniqueIndex("physical_binding_record_digest_uniq").on(table.recordDigest),
  projectComponentIdx: index("physical_binding_project_component_idx").on(table.tenantId, table.projectId, table.branchId, table.componentInstanceId, table.variantScopeDigest),
  footprintDigestIdx: index("physical_binding_technical_digest_idx").on(table.technicalDigest),
  selectedOwnerUniq: uniqueIndex("physical_binding_revision_selected_owner_uniq").on(table.revisionId, table.tenantId, table.projectId, table.branchId, table.boardInstanceId, table.componentInstanceId, table.variantScopeDigest),
  auditOwnerUniq: uniqueIndex("physical_binding_revision_audit_owner_uniq").on(table.revisionId, table.bindingId, table.tenantId, table.projectId, table.branchId, table.componentInstanceId),
  migrationOwnerUniq: uniqueIndex("physical_binding_revision_migration_owner_uniq").on(table.revisionId, table.tenantId, table.projectId, table.branchId, table.componentInstanceId),
  assessmentOwnerUniq: uniqueIndex("physical_binding_revision_assessment_owner_uniq").on(table.revisionId, table.recordDigest),
  revisionCheck: check("physical_binding_revision_number_check", sql`${table.revision} > 0`),
  lifecycleCheck: check("physical_binding_revision_lifecycle_check", sql`${table.lifecycleState} IN ('draft','candidate','selected','superseded','withdrawn','orphaned','obsolete')`),
  approvalCheck: check("physical_binding_revision_approval_check", sql`${table.approvalState} IN ('unreviewed','pending','approved','rejected','expired','revoked')`),
  technicalCheck: check("physical_binding_revision_technical_check", sql`${table.technicalState} IN ('pending','valid','invalid','unsupported')`),
  freshnessCheck: check("physical_binding_revision_freshness_check", sql`${table.freshnessState} IN ('current','stale','unknown','missing_source')`),
  conflictCheck: check("physical_binding_revision_conflict_check", sql`${table.conflictState} IN ('none','present')`),
  applicabilityCheck: check("physical_binding_revision_applicability_check", sql`${table.applicabilityState} IN ('applicable','not_applicable','unknown')`),
  identityCheck: check("physical_binding_revision_identity_check", sql`btrim(${table.revisionId}) <> '' AND btrim(${table.bindingId}) <> '' AND btrim(${table.lineageId}) <> '' AND btrim(${table.tenantId}) <> '' AND btrim(${table.projectId}) <> '' AND btrim(${table.branchId}) <> '' AND btrim(${table.boardInstanceId}) <> '' AND btrim(${table.componentInstanceId}) <> '' AND btrim(${table.variantScopeDigest}) <> '' AND btrim(${table.technicalDigest}) <> '' AND btrim(${table.recordDigest}) <> '' AND btrim(${table.createdBy}) <> ''`),
}));

export const physicalBindingSets = pgTable("physical_binding_sets", {
  setId: text("set_id").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), boardInstanceId: text("board_instance_id").notNull(), componentInstanceId: text("component_instance_id").notNull(), variantScopeDigest: text("variant_scope_digest").notNull(), revision: integer("revision").notNull(), effectiveSelectedRevisionId: text("effective_selected_revision_id"), recordDigest: text("record_digest").notNull(), bindingSet: jsonb("binding_set").$type<ComponentPhysicalBindingSet>().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({
  scopeUniq: uniqueIndex("physical_binding_set_scope_uniq").on(table.tenantId, table.projectId, table.branchId, table.boardInstanceId, table.componentInstanceId, table.variantScopeDigest),
  projectIdx: index("physical_binding_set_project_idx").on(table.tenantId, table.projectId, table.branchId, table.updatedAt),
  selectedIdx: index("physical_binding_set_selected_idx").on(table.effectiveSelectedRevisionId),
  auditOwnerUniq: uniqueIndex("physical_binding_set_audit_owner_uniq").on(table.setId, table.tenantId, table.projectId, table.branchId, table.componentInstanceId),
  revisionCheck: check("physical_binding_set_revision_number_check", sql`${table.revision} > 0`),
  identityCheck: check("physical_binding_set_identity_check", sql`btrim(${table.setId}) <> '' AND btrim(${table.tenantId}) <> '' AND btrim(${table.projectId}) <> '' AND btrim(${table.branchId}) <> '' AND btrim(${table.boardInstanceId}) <> '' AND btrim(${table.componentInstanceId}) <> '' AND btrim(${table.variantScopeDigest}) <> '' AND btrim(${table.recordDigest}) <> ''`),
  // Migration 0025 is authoritative for DEFERRABLE INITIALLY DEFERRED; Drizzle 0.45 does not expose that FK option.
  selectedRevisionFk: foreignKey({ name: "physical_binding_set_selected_revision_fk", columns: [table.effectiveSelectedRevisionId, table.tenantId, table.projectId, table.branchId, table.boardInstanceId, table.componentInstanceId, table.variantScopeDigest], foreignColumns: [physicalBindingRevisions.revisionId, physicalBindingRevisions.tenantId, physicalBindingRevisions.projectId, physicalBindingRevisions.branchId, physicalBindingRevisions.boardInstanceId, physicalBindingRevisions.componentInstanceId, physicalBindingRevisions.variantScopeDigest] }).onDelete("no action").onUpdate("no action"),
}));

export const physicalBindingAuditEvents = pgTable("physical_binding_audit_events", {
  eventId: text("event_id").primaryKey(), aggregateSetId: text("aggregate_set_id").notNull(), fromRevisionId: text("from_revision_id").notNull(), toRevisionId: text("to_revision_id").notNull(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), componentInstanceId: text("component_instance_id").notNull(), bindingId: text("binding_id").notNull(), action: text("action").notNull(), idempotencyKey: text("idempotency_key").notNull(), eventDigest: text("event_digest").notNull(), event: jsonb("event").$type<PhysicalBindingAuditEvent>().notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => ({
  idempotencyUniq: uniqueIndex("physical_binding_audit_idempotency_uniq").on(table.tenantId, table.projectId, table.branchId, table.idempotencyKey),
  bindingIdx: index("physical_binding_audit_binding_idx").on(table.bindingId, table.occurredAt),
  actionCheck: check("physical_binding_audit_action_check", sql`${table.action} IN ('submit_candidate','select','request_approval','approve','reject','revoke','mark_stale','revalidate','supersede','orphan','withdraw','create_candidate','legacy_migrate','mapping_update')`),
  identityCheck: check("physical_binding_audit_identity_check", sql`btrim(${table.eventId}) <> '' AND btrim(${table.aggregateSetId}) <> '' AND btrim(${table.fromRevisionId}) <> '' AND btrim(${table.toRevisionId}) <> '' AND btrim(${table.tenantId}) <> '' AND btrim(${table.projectId}) <> '' AND btrim(${table.branchId}) <> '' AND btrim(${table.componentInstanceId}) <> '' AND btrim(${table.bindingId}) <> '' AND btrim(${table.idempotencyKey}) <> '' AND btrim(${table.eventDigest}) <> ''`),
  setOwnerFk: foreignKey({ name: "physical_binding_audit_set_owner_fk", columns: [table.aggregateSetId, table.tenantId, table.projectId, table.branchId, table.componentInstanceId], foreignColumns: [physicalBindingSets.setId, physicalBindingSets.tenantId, physicalBindingSets.projectId, physicalBindingSets.branchId, physicalBindingSets.componentInstanceId] }).onDelete("no action").onUpdate("no action"),
  fromRevisionFk: foreignKey({ name: "physical_binding_audit_from_revision_owner_fk", columns: [table.fromRevisionId, table.bindingId, table.tenantId, table.projectId, table.branchId, table.componentInstanceId], foreignColumns: [physicalBindingRevisions.revisionId, physicalBindingRevisions.bindingId, physicalBindingRevisions.tenantId, physicalBindingRevisions.projectId, physicalBindingRevisions.branchId, physicalBindingRevisions.componentInstanceId] }).onDelete("no action").onUpdate("no action"),
  toRevisionFk: foreignKey({ name: "physical_binding_audit_to_revision_owner_fk", columns: [table.toRevisionId, table.bindingId, table.tenantId, table.projectId, table.branchId, table.componentInstanceId], foreignColumns: [physicalBindingRevisions.revisionId, physicalBindingRevisions.bindingId, physicalBindingRevisions.tenantId, physicalBindingRevisions.projectId, physicalBindingRevisions.branchId, physicalBindingRevisions.componentInstanceId] }).onDelete("no action").onUpdate("no action"),
}));

export const physicalBindingMigrationRecords = pgTable("physical_binding_migration_records", {
  migrationKey: text("migration_key").primaryKey(), tenantId: text("tenant_id").notNull(), projectId: text("project_id").notNull(), branchId: text("branch_id").notNull(), componentInstanceId: text("component_instance_id").notNull(), sourceSchemaVersion: text("source_schema_version").notNull(), candidateRevisionId: text("candidate_revision_id").notNull(), status: text("status").notNull(), dryRun: boolean("dry_run").notNull(), recordDigest: text("record_digest").notNull(), record: jsonb("record").$type<PhysicalBindingMigrationRecord>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  projectIdx: index("physical_binding_migration_project_idx").on(table.tenantId, table.projectId, table.branchId, table.createdAt),
  recordDigestUniq: uniqueIndex("physical_binding_migration_digest_uniq").on(table.recordDigest),
  statusCheck: check("physical_binding_migration_status_check", sql`${table.status} IN ('migrated','skipped','ambiguous','failed')`),
  identityCheck: check("physical_binding_migration_identity_check", sql`btrim(${table.migrationKey}) <> '' AND btrim(${table.tenantId}) <> '' AND btrim(${table.projectId}) <> '' AND btrim(${table.branchId}) <> '' AND btrim(${table.componentInstanceId}) <> '' AND btrim(${table.sourceSchemaVersion}) <> '' AND btrim(${table.candidateRevisionId}) <> '' AND btrim(${table.recordDigest}) <> ''`),
  revisionOwnerFk: foreignKey({ name: "physical_binding_migration_revision_owner_fk", columns: [table.candidateRevisionId, table.tenantId, table.projectId, table.branchId, table.componentInstanceId], foreignColumns: [physicalBindingRevisions.revisionId, physicalBindingRevisions.tenantId, physicalBindingRevisions.projectId, physicalBindingRevisions.branchId, physicalBindingRevisions.componentInstanceId] }).onDelete("no action").onUpdate("no action"),
}));

export const physicalReadinessAssessments = pgTable("physical_readiness_assessments", {
  assessmentId: text("assessment_id").primaryKey(), bindingRevisionId: text("binding_revision_id").notNull(), bindingRecordDigest: text("binding_record_digest").notNull(), policyVersion: text("policy_version").notNull(), layoutState: text("layout_state").notNull(), manufacturingState: text("manufacturing_state").notNull(), assessmentDigest: text("assessment_digest").notNull(), assessment: jsonb("assessment").$type<PhysicalReadinessAssessment>().notNull(), assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull(),
}, (table) => ({
  assessmentDigestUniq: uniqueIndex("physical_readiness_assessment_digest_uniq").on(table.assessmentDigest),
  bindingIdx: index("physical_readiness_binding_idx").on(table.bindingRevisionId, table.assessedAt),
  layoutCheck: check("physical_readiness_layout_state_check", sql`${table.layoutState} IN ('ready','not_ready','not_applicable')`),
  manufacturingCheck: check("physical_readiness_manufacturing_state_check", sql`${table.manufacturingState} IN ('ready','not_ready','not_applicable')`),
  identityCheck: check("physical_readiness_identity_check", sql`btrim(${table.assessmentId}) <> '' AND btrim(${table.bindingRevisionId}) <> '' AND btrim(${table.bindingRecordDigest}) <> '' AND btrim(${table.policyVersion}) <> '' AND btrim(${table.assessmentDigest}) <> ''`),
  revisionOwnerFk: foreignKey({ name: "physical_readiness_revision_owner_fk", columns: [table.bindingRevisionId, table.bindingRecordDigest], foreignColumns: [physicalBindingRevisions.revisionId, physicalBindingRevisions.recordDigest] }).onDelete("no action").onUpdate("no action"),
}));

// ─── Footprint Binding durable workflow transport ───────────────────────────
// These tables persist owner-domain records and recoverable effects. They do
// not define binding, mapping, policy, PCB-sync, or assignment semantics; each
// stage's versioned payload remains the authoritative domain contract.
export const durableWorkflowHeads = pgTable("durable_workflow_heads", {
  headId: text("head_id").primaryKey(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateKey: text("aggregate_key").notNull(),
  tenantId: text("tenant_id").notNull(),
  projectId: text("project_id").notNull(),
  branchId: text("branch_id").notNull(),
  revision: integer("revision").notNull(),
  recordId: text("record_id").notNull(),
  recordDigest: text("record_digest").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({
  aggregateUniq: uniqueIndex("durable_workflow_head_scoped_aggregate_uniq").on(table.tenantId, table.projectId, table.branchId, table.aggregateType, table.aggregateKey),
  projectIdx: index("durable_workflow_head_project_idx").on(table.tenantId, table.projectId, table.branchId, table.aggregateType),
}));

export const durableWorkflowRecords = pgTable("durable_workflow_records", {
  recordId: text("record_id").primaryKey(),
  headId: text("head_id").notNull(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateKey: text("aggregate_key").notNull(),
  tenantId: text("tenant_id").notNull(),
  projectId: text("project_id").notNull(),
  branchId: text("branch_id").notNull(),
  revision: integer("revision").notNull(),
  recordDigest: text("record_digest").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  aggregateRevisionUniq: uniqueIndex("durable_workflow_record_scoped_revision_uniq").on(table.tenantId, table.projectId, table.branchId, table.aggregateType, table.aggregateKey, table.revision),
  aggregateHistoryIdx: index("durable_workflow_record_scoped_history_idx").on(table.tenantId, table.projectId, table.branchId, table.aggregateType, table.aggregateKey, table.revision),
  projectIdx: index("durable_workflow_record_project_idx").on(table.tenantId, table.projectId, table.branchId, table.aggregateType, table.createdAt),
}));

export const durableWorkflowReplays = pgTable("durable_workflow_replays", {
  replayId: text("replay_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  projectId: text("project_id").notNull(),
  branchId: text("branch_id").notNull(),
  scopeKey: text("scope_key").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  committedAt: timestamp("committed_at", { withTimezone: true }).notNull(),
}, (table) => ({ replayUniq: uniqueIndex("durable_workflow_replay_scoped_uniq").on(table.tenantId, table.projectId, table.branchId, table.scopeKey, table.idempotencyKey) }));

export const durableWorkflowOutbox = pgTable("durable_workflow_outbox", {
  eventId: text("event_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  projectId: text("project_id").notNull(),
  branchId: text("branch_id").notNull(),
  scopeKey: text("scope_key").notNull(),
  ownerAggregateType: text("owner_aggregate_type").notNull(),
  ownerAggregateKey: text("owner_aggregate_key").notNull(),
  ownerAggregateRevision: integer("owner_aggregate_revision").notNull(),
  eventType: text("event_type").notNull(),
  eventVersion: integer("event_version").notNull(),
  topic: text("topic").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadDigest: text("payload_digest").notNull(),
  eventDigest: text("event_digest").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  state: text("state").$type<"pending" | "processing" | "completed" | "failed">().notNull(),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
  leaseOwner: text("lease_owner"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  terminalAt: timestamp("terminal_at", { withTimezone: true }),
}, (table) => ({
  semanticUniq: uniqueIndex("durable_workflow_outbox_owner_event_uniq").on(table.tenantId, table.projectId, table.branchId, table.ownerAggregateType, table.ownerAggregateKey, table.ownerAggregateRevision, table.eventType, table.eventVersion, table.idempotencyKey),
  dispatchIdx: index("durable_workflow_outbox_scoped_dispatch_idx").on(table.tenantId, table.projectId, table.branchId, table.state, table.availableAt, table.createdAt),
  ownerIdx: index("durable_workflow_outbox_owner_idx").on(table.tenantId, table.projectId, table.branchId, table.ownerAggregateType, table.ownerAggregateKey, table.ownerAggregateRevision),
  ownerRevisionCheck: check("durable_workflow_outbox_owner_revision_check", sql`${table.ownerAggregateRevision} > 0`),
  eventVersionCheck: check("durable_workflow_outbox_event_version_check", sql`${table.eventVersion} > 0`),
  attemptsCheck: check("durable_workflow_outbox_attempts_check", sql`${table.attempts} >= 0`),
  leaseCheck: check("durable_workflow_outbox_lease_check", sql`(${table.state} = 'processing' AND ${table.leaseOwner} IS NOT NULL AND ${table.leaseToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL) OR (${table.state} <> 'processing' AND ${table.leaseOwner} IS NULL AND ${table.leaseToken} IS NULL AND ${table.leaseExpiresAt} IS NULL)`),
}));

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
export type AtomicPartRevisionRecord = typeof atomicPartRevisions.$inferSelect;
export type NewAtomicPartRevisionRecord = typeof atomicPartRevisions.$inferInsert;
export type AtomicSelectionRecord = typeof atomicSelections.$inferSelect;
export type ConstraintProgramRecord = typeof constraintPrograms.$inferSelect;
export type ConstraintEvaluationRecord = typeof constraintEvaluations.$inferSelect;
export type RequirementSourceRevisionRecord = typeof requirementSourceRevisions.$inferSelect;
export type DesignRequirementPackageRecord = typeof designRequirementPackages.$inferSelect;
export type RequirementTransactionRecordRow = typeof requirementTransactionRecords.$inferSelect;
export type DesignCapabilityProfileRecord = typeof designCapabilityProfiles.$inferSelect;
export type ArchitectureProblemRecord = typeof architectureProblems.$inferSelect;
export type ArchitectureCandidateRecord = typeof architectureCandidates.$inferSelect;
export type ArchitectureComparisonRecord = typeof architectureComparisons.$inferSelect;
export type ArchitectureSelectionRecord = typeof architectureSelectionDecisions.$inferSelect;
export type ArchitectureTransactionRecordRow = typeof architectureTransactionRecords.$inferSelect;
export type PowerUpstreamSignoffRecord = typeof powerUpstreamSignoffs.$inferSelect;
export type PowerArchitectureProblemRecord = typeof powerArchitectureProblems.$inferSelect;
export type PowerArchitectureCandidateRecord = typeof powerArchitectureCandidates.$inferSelect;
export type PowerSelectionDecisionRecord = typeof powerSelectionDecisions.$inferSelect;
export type PowerTransactionRecordRow = typeof powerTransactionRecords.$inferSelect;
export type InterfaceUpstreamSignoffRecord = typeof interfaceUpstreamSignoffs.$inferSelect;
export type InterfacePlanningProblemRecord = typeof interfacePlanningProblems.$inferSelect;
export type InterfacePlanningCandidateRecord = typeof interfacePlanningCandidates.$inferSelect;
export type InterfaceSelectionDecisionRecord = typeof interfaceSelectionDecisions.$inferSelect;
export type InterfacePinFactSnapshotRecord = typeof interfacePinFactSnapshots.$inferSelect;
export type InterfacePinAllocationRecord = typeof interfacePinAllocations.$inferSelect;
export type InterfaceTransactionRecordRow = typeof interfaceTransactionRecords.$inferSelect;
export type CircuitKnowledgeProblemRecord = typeof circuitKnowledgeProblems.$inferSelect;
export type CircuitRecipeSourceBundleRecord = typeof circuitRecipeSourceBundles.$inferSelect;
export type CircuitRecipeDefinitionRecord = typeof circuitRecipeDefinitions.$inferSelect;
export type CompiledCircuitRecipeRecord = typeof compiledCircuitRecipes.$inferSelect;
export type CircuitRecipeLibraryRecord = typeof circuitRecipeLibraries.$inferSelect;
export type CircuitKnowledgeTransactionRecordRow = typeof circuitKnowledgeTransactionRecords.$inferSelect;
export type ComponentSelectionProblemRecord = typeof componentSelectionProblems.$inferSelect;
export type ComponentSelectionCatalogSnapshotRecord = typeof componentSelectionCatalogSnapshots.$inferSelect;
export type ComponentSelectionSourcingSnapshotRecord = typeof componentSelectionSourcingSnapshots.$inferSelect;
export type ComponentSelectionOfferObservationRecord = typeof componentSelectionOfferObservations.$inferSelect;
export type ComponentSelectionEvaluationRecord = typeof componentSelectionEvaluations.$inferSelect;
export type ComponentSelectionCandidateRecord = typeof componentSelectionCandidates.$inferSelect;
export type ComponentSelectionAlternativeRecord = typeof componentSelectionAlternatives.$inferSelect;
export type ComponentSelectionDecisionRecord = typeof componentSelectionDecisions.$inferSelect;
export type ComponentSelectionTransactionRecordRow = typeof componentSelectionTransactionRecords.$inferSelect;
export type CalculationProblemRecord = typeof calculationProblems.$inferSelect;
export type CalculationRegistrySnapshotRecord = typeof calculationRegistrySnapshots.$inferSelect;
export type CalculationGraphRecord = typeof calculationGraphs.$inferSelect;
export type CalculationReportRecord = typeof calculationReports.$inferSelect;
export type CalculationDecisionRecord = typeof calculationDecisions.$inferSelect;
export type CalculationTransactionRecordRow = typeof calculationTransactionRecords.$inferSelect;
export type SchematicCompilationProblemRecord = typeof schematicCompilationProblems.$inferSelect;
export type SchematicSemanticGraphRecord = typeof schematicSemanticGraphs.$inferSelect;
export type SchematicDiagramViewRecord = typeof schematicDiagramViews.$inferSelect;
export type SchematicCandidateRecord = typeof schematicCandidates.$inferSelect;
export type SchematicDecisionRecord = typeof schematicDecisions.$inferSelect;
export type SchematicTransactionRecordRow = typeof schematicTransactionRecords.$inferSelect;
export type CircuitVerificationProblemRecord = typeof circuitVerificationProblems.$inferSelect;
export type CircuitRuleRegistryRecord = typeof circuitRuleRegistries.$inferSelect;
export type CircuitRuleDenominatorRecord = typeof circuitRuleDenominators.$inferSelect;
export type CircuitOracleRunRecord = typeof circuitOracleRuns.$inferSelect;
export type CircuitFindingRecord = typeof circuitFindings.$inferSelect;
export type CircuitWaiverRecord = typeof circuitWaivers.$inferSelect;
export type CircuitOracleParityRecord = typeof circuitOracleParityReports.$inferSelect;
export type CircuitReadinessRecord = typeof circuitReadinessReports.$inferSelect;
export type CircuitVerificationProjectStateRecord = typeof circuitVerificationProjectStates.$inferSelect;
export type CircuitVerificationTransactionRecordRow = typeof circuitVerificationTransactionRecords.$inferSelect;
export type SimulationVerificationProblemRecord = typeof simulationVerificationProblems.$inferSelect;
export type SimulationModelRegistryRecord = typeof simulationModelRegistries.$inferSelect;
export type SimulationTestbenchRegistryRecord = typeof simulationTestbenchRegistries.$inferSelect;
export type SimulationCoverageDenominatorRecord = typeof simulationCoverageDenominators.$inferSelect;
export type SimulationRunRecord = typeof simulationRuns.$inferSelect;
export type SimulationWaveformArtifactRecord = typeof simulationWaveformArtifacts.$inferSelect;
export type SimulationCoverageMatrixRecord = typeof simulationCoverageMatrices.$inferSelect;
export type SimulationCampaignRecord = typeof simulationCampaigns.$inferSelect;
export type SimulationReadinessReportRecord = typeof simulationReadinessReports.$inferSelect;
export type ModelSimulationProjectStateRecord = typeof modelSimulationProjectStates.$inferSelect;
export type FirmwareBringUpProblemRecord = typeof firmwareBringUpProblems.$inferSelect;
export type ProgrammableDeviceEvidenceSnapshotRecord = typeof programmableDeviceEvidenceSnapshots.$inferSelect;
export type FirmwareBringUpCoverageReportRecord = typeof firmwareBringUpCoverageReports.$inferSelect;
export type FirmwareBringUpReadinessDecisionRecord = typeof firmwareBringUpReadinessDecisions.$inferSelect;
export type FirmwareBringUpPackageRecord = typeof firmwareBringUpPackages.$inferSelect;
export type FirmwareBringUpProjectStateRecord = typeof firmwareBringUpProjectStates.$inferSelect;
export type ReleaseEngineeringProblemRecord = typeof releaseEngineeringProblems.$inferSelect;
export type AuthoritativeBomRecord = typeof authoritativeBoms.$inferSelect;
export type ProcurementSnapshotRecord = typeof procurementSnapshots.$inferSelect;
export type ManufacturingArtifactManifestRecord = typeof manufacturingArtifactManifests.$inferSelect;
export type HardwareReleaseCandidateRecord = typeof hardwareReleaseCandidates.$inferSelect;
export type ReleaseManifestRecord = typeof releaseManifests.$inferSelect;
export type ReleaseLevelAssessmentRecord = typeof releaseLevelAssessments.$inferSelect;
export type ReleaseEngineeringProjectStateRecord = typeof releaseEngineeringProjectStates.$inferSelect;
export type FullFlowRunContextRecord = typeof fullFlowRunContexts.$inferSelect;
export type AutonomousHardwareDesignRunRecord = typeof autonomousHardwareDesignRuns.$inferSelect;
export type FullFlowRunEventRecord = typeof fullFlowRunEvents.$inferSelect;
export type FullFlowStageInvocationRecord = typeof fullFlowStageInvocations.$inferSelect;
export type FullFlowCandidateGraphRecord = typeof fullFlowCandidateGraphs.$inferSelect;
export type FullFlowFinalVerdictRecord = typeof fullFlowFinalVerdicts.$inferSelect;
export type FullFlowReplayBundleRecord = typeof fullFlowReplayBundles.$inferSelect;
export type FullFlowProjectStateRecord = typeof fullFlowProjectStates.$inferSelect;
export type DurableWorkflowHeadRecord = typeof durableWorkflowHeads.$inferSelect;
export type DurableWorkflowRecord = typeof durableWorkflowRecords.$inferSelect;
export type DurableWorkflowReplayRecord = typeof durableWorkflowReplays.$inferSelect;
export type DurableWorkflowOutboxRecord = typeof durableWorkflowOutbox.$inferSelect;
