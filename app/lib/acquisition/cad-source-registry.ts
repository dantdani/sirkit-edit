/**
 * [PR-M, 2026-10-18] Section M2 (runbook M.3, design m2-acquisition-design.md M2.2): the reviewed, versioned registry of CAD
 * SOURCES - the places Sirkit may obtain symbol, footprint and datasheet BYTES from. It is deliberately SEPARATE from the
 * distributor registry (`source-registry.ts`), whose one authority class is `sourcing_observation` and which can never prove a
 * symbol, footprint or pin mapping (that invariant is unchanged).
 *
 * One record per source: its class per asset kind, exact hosts and GET path templates (never an arbitrary URL, K.8.7), auth BY
 * NAME, per asset kind the accepted media types and a byte ceiling, the deadline, redirects refused (0), the retry policy (the real
 * `Retry-After`, a long wait checkpointed by the durable task, K.3.4), the quota and breaker, the licence record and its retention
 * class, the agent disclosure (OD-M2-14), the pinned refs, the official pages read with the date, the status and the owner
 * decision.
 *
 *  - `kicad-bundled` (enabled): the official KiCad libraries at the reviewed pinned commits (`KICAD_LIBRARY_PINS`), read from the
 *    operator's local checkout under `data/` - ZERO network. Symbols and footprints only (the checkout has no datasheets, no 3D).
 *  - `kicad-gitlab` (BLOCKED): the same libraries from gitlab.com's repository-files API at a pinned `ref`. Its adapter exists
 *    (`cad-adapters/gitlab.ts`) but admission ALWAYS refuses it until the owner decides OD-M2-3 (GitLab terms), OD-M2-5 (refs),
 *    OD-M2-12 (parsing isolation) and OD-M2-13 (a qualification run). It is never called.
 *  - `fixture-kicad` (fixture): a fixture host serving REAL committed KiCad files and an ORIGINAL fixture pin table, admitted only
 *    when the caller says the fixture runtime (or a test registry) is in force; production refuses it.
 *
 * Browser-safe: no environment read at module load, no server import. Bump `CAD_SOURCE_REGISTRY_VERSION` on any change; the
 * rendered artifact (artifacts/product-reliability-simple-ui/component-resolution/cad-source-registry.csv) is gated byte for byte.
 */
import type { LicenseRecord, SourceClass } from "../atomic/types";

export const CAD_SOURCE_REGISTRY_VERSION = "1.0.0";
/** The artifact the registry renders to, gated byte for byte (m2-2-cad-source-registry.test.ts). */
export const CAD_SOURCE_REGISTRY_ARTIFACT = "artifacts/product-reliability-simple-ui/component-resolution/cad-source-registry.csv";
/** The operator may switch a CAD source OFF (never on) by id, comma-separated - the SAME operator switch the distributor sources read
 *  (app/lib/acquisition/source-registry.ts `OPERATOR_DISABLE_ENV`, declared in the deployment inventory): one list of acquisition source
 *  ids, whose CAD ids (`kicad-bundled`, `kicad-gitlab`, `fixture-kicad`) never collide with a distributor's. The literal is repeated, not
 *  imported, so the CAD path's import closure never reaches the distributor registry. */
export const CAD_SOURCE_OPERATOR_DISABLE_ENV = "SIRKIT_ACQUISITION_DISABLED_SOURCES";

export const CAD_SOURCE_IDS = Object.freeze(["kicad-bundled", "kicad-gitlab", "fixture-kicad"] as const);
export type CadSourceId = (typeof CAD_SOURCE_IDS)[number];
export const CAD_ASSET_KINDS = Object.freeze(["symbol", "footprint", "datasheet", "model"] as const);
export type CadAssetKind = (typeof CAD_ASSET_KINDS)[number];
export type CadSourceStatus = "enabled" | "blocked" | "fixture";
export type CadTransport = "local-pinned-checkout" | "https";
/** Only `indefinite` content is storable in M2 (durable workflow history is append-only and cannot honour a deletion, OD-M2-7). */
export type CadRetentionClass = "indefinite" | "bounded" | "none";
export type CadAgentDisclosure = "permitted" | "prohibited" | "unknown";

