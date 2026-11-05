/**
 * [B19-E E4] Draft authoring: the exact atomic revision a reviewed publication request would publish, assembled on the server.
 *
 * Taken from the operator seed's assembly (scripts/seed-atomic-demo-parts.ts; the seed itself is not moved onto this module,
 * its ids would change). What a request may name, and what the server does with it:
 *  - a symbol and footprint BY REFERENCE into the bundled official KiCad library (`data/kicad-symbols`, `data/kicad-footprints`):
 *    the bytes are read here, on the server, and parsed by `kicad-assets.ts`; a request never carries asset bytes;
 *  - a terminal table, package and datasheet citation the person entered: recorded as `organization_authored` evidence under
 *    that person's principal — never `manufacturer_datasheet`, whatever the request says (source classes are set by rule);
 *  - the manufacturer the reviewer resolved (OD-34: the evidence identity is the MPN only).
 * The in-memory catalog starts at the logical part's latest revision number, and reuses the manufacturer, exact part and
 * logical part the database already holds, so the publication's unique indexes and foreign keys hold.
 *
 * Nothing here approves or publishes: the review replays the catalog transitions, and `publishPortableAtomicSnapshot` decides.
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { AtomicCatalog, catalogActorKey, createAtomicRevision } from "./catalog";
import { exactManufacturerPartId, canonicalExactMpn, normalizeMpnSearchKey } from "./identity";
import { makeEvidence, makeSourceRecord } from "./ingestion";
import { KICAD_ASSET_PARSER_VERSION, parseFootprintAsset, parseSymbolAssets, rawContentObject } from "./kicad-assets";
import { buildMappingCertificate, provePackage } from "./mapping";
import { INGEST_LIMITS } from "./security";
import { canonicalJson, semanticHash, sha256 } from "./stable";
import { normalizeValueKey } from "./value-key";
import type { AtomicPartRevision, ExactManufacturerPart, FootprintAssetVersion, LicenseRecord, Manufacturer, ManufacturerTerminal, MappingCertificate, SourceIdentity, SymbolAssetVersion } from "./types";
import { IMPORT_REVIEW_PROFILES, type AtomicPublicationLink, type AtomicPublicationSpec, type ImportReviewProfile } from "./publication-review-contract";
import { inertExternalText, safeExternalHref } from "../net/external-href";
import { candidateFromExtraction, EXTRACTION_PIN_MAP_MAX_LENGTH, type NormalizedCandidate } from "../acquisition/quarantine";

export const ATOMIC_AUTHORING_VERSION = "sirkit.atomic-authoring/1";
export const ATOMIC_PUBLICATION_POLICY_VERSION = "sirkit.atomic-publication-review/1";

/** The seed's KiCad library license and source records, byte for byte, so the rows a publication writes deduplicate. */
export const KICAD_LIBRARY_LICENSE: LicenseRecord = Object.freeze({
  id: "license_kicad_cc_by_sa_4",
  spdxId: "CC-BY-SA-4.0",
  name: "KiCad official libraries (CC-BY-SA 4.0 with KiCad Libraries Exception)",
  rawRedistribution: "redistributable",
  derivedRedistribution: "redistributable",
  exportDisposition: "redistributable",
});
export const ORGANIZATION_AUTHORED_LICENSE: LicenseRecord = Object.freeze({
  id: "license_sirkit_organization_authored",
  spdxId: null,
  name: "Sirkit organization-authored terminal tables, package facts and datasheet citations",
  rawRedistribution: "redistributable",
  derivedRedistribution: "redistributable",
  exportDisposition: "redistributable",
});
const KICAD_SOURCE: SourceIdentity = Object.freeze({ id: "source_kicad_official_libraries", sourceClass: "official_kicad_library", name: "KiCad official symbol and footprint libraries", officialDomains: ["kicad.org", "gitlab.com"], licenseId: KICAD_LIBRARY_LICENSE.id }) as SourceIdentity;
/** [PR-M, 2026-10-18] M2.4: the official KiCad source identity, exported unchanged so an acquired KiCad asset names the SAME source row. */
export const KICAD_OFFICIAL_SOURCE: SourceIdentity = KICAD_SOURCE;
const MEDIA_SYMBOL = "application/x-kicad-symbol";
const MEDIA_FOOTPRINT = "application/x-kicad-footprint";

// ── the bundled library ──────────────────────────────────────────────────────

