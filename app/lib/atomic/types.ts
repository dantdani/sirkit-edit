/**
 * Stage 5 atomic component domain contract.
 *
 * CAD assets remain independent immutable objects. An AtomicPartRevision only
 * binds exact versions; it never flattens symbol, footprint, and 3D data into a
 * mutable "part" row. All types are JSON-safe so approved snapshots can be
 * embedded in projects and inspected offline.
 */

export type Id = string;
export type IsoDate = string;
export type Sha256 = string;

export type RecordState =
  | "quarantined"
  | "draft"
  | "needs_review"
  | "approved"
  | "published"
  | "deprecated"
  | "revoked"
  | "superseded";

export type ClaimState =
  | "source_backed"
  | "verified"
  | "inferred"
  | "conflicting"
  | "unknown"
  | "stale"
  | "not_applicable";

export type SourceClass =
  | "manufacturer_datasheet"
  | "manufacturer_cad"
  | "manufacturer_application_note"
  | "official_kicad_library"
  | "distributor_catalog"
  | "third_party_cad"
  | "organization_authored"
  | "cad_geometry_inference"
  | "ocr_extraction"
  | "llm_suggestion"
  | "human_reviewed";

export type ExtractionMethod =
  | "manual"
  | "structured_api"
  | "kicad_parser"
  | "deterministic_inference"
  | "ocr"
  | "llm";

export type LicenseDisposition =
  | "redistributable"
  | "metadata_only"
  | "private_review_only"
  | "prohibited"
  | "unknown";

export interface LicenseRecord {
  id: Id;
  spdxId: string | null;
  name: string;
  sourceUrl?: string;
  attribution?: string;
  rawRedistribution: LicenseDisposition;
  derivedRedistribution: LicenseDisposition;
  exportDisposition: LicenseDisposition;
  reviewedAt?: IsoDate;
  reviewedBy?: Id;
}

export interface SourceIdentity {
  id: Id;
  sourceClass: SourceClass;
  name: string;
  canonicalUri?: string;
  officialDomains: string[];
  licenseId: Id;
}

export interface SourceRecord {
  id: Id;
  sourceId: Id;
  revision: string;
  contentHash: Sha256;
  retrievedAt: IsoDate;
  effectiveAt?: IsoDate;
  expiresAt?: IsoDate;
  locator: string;
  mediaType: string;
  rawObjectId?: Id;
  confidential: boolean;
}

export interface EvidenceRef {
  id: Id;
  sourceRecordId: Id;
  locator: string;
  excerptHash?: Sha256;
  extractionMethod: ExtractionMethod;
  extractorVersion: string;
  extractedAt: IsoDate;
  reviewerId?: Id;
  reviewedAt?: IsoDate;
  confidence?: number;
}

export interface Manufacturer {
  id: Id;
  canonicalName: string;
  aliases: string[];
  officialDomains: string[];
  predecessorIds?: Id[];
}

export interface ManufacturerFamily {
  id: Id;
  manufacturerId: Id;
  publishedName: string;
  sourceEvidenceIds: Id[];
}

export interface ExactManufacturerPart {
  id: Id;
  manufacturerId: Id;
  exactMpn: string;
  normalizedSearchKey: string;
  familyId?: Id;
  suffixMeaning?: Record<string, string>;
  state: "active" | "deprecated" | "revoked";
  aliasEvidenceIds: Id[];
}

export interface GenericDevice {
  id: Id;
  name: string;
  category: string;
  description?: string;
}

export interface SupplierPart {
  id: Id;
  supplierId: Id;
  supplierSku: string;
  exactPartId: Id;
  packaging: "cut_tape" | "reel" | "tray" | "tube" | "bulk" | "other" | "unknown";
  region?: string;
  orderMultiple?: number;
}

export interface SupplierOfferSnapshot {
  id: Id;
  supplierPartId: Id;
  observedAt: IsoDate;
  expiresAt: IsoDate;
  currency?: string;
  stock: number | null;
  moq: number | null;
  leadTimeDays: number | null;
  lifecycle: "active" | "nrnd" | "last_time_buy" | "eol" | "obsolete" | "unknown";
  priceBreaks: Array<{ quantity: number; unitPrice: number }>;
  sourceRecordId: Id;
}

export interface AssetOrigin {
  sourceRecordId: Id;
  libraryNickname: string;
  logicalName: string;
  sourceUri: string;
  licenseId: Id;
}

export interface ParseDiagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  path?: string;
}

export interface RawContentObject {
  id: Id;
  contentHash: Sha256;
  mediaType: string;
  encoding: "utf8" | "base64";
  content: string;
  bytes: number;
  licenseId: Id;
  confidential: boolean;
}