/** 1 MiB per KiCad text file; 256 KiB for a datasheet TEXT; PDF, archives and 3D are refused in M2. */
export const CAD_TEXT_MAX_BYTES = 1024 * 1024;
export const CAD_DATASHEET_TEXT_MAX_BYTES = 256 * 1024;

export interface CadAssetPolicy {
  kind: CadAssetKind;
  accepted: boolean;
  /** what the asset's facts are classed as (a fixture document is never a manufacturer datasheet) */
  sourceClass: SourceClass | null;
  mediaTypes: readonly string[];
  maxBytes: number;
  /** why an asset kind is not accepted (empty when accepted) */
  refusal: string;
}

export interface CadOperation {
  kind: CadAssetKind;
  method: "GET";
  /** a path (and fixed query) template on one of the row's exact hosts; `{name}` placeholders only, each a validated segment */
  pathTemplate: string;
}

export interface CadSourceEntry {
  id: CadSourceId;
  displayName: string;
  status: CadSourceStatus;
  /** why a source is blocked or a fixture (empty for an enabled one) */
  reason: string;
  ownerDecision: string | null;
  transport: CadTransport;
  /** exact hostnames, no wildcard; empty for a local checkout */
  hosts: readonly string[];
  operations: readonly CadOperation[];
  /** local read templates (relative to the server's working directory) for the pinned checkout */
  localTemplates: readonly CadOperation[];
  auth: { method: "none"; secretEnv: readonly string[]; note: string };
  assets: readonly CadAssetPolicy[];
  resilience: {
    deadlineMs: number;
    maxRedirects: 0;
    /** automatic in-call retries: none; a 429 or an open breaker becomes a scheduled wait on the durable task */
    automaticRetries: 0;
    honoursRetryAfter: boolean;
    /** a wait longer than this is checkpointed (the task's next slice is scheduled at the retry time) */
    maxInlineWaitMs: 0;
    breaker: { consecutiveFailuresToOpen: number; openMs: number };
  };
  quota: { requestsPerMinute: number; basis: "self-imposed" | "local" | "fixture"; note: string };
  /** commits a source may be read at (pinned, reviewed) */
  refs: { symbols: string; footprints: string; note: string };
  license: {
    record: LicenseRecord;
    attribution: string;
    attributionLink: string | null;
    retention: CadRetentionClass;
    agentDisclosure: CadAgentDisclosure;
    terms: readonly string[];
  };
  provider: { organization: string; documentation: readonly string[]; documentationCheckedOn: string; notes: readonly string[] };
}

/**
 * The KiCad library licence record, field for field the authoring module's `KICAD_LIBRARY_LICENSE` (m2-2 asserts the equality), so a
 * publication of acquired KiCad assets writes the SAME `atomic_licenses` row as a bundled one (OD-M2-4: the id does not change). The
 * attribution and the licence link travel with every served asset in the registry row and the handoff package.
 */
export const CAD_KICAD_LIBRARY_LICENSE: LicenseRecord = Object.freeze({
  id: "license_kicad_cc_by_sa_4",
  spdxId: "CC-BY-SA-4.0",
  name: "KiCad official libraries (CC-BY-SA 4.0 with KiCad Libraries Exception)",
  rawRedistribution: "redistributable",
  derivedRedistribution: "redistributable",
  exportDisposition: "redistributable",
});
export const KICAD_LIBRARY_ATTRIBUTION = "KiCad Libraries Team, official KiCad symbol and footprint libraries (CC-BY-SA 4.0 with the KiCad libraries exception)";

/** The fixture pin tables' own licence: original text written for Sirkit's tests, MIT. Never a manufacturer document. */
export const FIXTURE_PIN_TABLE_LICENSE: LicenseRecord = Object.freeze({
  id: "license_sirkit_fixture_pin_table_mit",
  spdxId: "MIT",
  name: "Sirkit fixture pin tables (original test text, MIT; NOT manufacturer datasheets)",
  rawRedistribution: "redistributable",
  derivedRedistribution: "redistributable",
  exportDisposition: "redistributable",
});

const SYMBOL_MEDIA = Object.freeze(["application/x-kicad-symbol", "text/plain"]);
const FOOTPRINT_MEDIA = Object.freeze(["application/x-kicad-footprint", "text/plain"]);