export interface BundledKicadLibrary {
  readonly symbolsRevision: string;
  readonly footprintsRevision: string;
  /** The library file's text, or null when the reference names nothing in the bundled library. */
  symbol(library: string, name: string): string | null;
  footprint(library: string, name: string): string | null;
}

// ── [PR-M, 2026-10-18] M2.4: the KiCad asset source port ────────────────────
/**
 * What a symbol or footprint reference resolves to: its text and its provenance. The bundled library is one implementation
 * (`bundledAssetText` below: the SAME source identity, licence, revision and locator the reads always had, so every id it yields is
 * byte-identical); the acquired one reads a handoff's STORED objects through a store port that imports no egress
 * (app/lib/component-resolution/acquisition/handoff.ts) - a request still never carries bytes.
 */
export interface KicadAssetText {
  text: string;
  source: SourceIdentity;
  license: LicenseRecord;
  revision: string;
  /** the source record's locator (a library path or an origin + path; never a query string) */
  locator: string;
  /** when the bytes were retrieved (null: the request's authoring time, the bundled library's rule) */
  retrievedAt: string | null;
}
/** M2.4: an acquired asset pointer inside a reference: the governance-scope handoff and the stored object's SHA-256. */
export interface AcquiredAssetPointer { handoffId: string; objectHash: string }
/** M2.4: an acquired pin table (a permitted source's datasheet text, parsed deterministically) the handoff carries. */
export interface AcquiredPinTable extends KicadAssetText {
  /** the table in `terminalTableText` form */
  terminals: string;
  parserVersion: string;
}
/** The acquired assets a request names, preloaded by the caller (the reads are durable and async; authoring is synchronous). */
export interface AcquiredKicadAssets {
  read(kind: "symbol" | "footprint", reference: { library: string; name: string; acquired: AcquiredAssetPointer }): KicadAssetText | null;
  pinTable: AcquiredPinTable | null;
}

const LIBRARY_NAME = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,127}$/;
const ENTRY_NAME = /^[A-Za-z0-9][A-Za-z0-9_.,+()=-]{0,191}$/;

function validReference(library: string, name: string): boolean {
  return typeof library === "string" && typeof name === "string" && LIBRARY_NAME.test(library) && ENTRY_NAME.test(name) && !/\.kicad_|\.\./.test(`${library}/${name}`);
}

/** The server's reader over the bundled official KiCad library: one file per reference, never outside its directory. */
export function bundledKicadLibrary(root: string = process.cwd()): BundledKicadLibrary {
  const read = (base: string, directory: string, file: string): string | null => {
    try {
      const realBase = realpathSync(path.resolve(root, base));
      const target = realpathSync(path.resolve(realBase, directory, file));
      if (!target.startsWith(realBase + path.sep)) return null;
      const stat = statSync(target);
      if (!stat.isFile() || stat.size > INGEST_LIMITS.maxTextBytes) return null;
      return readFileSync(target, "utf8");
    } catch {
      return null;
    }
  };
  return {
    symbolsRevision: "kicad-symbols@bundled",
    footprintsRevision: "kicad-footprints@bundled",
    symbol: (library, name) => (validReference(library, name) ? read(path.join("data", "kicad-symbols"), `${library}.kicad_symdir`, `${name}.kicad_sym`) : null),
    footprint: (library, name) => (validReference(library, name) ? read(path.join("data", "kicad-footprints"), `${library}.pretty`, `${name}.kicad_mod`) : null),
  };
}

// ── the request's spec: closed, bounded, inert ───────────────────────────────

const MAX_TERMINALS = 512;
const MAX_PADS_PER_TERMINAL = 16;
const MAX_LINKS = 64;
const TERMINAL_NUMBER = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,15}$/;
const DOMAIN = /^[a-z0-9]([a-z0-9-]{0,62}\.)+[a-z]{2,63}$/;
const PART_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Normalized<T> = { ok: true; value: T } | { ok: false; field: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function closedRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
}
function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max * 4 ? inertExternalText(value, max) : null;
}

const HANDOFF_ID = /^acquisition-handoff:[0-9a-f]{32}$/;
const OBJECT_HASH = /^[0-9a-f]{64}$/;