export type AssetValidationState = "valid" | "valid_with_limitations" | "unsupported" | "invalid";

export interface SymbolPinDefinition {
  id: Id;
  number: string;
  name: string;
  electricalType: string;
  unit: number;
  bodyStyle: number;
  hidden: boolean;
  stacked: boolean;
  swapGroup?: string;
  position: { x: number; y: number };
  orientation: 0 | 90 | 180 | 270;
  length: number;
}

export interface SymbolAssetVersion {
  kind: "symbol";
  logicalAssetId: Id;
  versionId: Id;
  contentHash: Sha256;
  semanticHash: Sha256;
  origin: AssetOrigin;
  formatVersion: string;
  generator?: string;
  symbolName: string;
  extends?: string;
  aliases: string[];
  unitCount: number;
  bodyStyles: number[];
  pins: SymbolPinDefinition[];
  properties: Record<string, string>;
  footprintFilters: string[];
  rawContentObjectId: Id;
  validationState: AssetValidationState;
  diagnostics: ParseDiagnostic[];
  /** Resolved symbol definition used by the current renderer/exporter. */
  rawSymbolSExpression: string;
}

export interface PhysicalPadDefinition {
  id: Id;
  number: string;
  padType: "smd" | "thru_hole" | "np_thru_hole";
  shape: string;
  xNm: number;
  yNm: number;
  rotationDeg: number;
  widthNm: number;
  heightNm: number;
  drillNm?: number;
  plated?: boolean;
  solderMaskMarginNm?: number;
  solderPasteMarginNm?: number;
  solderPasteMarginRatio?: number;
  layers: string[];
  mechanical: boolean;
}