const KICAD_PINNED_SYMBOLS = "90c39c3880f0062a56b5944d428edc846968d72b";
const KICAD_PINNED_FOOTPRINTS = "645402ed82e16096cf827fea7114fdbef4c46948";

const kicadAssets = (datasheet: CadAssetPolicy): readonly CadAssetPolicy[] => Object.freeze([
  { kind: "symbol", accepted: true, sourceClass: "official_kicad_library", mediaTypes: SYMBOL_MEDIA, maxBytes: CAD_TEXT_MAX_BYTES, refusal: "" },
  { kind: "footprint", accepted: true, sourceClass: "official_kicad_library", mediaTypes: FOOTPRINT_MEDIA, maxBytes: CAD_TEXT_MAX_BYTES, refusal: "" },
  datasheet,
  { kind: "model", accepted: false, sourceClass: null, mediaTypes: [], maxBytes: 0, refusal: "3D models are out of M2 (K.6): kicad-packages3D is not pinned or checked out, and binary assets need the deletable blob store of OD-M2-7" },
]);

const KICAD_DOCS = Object.freeze([
  "https://www.kicad.org/libraries/license/",
  "https://gitlab.com/kicad/libraries/kicad-symbols",
  "https://gitlab.com/kicad/libraries/kicad-footprints",
]);