function reference(value: unknown, field: string): Normalized<{ library: string; name: string; acquired?: AcquiredAssetPointer } | null> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (!closedRecord(value, ["library", "name", "acquired"]) || typeof value.library !== "string" || typeof value.name !== "string" || !validReference(value.library, value.name)) return { ok: false, field };
  // [PR-M, 2026-10-18] M2.4: the closed acquired alternative names a stored object by its handoff and hash - never bytes, a source class or a URL
  if (value.acquired === undefined) return { ok: true, value: { library: value.library, name: value.name } };
  const acquired = value.acquired;
  if (!closedRecord(acquired, ["handoffId", "objectHash"]) || typeof acquired.handoffId !== "string" || !HANDOFF_ID.test(acquired.handoffId) || typeof acquired.objectHash !== "string" || !OBJECT_HASH.test(acquired.objectHash)) return { ok: false, field };
  return { ok: true, value: { library: value.library, name: value.name, acquired: { handoffId: acquired.handoffId, objectHash: acquired.objectHash } } };
}

export type NormalizedSpec = { ok: true; spec: AtomicPublicationSpec } | { ok: false; field: string };

/** The person-entered spec, closed and bounded: unknown keys (asset bytes, a source class, a reviewer stamp) refuse it. */
export function normalizeAtomicPublicationSpec(raw: unknown): NormalizedSpec {
  if (!closedRecord(raw, ["exactMpn", "profile", "symbol", "footprint", "terminals", "package", "datasheet", "manufacturer"])) return { ok: false, field: "spec" };
  if (typeof raw.exactMpn !== "string" || raw.exactMpn.length > 64) return { ok: false, field: "exactMpn" };
  let exactMpn: string;
  try {
    // refused rather than folded: an invisible or confusable character is never trimmed into a clean spelling (OD-34)
    exactMpn = canonicalExactMpn(raw.exactMpn) && raw.exactMpn.replace(/^ +| +$/g, "");
    if (!/^[!-~]([ -~]*[!-~])?$/.test(exactMpn)) return { ok: false, field: "exactMpn" };
  } catch {
    return { ok: false, field: "exactMpn" };
  }
  if (typeof raw.profile !== "string" || !(IMPORT_REVIEW_PROFILES as readonly string[]).includes(raw.profile)) return { ok: false, field: "profile" };
  const symbol = reference(raw.symbol, "symbol");
  if (!symbol.ok) return symbol;
  const footprint = reference(raw.footprint, "footprint");
  if (!footprint.ok) return footprint;

  const terminals: AtomicPublicationSpec["terminals"] = [];
  if (raw.terminals !== undefined && raw.terminals !== null) {
    if (!Array.isArray(raw.terminals) || raw.terminals.length > MAX_TERMINALS) return { ok: false, field: "terminals" };
    const numbers = new Set<string>();
    for (const row of raw.terminals) {
      if (!closedRecord(row, ["number", "function", "pads"]) || typeof row.number !== "string" || !TERMINAL_NUMBER.test(row.number) || numbers.has(row.number)) return { ok: false, field: "terminals" };
      const fn = text(row.function, 64);
      if (fn === null) return { ok: false, field: "terminals" };
      const pads = row.pads === undefined ? [row.number] : row.pads;
      if (!Array.isArray(pads) || pads.length === 0 || pads.length > MAX_PADS_PER_TERMINAL || pads.some((pad) => typeof pad !== "string" || !TERMINAL_NUMBER.test(pad))) return { ok: false, field: "terminals" };
      numbers.add(row.number);
      terminals.push({ number: row.number, function: fn, pads: [...new Set(pads as string[])] });
    }
    // [B19-E E4 review] the table the reviewer sees is the whole table: one too long to keep whole is refused, never cut
    if (terminalTableText(terminals).length > EXTRACTION_PIN_MAP_MAX_LENGTH) return { ok: false, field: "terminals" };
  }

  let pkg: AtomicPublicationSpec["package"] = null;
  if (raw.package !== undefined && raw.package !== null) {
    if (!closedRecord(raw.package, ["code", "mounting"]) || (raw.package.mounting !== "smd" && raw.package.mounting !== "through_hole")) return { ok: false, field: "package" };
    const code = text(raw.package.code, 64);
    if (code === null) return { ok: false, field: "package" };
    pkg = { code, mounting: raw.package.mounting };
  }

  let datasheet: AtomicPublicationSpec["datasheet"] = null;
  if (raw.datasheet !== undefined && raw.datasheet !== null) {
    if (!closedRecord(raw.datasheet, ["url", "locator"])) return { ok: false, field: "datasheet" };
    const locator = text(raw.datasheet.locator, 300);
    if (locator === null) return { ok: false, field: "datasheet" };
    // a link that is not a plain web document link is dropped, never "fixed"
    const url = raw.datasheet.url === null || raw.datasheet.url === undefined ? null : typeof raw.datasheet.url === "string" && raw.datasheet.url.length <= 2_000 ? safeExternalHref(raw.datasheet.url, "document") : null;
    datasheet = { url, locator };
  }

  let manufacturer: AtomicPublicationSpec["manufacturer"] = null;
  if (raw.manufacturer !== undefined && raw.manufacturer !== null) {
    if (!closedRecord(raw.manufacturer, ["canonicalName", "officialDomains"])) return { ok: false, field: "manufacturer" };
    const canonicalName = text(raw.manufacturer.canonicalName, 120);
    const domains = raw.manufacturer.officialDomains ?? [];
    if (canonicalName === null || !Array.isArray(domains) || domains.length > 8 || domains.some((domain) => typeof domain !== "string" || !DOMAIN.test(domain))) return { ok: false, field: "manufacturer" };
    manufacturer = { canonicalName, officialDomains: [...new Set(domains as string[])].sort() };
  }

  return { ok: true, spec: { exactMpn, profile: raw.profile as ImportReviewProfile, symbol: symbol.value, footprint: footprint.value, terminals, package: pkg, datasheet, manufacturer } };
}