export interface ModelReference {
  path: string;
  modelVersionId?: Id;
  state: "resolved" | "missing" | "blocked" | "unsupported";
  offset: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface FootprintAssetVersion {
  kind: "footprint";
  logicalAssetId: Id;
  versionId: Id;
  contentHash: Sha256;
  semanticHash: Sha256;
  origin: AssetOrigin;
  formatVersion: string;
  generator?: string;
  footprintName: string;
  mountingTechnology: "smd" | "through_hole" | "mixed" | "unknown";
  pads: PhysicalPadDefinition[];
  modelReferences: ModelReference[];
  geometrySummary: {
    bodyWidthNm?: number;
    bodyLengthNm?: number;
    courtyardWidthNm?: number;
    courtyardLengthNm?: number;
    hasFab: boolean;
    hasSilk: boolean;
    unsupportedGeometry: string[];
  };
  rawContentObjectId: Id;
  validationState: AssetValidationState;
  diagnostics: ParseDiagnostic[];
}

export interface ModelAssetVersion {
  kind: "model";
  logicalAssetId: Id;
  versionId: Id;
  contentHash: Sha256;
  origin: AssetOrigin;
  mediaType: string;
  coordinateConvention: string | null;
  units: string | null;
  boundingBox?: { x: number; y: number; z: number; unit: string };
  inspectionState: "not_inspected" | "safe" | "unsupported" | "rejected";
  rawContentObjectId: Id;
  diagnostics: ParseDiagnostic[];
}

export type QuantityDimension =
  | "dimensionless"
  | "voltage"
  | "current"
  | "resistance"
  | "capacitance"
  | "inductance"
  | "power"
  | "frequency"
  | "time"
  | "temperature"
  | "length"
  | "mass";

export interface Quantity {
  dimension: QuantityDimension;
  /** SI-base numeric value (kelvin for absolute temperature, metre for length). */
  value?: number;
  min?: number;
  typical?: number;
  max?: number;
  toleranceMinus?: number;
  tolerancePlus?: number;
  sourceText: string;
  sourceUnit: string;
}

export type LimitSemantics =
  | "absolute_maximum"
  | "recommended_operating"
  | "guaranteed"
  | "typical"
  | "nominal"
  | "test_condition"
  | "characterization_only"
  | "configurable"
  | "derating";

export interface ClaimScope {
  kind: "part" | "package" | "terminal" | "rail" | "variant" | "supplier_offer";
  id?: Id;
}

export type EngineeringFacet =
  | "identity"
  | "terminal"
  | "supply"
  | "package"
  | "mechanical"
  | "temperature"
  | "qualification"
  | "lifecycle"
  | "compliance"
  | "sourcing"
  | "passive"
  | "diode_led_tvs"
  | "transistor_mosfet"
  | "regulator_power_converter"
  | "op_amp_comparator"
  | "logic_level_shifter"
  | "processor_memory"
  | "oscillator_crystal"
  | "connector_switch_relay"
  | "sensor_interface_transceiver"
  | "protection_power_entry"
  | "capability"
  | `organization_extension:${string}`;

export interface EngineeringClaim {
  id: Id;
  property: string;
  facet: EngineeringFacet;
  value: Quantity | string | number | boolean | string[] | null;
  limit: LimitSemantics;
  conditions: Record<string, Quantity | string | number | boolean>;
  scope: ClaimScope;
  state: ClaimState;
  evidenceIds: Id[];
  supersedesClaimId?: Id;
  conflictsWith: Id[];
  safetyCritical: boolean;
}

export type GuidanceStatus =
  | "normalized_fact"
  | "structured_rule_template"
  | "review_item"
  | "unsupported_prose"
  | "conflicting";

export type GuidanceCategory =
  | "decoupling"
  | "regulator_stability"
  | "thermal_pad"
  | "boot_strap"
  | "reset"
  | "do_not_connect"
  | "layout"
  | "reference_design"
  | "other";

export interface ApplicationGuidance {
  id: Id;
  category: GuidanceCategory;
  status: GuidanceStatus;
  scope: ClaimScope;
  conditions: Record<string, Quantity | string | boolean>;
  normalizedTemplate?: Record<string, unknown>;
  sourceText: string;
  evidenceIds: Id[];
  /** Always false in Stage 5; Stage 6 owns executable enforcement. */
  executable: false;
}

export type TerminalClassification =
  | "electrical"
  | "nc"
  | "dnc"
  | "nu"
  | "mechanical"
  | "exposed_thermal"
  | "unknown";

export interface ManufacturerTerminal {
  id: Id;
  publishedIdentifier: string;
  function: string;
  classification: TerminalClassification;
  evidenceIds: Id[];
}

export interface TerminalMappingEntry {
  manufacturerTerminalId: Id;
  symbolPinIds: Id[];
  logicalPadNumbers: string[];
  physicalPadIds: Id[];
  classification: TerminalClassification;
  internallyCommonGroup?: string;
  evidenceIds: Id[];
}

export type MappingCertificateState =
  | "approved"
  | "candidate"
  | "missing"
  | "ambiguous"
  | "conflicting"
  | "stale";

export interface MappingCertificate {
  id: Id;
  exactPartId?: Id;
  genericDeviceId?: Id;
  symbolVersionId: Id;
  footprintVersionId: Id;
  entries: TerminalMappingEntry[];
  requiredTerminalIds: Id[];
  symbolPinIds: Id[];
  logicalPadNumbers: string[];
  missingTerminalIds: Id[];
  missingSymbolPinIds: Id[];
  missingPadNumbers: string[];
  extraElectricalPadNumbers: string[];
  ambiguous: string[];
  mechanicalPadIds: Id[];
  exposedPadIds: Id[];
  evidenceIds: Id[];
  packageProofId?: Id;
  validatorVersion: string;
  schemaVersion: 1;
  semanticHash: Sha256;
  state: MappingCertificateState;
}

export interface PackageProof {
  id: Id;
  exactPartId?: Id;
  footprintVersionId: Id;
  packageCode?: string;
  mountingTechnology?: string;
  pinCount?: number;
  numberingConvention?: string;
  pitch?: Quantity;
  bodyWidth?: Quantity;
  bodyLength?: Quantity;
  leadSpan?: Quantity;
  exposedPadWidth?: Quantity;
  exposedPadLength?: Quantity;
  pinOneConvention?: string;
  evidenceIds: Id[];
  conflicts: string[];
  state: "proven" | "candidate" | "conflicting" | "unknown";
}

export type CadBundleDisposition =
  | "primary_approved"
  | "alternate_approved"
  | "candidate_unverified"
  | "incompatible"
  | "deprecated"
  | "mechanical_only";

export interface CadBundleBinding {
  symbolVersionId: Id;
  footprintVersionId?: Id;
  modelVersionIds: Id[];
  mappingCertificateId?: Id;
  disposition: CadBundleDisposition;
}

export interface ReviewEvent {
  id: Id;
  at: IsoDate;
  actorId: Id;
  action: "submit" | "approve" | "reject" | "publish" | "deprecate" | "revoke" | "supersede";
  reason: string;
  fromState: RecordState;
  toState: RecordState;
}

export interface AtomicPartRevision {
  schemaVersion: 1;
  id: Id;
  logicalPartId: Id;
  revision: number;
  exactPartId?: Id;
  genericDeviceId?: Id;
  cadBundles: CadBundleBinding[];
  claimIds: Id[];
  guidanceIds: Id[];
  offerSnapshotIds: Id[];
  licenseIds: Id[];
  publicationState: RecordState;
  validatorVersion: string;
  policyVersion: string;
  semanticHash: Sha256;
  createdAt: IsoDate;
  createdBy: Id;
  reviewHistory: ReviewEvent[];
  supersedesRevisionId?: Id;
}

export type ApprovalProfile = "schematic_only" | "pcb_assignable" | "mechanically_complete" | "sourcing_current";

export interface ApprovalDecision {
  profile: ApprovalProfile;
  eligible: boolean;
  blockers: string[];
  warnings: string[];
  evaluatedAt: IsoDate;
  validatorVersion: string;
}

export type UnknownPolicy = "block" | "allow_with_warning";

export interface SelectionCriterion {
  property: string;
  operator: "eq" | "neq" | "gte" | "lte" | "range_contains" | "contains" | "fresh";
  value: Quantity | string | number | boolean;
  limit?: LimitSemantics;
}

export interface ComponentQuery {
  queryId: Id;
  category?: string;
  identity?: { manufacturerId?: Id; exactMpn?: string; genericDeviceId?: Id };
  requiredProfile: ApprovalProfile;
  hard: SelectionCriterion[];
  soft: Array<SelectionCriterion & { weight: number }>;
  unknownPolicy: UnknownPolicy;
  policyVersion: string;
  catalogSnapshotId: Id;
  limit: number;
}

export interface CriterionResult {
  criterion: SelectionCriterion;
  outcome: "pass" | "fail" | "unknown" | "conflict" | "stale";
  claimIds: Id[];
  explanation: string;
  score: number;
}

export interface ComponentSearchResult {
  revisionId: Id;
  qualified: boolean;
  hardResults: CriterionResult[];
  softResults: CriterionResult[];
  totalScore: number;
  conflicts: Id[];
  unknowns: string[];
  freshness: "fresh" | "stale" | "not_applicable" | "unknown";
}

export interface SelectionRecord {
  schemaVersion: 1;
  id: Id;
  projectId: Id;
  componentInstanceId: Id;
  atomicRevisionId: Id;
  symbolVersionId: Id;
  footprintVersionId?: Id;
  modelVersionIds: Id[];
  mappingCertificateId?: Id;
  query: ComponentQuery;
  consideredRevisionIds: Id[];
  chosenResult: ComponentSearchResult;
  rationale: string;
  actor: "user" | "agent_proposal_user_confirmed" | "migration";
  createdAt: IsoDate;
  catalogSnapshotId: Id;
  embeddedSnapshot: PortableAtomicSnapshot;
}

export type UpgradeImpact =
  | "metadata_only"
  | "supplier_only"
  | "symbol_pin_change"
  | "footprint_geometry_change"
  | "pin_mapping_change"
  | "rating_or_guidance_change"
  | "license_change"
  | "revoked_target";

export interface AtomicUpgradeDiff {
  fromRevisionId: Id;
  toRevisionId: Id;
  impacts: UpgradeImpact[];
  invalidates: Array<"electrical_parity" | "pin_pad_mapping" | "placement" | "routing" | "drc" | "readiness" | "manufacturing_release">;
  safeForAutomaticMetadataRefresh: boolean;
  blockers: string[];
}

export interface ProjectComponentPin {
  selectionRecordId: Id;
  atomicRevisionId: Id;
  symbolVersionId: Id;
  footprintVersionId?: Id;
  modelVersionIds: Id[];
  mappingCertificateId?: Id;
  embeddedSnapshot: PortableAtomicSnapshot;
}

/** Sufficient immutable static data to inspect/export a pinned part offline. */
export interface PortableAtomicSnapshot {
  schemaVersion: 1;
  atomicRevision: AtomicPartRevision;
  manufacturer?: Manufacturer;
  family?: ManufacturerFamily;
  exactPart?: ExactManufacturerPart;
  genericDevice?: GenericDevice;
  symbol: SymbolAssetVersion;
  footprint?: FootprintAssetVersion;
  models: ModelAssetVersion[];
  mapping?: MappingCertificate;
  claims: EngineeringClaim[];
  guidance: ApplicationGuidance[];
  licenses: LicenseRecord[];
  evidence: EvidenceRef[];
  sourceRecords: SourceRecord[];
  sources: SourceIdentity[];
  supplierParts: SupplierPart[];
  offerSnapshots: SupplierOfferSnapshot[];
  assetBlobs: RawContentObject[];
  capturedAt: IsoDate;
}

export interface AuditEvent {
  id: Id;
  at: IsoDate;
  actorId: Id;
  action: string;
  objectType: string;
  objectId: Id;
  detail: Record<string, unknown>;
}