const ENTRIES: readonly CadSourceEntry[] = Object.freeze([
  {
    id: "kicad-bundled",
    displayName: "KiCad official libraries (bundled pinned checkout)",
    status: "enabled",
    reason: "",
    ownerDecision: null,
    transport: "local-pinned-checkout",
    hosts: [],
    operations: [],
    localTemplates: [
      { kind: "symbol", method: "GET", pathTemplate: "data/kicad-symbols/{library}.kicad_symdir/{name}.kicad_sym" },
      { kind: "footprint", method: "GET", pathTemplate: "data/kicad-footprints/{library}.pretty/{name}.kicad_mod" },
    ],
    auth: { method: "none", secretEnv: [], note: "a local read of the operator's pinned checkout; no credential" },
    assets: kicadAssets({ kind: "datasheet", accepted: false, sourceClass: null, mediaTypes: [], maxBytes: 0, refusal: "the pinned KiCad checkout carries no datasheets; a datasheet needs its own reviewed source row (OD-M2-9)" }),
    resilience: { deadlineMs: 5_000, maxRedirects: 0, automaticRetries: 0, honoursRetryAfter: false, maxInlineWaitMs: 0, breaker: { consecutiveFailuresToOpen: 3, openMs: 60_000 } },
    quota: { requestsPerMinute: 600, basis: "local", note: "a local file read; the bound only keeps one task from monopolising the server" },
    refs: { symbols: KICAD_PINNED_SYMBOLS, footprints: KICAD_PINNED_FOOTPRINTS, note: "KICAD_LIBRARY_PINS (app/lib/kicad/pinned-checkout.ts); bytes are the checkout's working-tree bytes (their line endings follow the operator's git configuration and are recorded per object)" },
    license: {
      record: CAD_KICAD_LIBRARY_LICENSE,
      attribution: KICAD_LIBRARY_ATTRIBUTION,
      attributionLink: "https://www.kicad.org/libraries/license/",
      retention: "indefinite",
      agentDisclosure: "unknown",
      terms: ["https://www.kicad.org/libraries/license/"],
    },
    provider: { organization: "KiCad Libraries Team", documentation: KICAD_DOCS, documentationCheckedOn: "2026-10-18", notes: ["CC-BY-SA 4.0 with the design exception: designs using the libraries need not adopt the licence; redistribution of the libraries keeps the licence and attribution (OD-M2-4)."] },
  },
  {
    id: "kicad-gitlab",
    displayName: "KiCad official libraries (gitlab.com repository files API)",
    status: "blocked",
    reason: "the GitLab.com Subscription Agreement, Acceptable Use Policy and API Terms of Use for automated raw-file reads were not readable (UNKNOWN) - the owner must accept them first (OD-M2-3); refs (OD-M2-5), parsing isolation in a closed engine (OD-M2-12) and one qualification run (OD-M2-13) also precede enabling it",
    ownerDecision: "OD-M2-3; OD-M2-5; OD-M2-6; OD-M2-12; OD-M2-13",
    transport: "https",
    hosts: ["gitlab.com"],
    operations: [
      { kind: "symbol", method: "GET", pathTemplate: "/api/v4/projects/kicad%2Flibraries%2Fkicad-symbols/repository/files/{library}.kicad_symdir%2F{name}.kicad_sym/raw?ref={ref}" },
      { kind: "footprint", method: "GET", pathTemplate: "/api/v4/projects/kicad%2Flibraries%2Fkicad-footprints/repository/files/{library}.pretty%2F{name}.kicad_mod/raw?ref={ref}" },
    ],
    localTemplates: [],
    auth: { method: "none", secretEnv: [], note: "public projects; an optional token by env NAME is OD-M2-6 (none is read)" },
    assets: kicadAssets({ kind: "datasheet", accepted: false, sourceClass: null, mediaTypes: [], maxBytes: 0, refusal: "the KiCad repositories carry no datasheets" }),
    resilience: { deadlineMs: 15_000, maxRedirects: 0, automaticRetries: 0, honoursRetryAfter: true, maxInlineWaitMs: 0, breaker: { consecutiveFailuresToOpen: 3, openMs: 60_000 } },
    quota: { requestsPerMinute: 60, basis: "self-imposed", note: "well under GitLab.com's documented 300/min per project raw and 800/min unauthenticated raw limits; a 429 carries Retry-After and RateLimit-*" },
    refs: { symbols: KICAD_PINNED_SYMBOLS, footprints: KICAD_PINNED_FOOTPRINTS, note: "only the reviewed KICAD_LIBRARY_PINS commits (OD-M2-5); the raw content type and whether raw answers redirect are UNKNOWN until a qualification run (a redirect is refused)" },
    license: {
      record: CAD_KICAD_LIBRARY_LICENSE,
      attribution: KICAD_LIBRARY_ATTRIBUTION,
      attributionLink: "https://www.kicad.org/libraries/license/",
      retention: "indefinite",
      agentDisclosure: "unknown",
      terms: ["https://www.kicad.org/libraries/license/", "https://about.gitlab.com/terms/"],
    },
    provider: {
      organization: "KiCad Libraries Team (content); GitLab Inc. (transport)",
      documentation: [...KICAD_DOCS, "https://docs.gitlab.com/api/repository_files/", "https://docs.gitlab.com/user/gitlab_com/", "https://about.gitlab.com/terms/"],
      documentationCheckedOn: "2026-10-18",
      notes: ["GET /projects/:id/repository/files/:file_path/raw with ref (a branch, tag or commit); the JSON variant carries blob_id, content_sha256 and last_commit_id.", "The API Terms of Use and Acceptable Use Policy pages rendered only navigation on 2026-10-18: their text is UNKNOWN."],
    },
  },
  {
    id: "fixture-kicad",
    displayName: "Fixture CAD source (committed KiCad files and fixture pin tables)",
    status: "fixture",
    reason: "a deterministic test source: admitted only under the fixture runtime or an injected test registry, never in production",
    ownerDecision: null,
    transport: "https",
    hosts: ["cad-fixture.sirkit.test"],
    operations: [
      { kind: "symbol", method: "GET", pathTemplate: "/kicad-symbols/{library}.kicad_symdir/{name}.kicad_sym" },
      { kind: "footprint", method: "GET", pathTemplate: "/kicad-footprints/{library}.pretty/{name}.kicad_mod" },
      { kind: "datasheet", method: "GET", pathTemplate: "/datasheets/{name}.pin-table.txt" },
    ],
    localTemplates: [],
    auth: { method: "none", secretEnv: [], note: "a fixture transport; no credential" },
    assets: kicadAssets({ kind: "datasheet", accepted: true, sourceClass: "organization_authored", mediaTypes: ["text/plain"], maxBytes: CAD_DATASHEET_TEXT_MAX_BYTES, refusal: "" }),
    resilience: { deadlineMs: 5_000, maxRedirects: 0, automaticRetries: 0, honoursRetryAfter: true, maxInlineWaitMs: 0, breaker: { consecutiveFailuresToOpen: 3, openMs: 60_000 } },
    quota: { requestsPerMinute: 120, basis: "fixture", note: "a fixture bound" },
    refs: { symbols: KICAD_PINNED_SYMBOLS, footprints: KICAD_PINNED_FOOTPRINTS, note: "the KiCad files are verbatim copies of the pinned commits' blobs (LF line endings); the pin tables are original fixture text" },
    license: {
      record: CAD_KICAD_LIBRARY_LICENSE,
      attribution: `${KICAD_LIBRARY_ATTRIBUTION}; fixture pin tables: Sirkit tests (MIT)`,
      attributionLink: "https://www.kicad.org/libraries/license/",
      retention: "indefinite",
      agentDisclosure: "unknown",
      terms: ["https://www.kicad.org/libraries/license/"],
    },
    provider: { organization: "Sirkit tests", documentation: KICAD_DOCS, documentationCheckedOn: "2026-10-18", notes: ["Fixture evidence: labelled fixture-source wherever it appears; never presented as a live source or a manufacturer document."] },
  },
] satisfies readonly CadSourceEntry[]);