/** Links to catalog parts written with the publication: at most 64, a catalog part id and a normalized value key each. */
export function normalizeAtomicPublicationLinks(raw: unknown): Normalized<AtomicPublicationLink[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw) || raw.length > MAX_LINKS) return { ok: false, field: "links" };
  const links: AtomicPublicationLink[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!closedRecord(item, ["partId", "valueKey"]) || typeof item.partId !== "string" || !PART_ID.test(item.partId) || typeof item.valueKey !== "string" || item.valueKey.length > 64 || item.valueKey !== normalizeValueKey(item.valueKey)) return { ok: false, field: "links" };
    const key = `${item.partId.toLowerCase()}|${item.valueKey}`;
    if (seen.has(key)) return { ok: false, field: "links" };
    seen.add(key);
    links.push({ partId: item.partId.toLowerCase(), valueKey: item.valueKey });
  }
  return { ok: true, value: links };
}

// ── evidence the request offers the reviewer ────────────────────────────────

export interface AtomicAuthoringIdentity {
  manufacturerId: string | null;
  exactPartId: string | null;
  logicalPartId: string | null;
  latestRevision: number;
}

export interface AtomicAuthoringContext {
  /** The principal who entered the spec (server-derived). */
  authoredBy: string;
  authoredAt: string;
  identity: AtomicAuthoringIdentity;
  library: BundledKicadLibrary;
  /** [PR-M, 2026-10-18] M2.4: the acquired assets the request names (preloaded through the store port); absent: none */
  acquired?: AcquiredKicadAssets | null;
}

interface ReadAssets {
  symbolSource: string | null;
  footprintSource: string | null;
  /** [PR-M, 2026-10-18] where each text came from (the bundled library or an acquired object) */
  symbolText: KicadAssetText | null;
  footprintText: KicadAssetText | null;
  symbol: SymbolAssetVersion | null;
  footprint: FootprintAssetVersion | null;
  symbolLocator: string | null;
  footprintLocator: string | null;
  diagnostics: string[];
}

function kicadRecordFor(text: KicadAssetText, mediaType: string, at: string) {
  return makeSourceRecord({ source: text.source, content: text.text, revision: text.revision, locator: text.locator, mediaType, retrievedAt: new Date(text.retrievedAt ?? at) });
}

/** [PR-M, 2026-10-18] The bundled library as a KiCad asset source: the source identity, licence, revision and locator it always had. */
function bundledAssetText(library: BundledKicadLibrary, kind: "symbol" | "footprint", ref: { library: string; name: string }): KicadAssetText | null {
  const text = kind === "symbol" ? library.symbol(ref.library, ref.name) : library.footprint(ref.library, ref.name);
  if (text === null) return null;
  const locator = kind === "symbol" ? `data/kicad-symbols/${ref.library}.kicad_symdir/${ref.name}.kicad_sym` : `data/kicad-footprints/${ref.library}.pretty/${ref.name}.kicad_mod`;
  return { text, source: KICAD_SOURCE, license: KICAD_LIBRARY_LICENSE, revision: kind === "symbol" ? library.symbolsRevision : library.footprintsRevision, locator, retrievedAt: null };
}

function assetText(context: AtomicAuthoringContext, kind: "symbol" | "footprint", ref: { library: string; name: string; acquired?: AcquiredAssetPointer }): KicadAssetText | null {
  if (!ref.acquired) return bundledAssetText(context.library, kind, ref);
  return context.acquired?.read(kind, { library: ref.library, name: ref.name, acquired: ref.acquired }) ?? null;
}

function readAssets(spec: AtomicPublicationSpec, context: AtomicAuthoringContext): ReadAssets {
  const out: ReadAssets = { symbolSource: null, footprintSource: null, symbolText: null, footprintText: null, symbol: null, footprint: null, symbolLocator: null, footprintLocator: null, diagnostics: [] };
  if (spec.symbol) {
    const { library, name } = spec.symbol;
    out.symbolText = assetText(context, "symbol", spec.symbol);
    out.symbolLocator = out.symbolText?.locator ?? `data/kicad-symbols/${library}.kicad_symdir/${name}.kicad_sym`;
    out.symbolSource = out.symbolText?.text ?? null;
    if (out.symbolSource === null || !out.symbolText) out.diagnostics.push(spec.symbol.acquired ? `symbol ${library}:${name} is not among the stored objects of ${spec.symbol.acquired.handoffId}` : `symbol ${library}:${name} is not in the bundled KiCad library`);
    else {
      try {
        const record = kicadRecordFor(out.symbolText, MEDIA_SYMBOL, context.authoredAt);
        const parsed = parseSymbolAssets({ source: out.symbolSource, origin: { sourceRecordId: record.id, libraryNickname: library, sourceUri: `kicad://symbols/${library}/${name}`, licenseId: out.symbolText.license.id } }).find((asset) => asset.symbolName === name) ?? null;
        if (!parsed) out.diagnostics.push(`symbol ${library}:${name} was not found in its library file`);
        else if (parsed.validationState !== "valid" && parsed.validationState !== "valid_with_limitations") out.diagnostics.push(`symbol ${library}:${name} is ${parsed.validationState}`);
        else out.symbol = parsed;
      } catch {
        out.diagnostics.push(`symbol ${library}:${name} could not be parsed`);
      }
    }
  }
  if (spec.footprint) {
    const { library, name } = spec.footprint;
    out.footprintText = assetText(context, "footprint", spec.footprint);
    out.footprintLocator = out.footprintText?.locator ?? `data/kicad-footprints/${library}.pretty/${name}.kicad_mod`;
    out.footprintSource = out.footprintText?.text ?? null;
    if (out.footprintSource === null || !out.footprintText) out.diagnostics.push(spec.footprint.acquired ? `footprint ${library}:${name} is not among the stored objects of ${spec.footprint.acquired.handoffId}` : `footprint ${library}:${name} is not in the bundled KiCad library`);
    else {
      try {
        const record = kicadRecordFor(out.footprintText, MEDIA_FOOTPRINT, context.authoredAt);
        const parsed = parseFootprintAsset({ source: out.footprintSource, libraryNickname: library, origin: { sourceRecordId: record.id, libraryNickname: library, sourceUri: `kicad://footprints/${library}/${name}`, licenseId: out.footprintText.license.id } });
        if (parsed.validationState !== "valid" && parsed.validationState !== "valid_with_limitations") out.diagnostics.push(`footprint ${library}:${name} is ${parsed.validationState}`);
        else out.footprint = parsed;
      } catch {
        out.diagnostics.push(`footprint ${library}:${name} could not be parsed`);
      }
    }
  }
  return out;
}

function organizationSource(authoredBy: string): SourceIdentity {
  return { id: `source_org_authored_${sha256(catalogActorKey(authoredBy)).slice(0, 32)}`, sourceClass: "organization_authored", name: `Terminal table, package and datasheet citation entered by ${authoredBy}`, officialDomains: [], licenseId: ORGANIZATION_AUTHORED_LICENSE.id };
}

/** What the person entered, as the organization-authored document the evidence cites. */
function organizationContent(spec: AtomicPublicationSpec, authoredBy: string): string {
  return canonicalJson({ schema: ATOMIC_AUTHORING_VERSION, authoredBy, exactMpn: spec.exactMpn, terminals: spec.terminals, package: spec.package, datasheet: spec.datasheet, manufacturer: spec.manufacturer });
}