export const CAD_SOURCE_REGISTRY: Readonly<Record<CadSourceId, CadSourceEntry>> = Object.freeze(Object.fromEntries(ENTRIES.map((entry) => [entry.id, entry])) as Record<CadSourceId, CadSourceEntry>);
export const CAD_SOURCE_ENTRIES: readonly CadSourceEntry[] = ENTRIES;

export function isCadSourceId(value: unknown): value is CadSourceId {
  return typeof value === "string" && (CAD_SOURCE_IDS as readonly string[]).includes(value);
}

/** The asset policy of a source for one kind. */
export function cadAssetPolicy(entry: CadSourceEntry, kind: CadAssetKind): CadAssetPolicy {
  return entry.assets.find((asset) => asset.kind === kind) ?? { kind, accepted: false, sourceClass: null, mediaTypes: [], maxBytes: 0, refusal: "not declared" };
}

// ── Admission ────────────────────────────────────────────────────────────────

export type CadSourceRefusal = "blocked" | "fixture_only" | "operator_disabled" | "unknown_source";
export type CadSourceAdmission =
  | { admitted: true; id: CadSourceId; entry: CadSourceEntry }
  | { admitted: false; id: string; refusal: CadSourceRefusal; message: string };

/**
 * Whether a CAD source may be used now. A BLOCKED source never (whatever the environment); a FIXTURE source only when the caller
 * states the fixture runtime (or an injected test registry) is in force - the composition root passes `fixtureRuntimeEnabled()`,
 * never a request field; the operator can switch any source OFF, never on.
 */
export function admitCadSource(id: unknown, input: { env: Readonly<Record<string, string | undefined>>; fixtureAllowed: boolean; entries?: readonly CadSourceEntry[] }): CadSourceAdmission {
  const entries = input.entries ?? ENTRIES;
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) return { admitted: false, id: typeof id === "string" ? id.slice(0, 40) : "?", refusal: "unknown_source", message: "No reviewed CAD source has that id." };
  if (entry.status === "blocked") return { admitted: false, id: entry.id, refusal: "blocked", message: `${entry.displayName} is blocked: ${entry.reason}${entry.ownerDecision ? ` (${entry.ownerDecision})` : ""}` };
  if (entry.status === "fixture" && input.fixtureAllowed !== true) return { admitted: false, id: entry.id, refusal: "fixture_only", message: `${entry.displayName} is a fixture source: it is refused outside the fixture runtime.` };
  const off = (input.env[CAD_SOURCE_OPERATOR_DISABLE_ENV] ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (off.includes(entry.id)) return { admitted: false, id: entry.id, refusal: "operator_disabled", message: `${entry.displayName} is switched off by the operator (${CAD_SOURCE_OPERATOR_DISABLE_ENV}).` };
  return { admitted: true, id: entry.id, entry };
}

// ── Validation ───────────────────────────────────────────────────────────────

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const SECRET_SHAPES = /sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|ghp_[A-Za-z0-9]{36}|glpat-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|hf_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const PLACEHOLDER = /\{([a-z]+)\}/g;
const ALLOWED_PLACEHOLDERS = new Set(["library", "name", "ref"]);
const STORABLE_DISPOSITIONS = new Set(["redistributable"]);

/** Every structural rule a registry revision must satisfy; empty means valid. */
export function validateCadSourceRegistry(entries: readonly CadSourceEntry[] = ENTRIES): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    const at = (message: string): void => { errors.push(`${entry.id}: ${message}`); };
    if (ids.has(entry.id)) at("duplicate id");
    ids.add(entry.id);
    if (!isCadSourceId(entry.id)) at("id is not a reviewed CAD source id");
    if (!entry.displayName.trim()) at("displayName is empty");
    if (entry.status !== "enabled" && !entry.reason.trim()) at("a blocked or fixture source needs a reason");
    if (entry.status === "enabled" && entry.reason.trim()) at("an enabled source carries no refusal reason");
    if (!DATE.test(entry.provider.documentationCheckedOn)) at("documentationCheckedOn is not a date");
    if (entry.provider.documentation.length === 0) at("no official documentation recorded");
    for (const url of [...entry.provider.documentation, ...entry.license.terms]) if (!url.startsWith("https://")) at(`documentation is not HTTPS: ${url}`);
    if (entry.license.terms.length === 0) at("no terms recorded");
    for (const host of entry.hosts) if (!HOST.test(host)) at(`host is not an exact lowercase hostname: ${host}`);
    if (entry.transport === "local-pinned-checkout" && (entry.hosts.length > 0 || entry.operations.length > 0)) at("a local checkout declares no hosts or network operations");
    if (entry.transport === "https" && (entry.hosts.length === 0 || entry.operations.length === 0)) at("a network source declares its exact hosts and GET templates");
    if (entry.transport === "local-pinned-checkout" && entry.localTemplates.length === 0) at("a local checkout declares its read templates");
    for (const operation of [...entry.operations, ...entry.localTemplates]) {
      if (operation.method !== "GET") at(`operation for ${operation.kind} is not a GET`);
      if (!cadAssetPolicy(entry, operation.kind).accepted) at(`operation for ${operation.kind}, which the source does not accept`);
      for (const match of operation.pathTemplate.matchAll(PLACEHOLDER)) if (!ALLOWED_PLACEHOLDERS.has(match[1]!)) at(`template placeholder {${match[1]}} is not one of library|name|ref`);
      if (/\.\.|\/\/|^[a-z]+:/i.test(operation.pathTemplate)) at(`template ${operation.pathTemplate} is not a plain path`);
      if (entry.transport === "https" && !operation.pathTemplate.startsWith("/")) at(`network template ${operation.pathTemplate} is not absolute on its host`);
    }
    if (entry.resilience.maxRedirects !== 0) at("redirects must be refused");
    if (entry.resilience.automaticRetries !== 0) at("automatic in-call retries are refused (a wait is a scheduled slice)");
    if (entry.resilience.deadlineMs <= 0 || entry.resilience.deadlineMs > 30_000) at("deadline must be in (0, 30 s]");
    if (!Number.isInteger(entry.quota.requestsPerMinute) || entry.quota.requestsPerMinute <= 0) at("quota is not a positive integer");
    if (!COMMIT.test(entry.refs.symbols) || !COMMIT.test(entry.refs.footprints)) at("refs must be full pinned commit ids");
    for (const asset of entry.assets) {
      if (asset.accepted) {
        if (asset.mediaTypes.length === 0) at(`${asset.kind}: an accepted kind names its media types`);
        if (asset.maxBytes <= 0 || asset.maxBytes > CAD_TEXT_MAX_BYTES) at(`${asset.kind}: the byte ceiling is in (0, 1 MiB]`);
        if (asset.kind === "datasheet" && asset.maxBytes > CAD_DATASHEET_TEXT_MAX_BYTES) at("datasheet: the text ceiling is 256 KiB");
        if (asset.kind === "model") at("model: 3D assets are refused in M2 (OD-M2-7)");
        if (asset.mediaTypes.some((type) => /pdf|zip|octet-stream|html|svg|step|vrml/i.test(type))) at(`${asset.kind}: PDF, archives, HTML, SVG and 3D are refused in M2`);
        if (asset.sourceClass === null) at(`${asset.kind}: an accepted kind names its source class`);
        if (asset.refusal) at(`${asset.kind}: an accepted kind carries no refusal`);
      } else if (!asset.refusal.trim()) at(`${asset.kind}: a refused kind says why`);
    }
    for (const kind of CAD_ASSET_KINDS) if (!entry.assets.some((asset) => asset.kind === kind)) at(`asset kind ${kind} is not declared`);
    for (const name of entry.auth.secretEnv) if (!ENV_NAME.test(name)) at(`secret reference is not an environment variable name: ${name}`);
    if (entry.license.retention !== "indefinite" && entry.assets.some((asset) => asset.accepted)) at("only indefinite retention is storable in M2 (OD-M2-7)");
    for (const disposition of [entry.license.record.rawRedistribution, entry.license.record.derivedRedistribution, entry.license.record.exportDisposition]) if (!STORABLE_DISPOSITIONS.has(disposition)) at(`licence disposition ${disposition} is not storable in a shared library (OD-M2-11)`);
    if (!["permitted", "prohibited", "unknown"].includes(entry.license.agentDisclosure)) at("agentDisclosure is not permitted|prohibited|unknown");
    if (entry.status !== "enabled" && entry.license.agentDisclosure === "permitted") at(`agentDisclosure may not be "permitted" for a ${entry.status} source`);
    if (entry.license.attributionLink !== null && !/^https:\/\/[a-z0-9.-]+\/[A-Za-z0-9._~/-]*$/.test(entry.license.attributionLink)) at("attributionLink is a plain https link");
    if (SECRET_SHAPES.test(JSON.stringify(entry))) at("the entry contains something shaped like a secret value");
  }
  for (const id of CAD_SOURCE_IDS) if (!ids.has(id)) errors.push(`${id}: missing from the registry`);
  return errors;
}