export function terminalTableText(terminals: AtomicPublicationSpec["terminals"]): string {
  return terminals.map((terminal) => `${terminal.number}=${terminal.function}@${terminal.pads.join("+")}`).join(",");
}

function citation(spec: AtomicPublicationSpec, authoredBy: string, what: string): string {
  return spec.datasheet ? `${what} entered by ${authoredBy}, citing ${spec.datasheet.locator}` : `${what} entered by ${authoredBy}`;
}

/** The engineering candidates a request offers the reviewer: the bundled KiCad assets it names and what the person entered. */
export function authoringCandidates(spec: AtomicPublicationSpec, context: AtomicAuthoringContext): { candidates: NormalizedCandidate[]; diagnostics: string[] } {
  const assets = readAssets(spec, context);
  const candidates: NormalizedCandidate[] = [];
  // [PR-M, 2026-10-18] each candidate names the source its text came from (for the bundled library: the identity, class and revision it always had)
  if (assets.symbol && assets.symbolSource !== null && assets.symbolText) {
    candidates.push(candidateFromExtraction({ exactMpn: spec.exactMpn, sourceId: assets.symbolText.source.id, sourceClass: assets.symbolText.source.sourceClass, method: "kicad_parser", parserVersion: KICAD_ASSET_PARSER_VERSION, documentHash: sha256(assets.symbolSource), sourceRevision: assets.symbolText.revision, facts: [{ property: "symbol", facet: "terminal", value: `${spec.symbol!.library}:${spec.symbol!.name}`, locator: assets.symbolLocator! }] }));
  }
  if (assets.footprint && assets.footprintSource !== null && assets.footprintText) {
    candidates.push(candidateFromExtraction({ exactMpn: spec.exactMpn, sourceId: assets.footprintText.source.id, sourceClass: assets.footprintText.source.sourceClass, method: "kicad_parser", parserVersion: KICAD_ASSET_PARSER_VERSION, documentHash: sha256(assets.footprintSource), sourceRevision: assets.footprintText.revision, facts: [{ property: "footprint", facet: "package", value: `${spec.footprint!.library}:${spec.footprint!.name}`, locator: assets.footprintLocator! }] }));
  }
  const facts: Array<{ property: string; facet: "identity" | "terminal" | "package"; value: string; locator: string }> = [
    { property: "mpn", facet: "identity", value: spec.exactMpn, locator: citation(spec, context.authoredBy, "exact MPN") },
  ];
  if (spec.manufacturer) facts.push({ property: "manufacturer", facet: "identity", value: spec.manufacturer.canonicalName, locator: citation(spec, context.authoredBy, "manufacturer") });
  if (spec.terminals.length > 0) facts.push({ property: "pin_mapping", facet: "terminal", value: terminalTableText(spec.terminals), locator: citation(spec, context.authoredBy, "terminal table") });
  if (spec.package) facts.push({ property: "package", facet: "package", value: `${spec.package.code} (${spec.package.mounting})`, locator: citation(spec, context.authoredBy, "package") });
  const source = organizationSource(context.authoredBy);
  candidates.push(candidateFromExtraction({ exactMpn: spec.exactMpn, sourceId: source.id, sourceClass: "organization_authored", method: "manual", parserVersion: ATOMIC_AUTHORING_VERSION, documentHash: sha256(organizationContent(spec, context.authoredBy)), facts }));
  return { candidates, diagnostics: assets.diagnostics };
}

// ── the draft ────────────────────────────────────────────────────────────────

export class AtomicAuthoringError extends Error {
  constructor(readonly detail: string[]) {
    super(`The draft cannot be assembled: ${detail.join("; ")}`);
    this.name = "AtomicAuthoringError";
  }
}

export interface AssembledAtomicDraft {
  catalog: AtomicCatalog;
  draft: AtomicPartRevision;
  manufacturer: Manufacturer;
  exactPart: ExactManufacturerPart;
  symbol: SymbolAssetVersion;
  footprint: FootprintAssetVersion | null;
  mapping: MappingCertificate | null;
  diagnostics: string[];
}

/** The draft revision for a request, in a fresh in-memory catalog that starts at the logical part's latest revision number. */
export function assembleAtomicDraft(spec: AtomicPublicationSpec, context: AtomicAuthoringContext & { manufacturer: { canonicalName: string; officialDomains: string[] } }): AssembledAtomicDraft {
  const assets = readAssets(spec, context);
  if (!assets.symbol || assets.symbolSource === null || !assets.symbolText) throw new AtomicAuthoringError(assets.diagnostics.length > 0 ? assets.diagnostics : ["the request names no symbol"]);
  const at = new Date(context.authoredAt);
  const catalog = new AtomicCatalog();
  catalog.addLicense(KICAD_LIBRARY_LICENSE);
  catalog.addLicense(ORGANIZATION_AUTHORED_LICENSE);

  const normalizedName = context.manufacturer.canonicalName.normalize("NFKC").trim().toUpperCase();
  const manufacturer: Manufacturer = { id: context.identity.manufacturerId ?? `manufacturer_${semanticHash({ normalizedName }).slice(0, 32)}`, canonicalName: context.manufacturer.canonicalName, aliases: [], officialDomains: [...context.manufacturer.officialDomains] };
  catalog.addManufacturer(manufacturer);
  const organization = organizationSource(context.authoredBy);
  catalog.addSource(KICAD_SOURCE);
  catalog.addSource(organization);
  // [PR-M, 2026-10-18] M2.4: an acquired asset's own source identity and licence (the KiCad licence is the same record, so it deduplicates)
  for (const text of [assets.symbolText, assets.footprintText]) {
    if (!text) continue;
    catalog.addSource(text.source);
    catalog.addLicense(text.license);
  }

  const content = organizationContent(spec, context.authoredBy);
  const organizationRecord = makeSourceRecord({ source: organization, content, revision: "person-entered/1", locator: `sirkit://organization-authored/${sha256(content).slice(0, 32)}`, mediaType: "application/json", retrievedAt: at });
  const symbolRecord = kicadRecordFor(assets.symbolText, MEDIA_SYMBOL, context.authoredAt);
  const footprintRecord = assets.footprint && assets.footprintSource !== null && assets.footprintText ? kicadRecordFor(assets.footprintText, MEDIA_FOOTPRINT, context.authoredAt) : null;
  // [PR-M, 2026-10-18] M2.4: an acquired pin table that states exactly the spec's terminal table joins the mapping's terminal evidence
  const acquiredTable = context.acquired?.pinTable ?? null;
  const pinTable = acquiredTable && spec.terminals.length > 0 && acquiredTable.terminals === terminalTableText(spec.terminals) ? acquiredTable : null;
  const pinTableRecord = pinTable ? makeSourceRecord({ source: pinTable.source, content: pinTable.text, revision: pinTable.revision, locator: pinTable.locator, mediaType: "text/plain", retrievedAt: new Date(pinTable.retrievedAt ?? context.authoredAt) }) : null;
  if (pinTable) { catalog.addSource(pinTable.source); catalog.addLicense(pinTable.license); }
  const blobs = [
    { record: organizationRecord, content, mediaType: "application/json", licenseId: ORGANIZATION_AUTHORED_LICENSE.id },
    { record: symbolRecord, content: assets.symbolSource, mediaType: MEDIA_SYMBOL, licenseId: assets.symbolText.license.id },
    ...(footprintRecord ? [{ record: footprintRecord, content: assets.footprintSource!, mediaType: MEDIA_FOOTPRINT, licenseId: assets.footprintText!.license.id }] : []),
    ...(pinTableRecord && pinTable ? [{ record: pinTableRecord, content: pinTable.text, mediaType: "text/plain", licenseId: pinTable.license.id }] : []),
  ];
  for (const blob of blobs) {
    catalog.addSourceRecord(blob.record);
    const raw = rawContentObject({ content: blob.content, mediaType: blob.mediaType, licenseId: blob.licenseId });
    if (raw.id !== blob.record.rawObjectId) throw new AtomicAuthoringError([`raw content id mismatch for ${blob.record.locator}`]);
    catalog.addRawObject(raw);
  }

  const organizationEvidence = makeEvidence({ sourceRecord: organizationRecord, locator: citation(spec, context.authoredBy, "terminal table and package"), method: "manual", extractorVersion: ATOMIC_AUTHORING_VERSION, extractedAt: at });
  const footprintEvidence = footprintRecord ? makeEvidence({ sourceRecord: footprintRecord, locator: assets.footprintLocator!, method: "kicad_parser", extractorVersion: KICAD_ASSET_PARSER_VERSION, extractedAt: at }) : null;
  catalog.addEvidence(organizationEvidence);
  if (footprintEvidence) catalog.addEvidence(footprintEvidence);
  const pinTableEvidence = pinTableRecord && pinTable ? makeEvidence({ sourceRecord: pinTableRecord, locator: `${pinTable.locator} (pin table)`, method: "deterministic_inference", extractorVersion: pinTable.parserVersion, extractedAt: at }) : null;
  if (pinTableEvidence) catalog.addEvidence(pinTableEvidence);
  const terminalEvidenceIds = pinTableEvidence ? [organizationEvidence.id, pinTableEvidence.id] : [organizationEvidence.id];

  const symbol = assets.symbol;
  const footprint = footprintRecord ? assets.footprint : null;
  catalog.addSymbol(symbol);
  if (footprint) catalog.addFootprint(footprint);

  const exactPart: ExactManufacturerPart = { id: context.identity.exactPartId ?? exactManufacturerPartId(manufacturer.id, spec.exactMpn), manufacturerId: manufacturer.id, exactMpn: spec.exactMpn, normalizedSearchKey: normalizeMpnSearchKey(spec.exactMpn), state: "active", aliasEvidenceIds: [] };
  catalog.addExactPart(exactPart);

  let mapping: MappingCertificate | null = null;
  const diagnostics = [...assets.diagnostics];
  if (footprint && footprintEvidence && spec.terminals.length > 0) {
    // the pin-to-pad mapping rests on the person's terminal table alone: the KiCad library carries no manufacturer terminal table
    const terminals: ManufacturerTerminal[] = spec.terminals.map((terminal) => ({ id: `terminal_${exactPart.id}_${terminal.number}`, publishedIdentifier: terminal.number, function: terminal.function, classification: "electrical", evidenceIds: [...terminalEvidenceIds] }));
    const electricalPadCount = new Set(footprint.pads.filter((pad) => !pad.mechanical).map((pad) => pad.number)).size;
    const tablePads = new Set(spec.terminals.flatMap((terminal) => terminal.pads)).size;
    const packageProof = provePackage({
      exactPartId: exactPart.id,
      footprintVersionId: footprint.versionId,
      ...(spec.package ? { packageCode: spec.package.code, mountingTechnology: spec.package.mounting } : {}),
      pinCount: electricalPadCount,
      evidenceIds: [organizationEvidence.id, footprintEvidence.id],
      checks: [
        { field: "pinCount", expected: electricalPadCount, actual: tablePads },
        ...(spec.package ? [{ field: "mountingTechnology", expected: spec.package.mounting, actual: footprint.mountingTechnology }] : []),
      ],
    });
    try {
      mapping = buildMappingCertificate({
        exactPartId: exactPart.id, symbol, footprint, terminals,
        mapping: spec.terminals.map((terminal) => ({ manufacturerTerminalId: `terminal_${exactPart.id}_${terminal.number}`, symbolPinNumbers: [terminal.number], logicalPadNumbers: terminal.pads, evidenceIds: [...terminalEvidenceIds] })),
        packageProof,
        evidenceIds: [...terminalEvidenceIds],
      });
      catalog.addMapping(mapping);
    } catch {
      diagnostics.push("the terminal table does not form a pin-to-pad mapping for this symbol and footprint");
    }
  }

  const draft = createAtomicRevision({
    logicalPartId: context.identity.logicalPartId ?? `logical_${semanticHash({ exactPartId: exactPart.id }).slice(0, 40)}`,
    revision: context.identity.latestRevision + 1,
    exactPartId: exactPart.id,
    cadBundles: [{ symbolVersionId: symbol.versionId, ...(footprint ? { footprintVersionId: footprint.versionId } : {}), modelVersionIds: [], ...(mapping ? { mappingCertificateId: mapping.id } : {}), disposition: "primary_approved" }],
    claimIds: [],
    guidanceIds: [],
    offerSnapshotIds: [],
    licenseIds: [...new Set([KICAD_LIBRARY_LICENSE.id, ORGANIZATION_AUTHORED_LICENSE.id, ...[assets.symbolText, footprint ? assets.footprintText : null].flatMap((text) => (text ? [text.license.id] : [])), ...(pinTableEvidence && pinTable ? [pinTable.license.id] : [])])],
    publicationState: "draft",
    policyVersion: ATOMIC_PUBLICATION_POLICY_VERSION,
    createdAt: context.authoredAt,
    createdBy: context.authoredBy,
    reviewHistory: [],
  });
  catalog.addRevision(draft);
  return { catalog, draft, manufacturer, exactPart, symbol, footprint, mapping, diagnostics };
}