// ── Rendering (the committed artifact) ───────────────────────────────────────

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll("\"", "\"\"")}"` : value;
}

export const CAD_SOURCE_REGISTRY_CSV_COLUMNS = [
  "registry_version", "id", "status", "owner_decision", "transport", "hosts", "operations", "local_templates", "auth", "assets", "deadline_ms", "redirects",
  "automatic_retries", "retry_after", "breaker", "quota_per_minute", "quota_basis", "refs_symbols", "refs_footprints", "licence_id", "licence_spdx",
  "licence_dispositions", "retention", "agent_disclosure", "attribution", "attribution_link", "docs_checked_on", "documentation", "reason",
] as const;

export function renderCadSourceRegistryCsv(entries: readonly CadSourceEntry[] = ENTRIES): string {
  const lines: string[] = [CAD_SOURCE_REGISTRY_CSV_COLUMNS.join(",")];
  for (const entry of entries) {
    const row = [
      CAD_SOURCE_REGISTRY_VERSION, entry.id, entry.status, entry.ownerDecision ?? "", entry.transport, entry.hosts.join(";"),
      entry.operations.map((operation) => `${operation.kind} GET ${operation.pathTemplate}`).join(";"),
      entry.localTemplates.map((operation) => `${operation.kind} ${operation.pathTemplate}`).join(";"),
      `${entry.auth.method}${entry.auth.secretEnv.length ? ` (${entry.auth.secretEnv.join("|")})` : ""}`,
      entry.assets.map((asset) => asset.accepted ? `${asset.kind}: ${asset.sourceClass}; ${asset.mediaTypes.join("|")}; max ${asset.maxBytes}` : `${asset.kind}: refused`).join(";"),
      String(entry.resilience.deadlineMs), String(entry.resilience.maxRedirects), String(entry.resilience.automaticRetries), entry.resilience.honoursRetryAfter ? "honoured (scheduled wait)" : "n/a",
      `${entry.resilience.breaker.consecutiveFailuresToOpen} failures -> open ${entry.resilience.breaker.openMs} ms`,
      String(entry.quota.requestsPerMinute), entry.quota.basis, entry.refs.symbols, entry.refs.footprints,
      entry.license.record.id, entry.license.record.spdxId ?? "", `${entry.license.record.rawRedistribution}/${entry.license.record.derivedRedistribution}/${entry.license.record.exportDisposition}`,
      entry.license.retention, entry.license.agentDisclosure, entry.license.attribution, entry.license.attributionLink ?? "", entry.provider.documentationCheckedOn,
      entry.provider.documentation.join(";"), entry.reason,
    ];
    lines.push(row.map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}
