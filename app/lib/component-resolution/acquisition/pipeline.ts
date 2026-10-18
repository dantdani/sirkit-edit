/**
 * [PR-M, 2026-10-18] Section M2 (runbook M.3 items 2-5, design M2.3): RETRIEVE -> HASH -> STORE -> PARSE -> VALIDATE -> DURABLE CANDIDATE,
 * over the admitted CAD source adapters the composition root hands in (it decides admission: a blocked or fixture-only source is never
 * an adapter here; it is a recorded `skipped` attempt).
 *
 * Per source, in order: the target's KiCad symbol (and, when it `extends` a parent of the same library, that parent's file - at most
 * COMPOSE_MAX_DEPTH), its footprint, and - only where the row admits datasheets - a pin table; every file passes the s-expression
 * preflight BEFORE it is stored (a hostile file is refused at the boundary: its hash is recorded, its bytes are not kept), is stored in
 * the scope's object store (re-hashed on every read), parsed by the PRODUCTION parsers (`parseSymbolAssets` / `parseFootprintAsset`,
 * their hostile-input limits), and validated (`validateAcquiredAssets`). A source that lacks the asset is a failed attempt and the next
 * source is tried; a rate limit or an open breaker is a WAIT with the retry time (never a hot retry); no admitted source at all is a
 * blocker that keeps the attempts. The candidate is stored whatever its verdict: a conflicting or unsupported candidate is evidence too.
 */
import { assertBoundedSExpression, IngestSecurityError } from "../../atomic/security";
import { parseFootprintAsset, parseSymbolAssets, KICAD_ASSET_PARSER_VERSION } from "../../atomic/kicad-assets";
import { makeSourceRecord } from "../../atomic/ingestion";
import type { FootprintAssetVersion, LicenseRecord, SourceIdentity, SymbolAssetVersion } from "../../atomic/types";
import type { DurableWorkflowScope } from "../../durable-workflow/types";
import { CAD_KICAD_LIBRARY_LICENSE, CAD_SOURCE_REGISTRY, FIXTURE_PIN_TABLE_LICENSE, KICAD_LIBRARY_ATTRIBUTION, cadAssetPolicy, type CadSourceId } from "../../acquisition/cad-source-registry";
import type { CadRetrieval, CadSourceAdapter } from "../../acquisition/cad-adapters/types";
import { DurableAcquiredObjectStore, CadObjectStoreError } from "../../acquisition/cad-object-store";
import { composeSymbolLibrary, symbolParent, COMPOSE_MAX_DEPTH, KICAD_COMPOSE_VERSION } from "../../acquisition/kicad-library-compose";
import { parsePinTable, pinTableTerminals, PIN_TABLE_PARSER_VERSION } from "../../acquisition/datasheet-pin-table";
import { validateAcquiredAssets, type CadValidationTable } from "../../acquisition/cad-validation";
import type { CadAcquisitionBlockerCode, CadAssetRequestKind } from "../../acquisition/cad-acquisition-contract";
import { acquisitionCandidateId, ACQUISITION_CANDIDATE_SCHEMA, DurableAcquisitionCandidateStore, type AcquisitionCandidate, type AcquisitionTarget, type CandidateObjectRef } from "./candidate";
import { cadSourceIdentity, cadRevisionLabel } from "./source-identity";

export interface PipelineAttempt { sourceId: string; outcome: "used" | "skipped" | "failed" | "waiting"; code: string | null; detail: string; at: string }
export interface AcquisitionPipelinePorts {
  /** the ADMITTED sources, in preference order */
  adapters: readonly CadSourceAdapter[];
  /** the sources the composition did not admit, recorded as skipped (never called) */
  skipped: ReadonlyArray<{ sourceId: string; code: string; detail: string }>;
  objects: DurableAcquiredObjectStore;
  candidates: DurableAcquisitionCandidateStore;
  /** real identity evidence for an exact MPN (a cache read, never a vendor call); absent: none */
  identityEvidence?: (exactMpn: string) => Promise<{ distributorExactMpn: boolean; manufacturerDatasheet: boolean }>;
  clock: () => number;
}
export type PipelineOutcome =
  | { kind: "candidate"; candidate: AcquisitionCandidate; attempts: PipelineAttempt[] }
  | { kind: "wait"; retryAtMs: number; code: string; detail: string; attempts: PipelineAttempt[] }
  | { kind: "blocked"; code: CadAcquisitionBlockerCode; detail: string; attempts: PipelineAttempt[] }
  | { kind: "cancelled"; attempts: PipelineAttempt[] };

const WAIT_CODES = new Set(["rate_limited", "breaker_open", "quota_exhausted"]);
const MEDIA_SYMBOL = "application/x-kicad-symbol";
const MEDIA_FOOTPRINT = "application/x-kicad-footprint";

interface Retrieved { symbol: CadRetrieval; parents: CadRetrieval[]; footprint: CadRetrieval | null; datasheet: CadRetrieval | null; missing: string[] }

/** One source's retrieval of everything the target needs; a wait or a refusal stops this source. */
async function retrieveFrom(adapter: CadSourceAdapter, target: AcquisitionTarget, kinds: readonly CadAssetRequestKind[], signal: AbortSignal | undefined): Promise<{ ok: true; retrieved: Retrieved } | { ok: false; code: string; detail: string; retryAtMs?: number; hostile?: boolean }> {
  const symbol = await adapter.retrieve({ kind: "symbol", library: target.symbol.library, name: target.symbol.name, ...(signal ? { signal } : {}) });
  if (!symbol.ok) return { ok: false, code: symbol.code, detail: symbol.message, ...(symbol.retryAtMs !== undefined ? { retryAtMs: symbol.retryAtMs } : {}) };
  const parents: CadRetrieval[] = [];
  let text = symbol.object.text;
  let name = target.symbol.name;
  for (let depth = 0; depth < COMPOSE_MAX_DEPTH; depth += 1) {
    let parent: string | null;
    try { parent = symbolParent(text, name); } catch (error) { return { ok: false, code: "parser_refused", detail: error instanceof IngestSecurityError ? `the symbol file was refused at the preflight (${error.code})` : "the symbol file is not a KiCad symbol library", hostile: true }; }
    if (parent === null || parents.some((item) => item.name === parent) || parent === target.symbol.name) break;
    const fetched = await adapter.retrieve({ kind: "symbol", library: target.symbol.library, name: parent, ...(signal ? { signal } : {}) });
    if (!fetched.ok) return { ok: false, code: fetched.code === "not_found" ? "no_matching_asset" : fetched.code, detail: `the parent symbol ${target.symbol.library}:${parent} could not be retrieved: ${fetched.message}`, ...(fetched.retryAtMs !== undefined ? { retryAtMs: fetched.retryAtMs } : {}) };
    parents.push(fetched.object);
    text = fetched.object.text;
    name = parent;
  }
  let footprint: CadRetrieval | null = null;
  const missing: string[] = [];
  if (target.footprint && kinds.includes("footprint")) {
    const fetched = await adapter.retrieve({ kind: "footprint", library: target.footprint.library, name: target.footprint.name, ...(signal ? { signal } : {}) });
    if (!fetched.ok) return { ok: false, code: fetched.code === "not_found" ? "no_matching_asset" : fetched.code, detail: `footprint ${target.footprint.library}:${target.footprint.name}: ${fetched.message}`, ...(fetched.retryAtMs !== undefined ? { retryAtMs: fetched.retryAtMs } : {}) };
    footprint = fetched.object;
  } else if (!target.footprint) missing.push("footprint: the catalog part names no footprint; the candidate is schematic-only");
  let datasheet: CadRetrieval | null = null;
  if (kinds.includes("datasheet")) {
    const policy = cadAssetPolicy(CAD_SOURCE_REGISTRY[adapter.sourceId], "datasheet");
    if (!policy.accepted) missing.push(`datasheet: ${CAD_SOURCE_REGISTRY[adapter.sourceId].displayName} carries none (${policy.refusal}); the terminal table stays a fact a person confirms`);
    else {
      const fetched = await adapter.retrieve({ kind: "datasheet", library: null, name: target.exactMpn ?? target.symbol.name, ...(signal ? { signal } : {}) });
      if (fetched.ok) datasheet = fetched.object;
      else if (WAIT_CODES.has(fetched.code)) return { ok: false, code: fetched.code, detail: fetched.message, ...(fetched.retryAtMs !== undefined ? { retryAtMs: fetched.retryAtMs } : {}) };
      else missing.push(`datasheet: no pin table was found at the source (${fetched.code}); the terminal table stays a fact a person confirms`);
    }
  }
  if (kinds.includes("model")) missing.push("3D model: not retrieved in M2 (K.6, OD-M2-7); an optional visualization never blocks an electrical replacement");
  return { ok: true, retrieved: { symbol: symbol.object, parents, footprint, datasheet, missing } };
}

function objectRef(role: CandidateObjectRef["role"], object: CadRetrieval): CandidateObjectRef {
  return { role, sha256: object.sha256, byteLength: object.byteLength, mediaType: object.mediaType, locator: object.locator, ref: object.ref, retrievedAt: object.retrievedAt, sourceId: object.sourceId, library: object.library, name: object.name };
}

function parseOrigin(source: SourceIdentity, license: LicenseRecord, text: string, revision: string, locator: string, mediaType: string, retrievedAt: string, library: string, sourceUri: string) {
  const record = makeSourceRecord({ source, content: text, revision, locator, mediaType, retrievedAt: new Date(retrievedAt) });
  return { sourceRecordId: record.id, libraryNickname: library, sourceUri, licenseId: license.id };
}

/** Run the pipeline for ONE target. `checkpoint` is asked between stages (a cancel or a lost fence stops it; nothing later is stored). */
export async function runAcquisitionPipeline(input: { scope: DurableWorkflowScope; target: AcquisitionTarget; assetKinds: readonly CadAssetRequestKind[]; ports: AcquisitionPipelinePorts; signal?: AbortSignal; checkpoint?: (stage: "retrieved" | "stored") => Promise<boolean> }): Promise<PipelineOutcome> {
  const { ports, target, scope } = input;
  const at = (): string => new Date(ports.clock()).toISOString();
  const attempts: PipelineAttempt[] = ports.skipped.map((entry) => ({ sourceId: entry.sourceId, outcome: "skipped" as const, code: entry.code, detail: entry.detail, at: at() }));
  if (ports.adapters.length === 0) {
    const terms = ports.skipped.some((entry) => entry.code === "blocked");
    return { kind: "blocked", code: terms ? "source_terms" : "source_unavailable", detail: terms ? "the only CAD source that could serve the part is blocked pending the owner's decision" : "no CAD source is admitted on this server", attempts };
  }
  let lastFailure: { code: string; detail: string } | null = null;
  for (const adapter of ports.adapters) {
    if (input.signal?.aborted) return { kind: "cancelled", attempts };
    const outcome = await retrieveFrom(adapter, target, input.assetKinds, input.signal);
    if (!outcome.ok) {
      if (WAIT_CODES.has(outcome.code) && outcome.retryAtMs !== undefined) {
        attempts.push({ sourceId: adapter.sourceId, outcome: "waiting", code: outcome.code, detail: outcome.detail, at: at() });
        return { kind: "wait", retryAtMs: outcome.retryAtMs, code: outcome.code, detail: outcome.detail, attempts };
      }
      if (outcome.code === "aborted" || input.signal?.aborted) return { kind: "cancelled", attempts };
      attempts.push({ sourceId: adapter.sourceId, outcome: outcome.code === "checkout_unavailable" || outcome.code === "checkout_not_pinned" ? "skipped" : "failed", code: outcome.code, detail: outcome.detail, at: at() });
      lastFailure = { code: outcome.code, detail: outcome.detail };
      if (outcome.hostile) return { kind: "blocked", code: "parser_refused", detail: outcome.detail, attempts };
      continue;
    }
    if (input.checkpoint && !(await input.checkpoint("retrieved"))) return { kind: "cancelled", attempts };
    return { kind: "candidate", candidate: await buildCandidate(scope, target, adapter.sourceId, outcome.retrieved, ports, attempts, at), attempts: [...attempts, { sourceId: adapter.sourceId, outcome: "used", code: null, detail: `retrieved from ${CAD_SOURCE_REGISTRY[adapter.sourceId].displayName}`, at: at() }] };
  }
  const code: CadAcquisitionBlockerCode = lastFailure && /no_matching_asset|not_found/.test(lastFailure.code) ? "no_matching_asset" : attempts.every((attempt) => attempt.outcome === "skipped") ? "source_unavailable" : "no_matching_asset";
  return { kind: "blocked", code, detail: lastFailure?.detail ?? "no admitted source carried the assets", attempts };
}

async function buildCandidate(scope: DurableWorkflowScope, target: AcquisitionTarget, sourceId: CadSourceId, retrieved: Retrieved, ports: AcquisitionPipelinePorts, attempts: PipelineAttempt[], at: () => string): Promise<AcquisitionCandidate> {
  const entry = CAD_SOURCE_REGISTRY[sourceId];
  const parseFailures: string[] = [];
  const objects: CandidateObjectRef[] = [];
  const committedAt = at();
  const store = async (role: CandidateObjectRef["role"], object: CadRetrieval, license: LicenseRecord, kind: "symbol" | "footprint" | "datasheet"): Promise<boolean> => {
    if (kind !== "datasheet") {
      try { assertBoundedSExpression(object.text); } catch (error) { parseFailures.push(`${role} ${object.library ?? ""}:${object.name} was refused at the s-expression preflight (${error instanceof IngestSecurityError ? error.code : "malformed"}); its bytes were not kept (sha256 ${object.sha256})`); objects.push(objectRef(role, object)); return false; }
    }
    await ports.objects.put(scope, { text: object.text, kind, mediaType: object.mediaType, license, retention: entry.license.retention, provenance: { sourceId: object.sourceId, registryVersion: object.registryVersion, locator: object.locator, ref: object.ref, retrievedAt: object.retrievedAt }, committedAt });
    objects.push(objectRef(role, object));
    return true;
  };
  const kicadLicense = CAD_KICAD_LIBRARY_LICENSE;
  const symbolStored = await store("symbol-file", retrieved.symbol, kicadLicense, "symbol");
  for (const parent of retrieved.parents) await store("symbol-parent", parent, kicadLicense, "symbol");
  const footprintStored = retrieved.footprint ? await store("footprint", retrieved.footprint, kicadLicense, "footprint") : false;
  const datasheetStored = retrieved.datasheet ? await store("datasheet", retrieved.datasheet, FIXTURE_PIN_TABLE_LICENSE, "datasheet") : false;

  // the ONE library text the symbol is published from (the child alone, or composed with its parents)
  let symbolObject: string | null = null;
  let symbolText: string | null = null;
  if (symbolStored) {
    try {
      const composed = composeSymbolLibrary(retrieved.symbol.text, target.symbol.name, new Map(retrieved.parents.map((parent) => [parent.name, parent.text])));
      if (!composed.ok) parseFailures.push(`symbol ${target.symbol.library}:${target.symbol.name} could not be assembled with its parents (${composed.code}: ${composed.detail})`);
      else if (!composed.composed) { symbolObject = retrieved.symbol.sha256; symbolText = composed.text; }
      else {
        const stored = await ports.objects.put(scope, { text: composed.text, kind: "symbol-library", mediaType: MEDIA_SYMBOL, license: kicadLicense, retention: entry.license.retention, provenance: { sourceId: "composed", registryVersion: KICAD_COMPOSE_VERSION, locator: `composed:${target.symbol.library}.kicad_symdir/${target.symbol.name}`, ref: retrieved.symbol.ref, retrievedAt: retrieved.symbol.retrievedAt, composedFrom: [retrieved.symbol.sha256, ...retrieved.parents.map((parent) => parent.sha256)] }, committedAt });
        symbolObject = stored.object.sha256;
        symbolText = composed.text;
        objects.push({ role: "symbol-library", sha256: stored.object.sha256, byteLength: stored.object.byteLength, mediaType: MEDIA_SYMBOL, locator: `composed:${target.symbol.library}.kicad_symdir/${target.symbol.name}`, ref: retrieved.symbol.ref, retrievedAt: retrieved.symbol.retrievedAt, sourceId: "composed", library: target.symbol.library, name: target.symbol.name });
      }
    } catch (error) {
      parseFailures.push(`symbol ${target.symbol.library}:${target.symbol.name} was refused (${error instanceof IngestSecurityError ? error.code : error instanceof CadObjectStoreError ? error.code : "malformed"})`);
    }
  }

  const source = cadSourceIdentity(sourceId);
  let symbol: SymbolAssetVersion | null = null;
  if (symbolText !== null) {
    try {
      const origin = parseOrigin(source, kicadLicense, symbolText, cadRevisionLabel(sourceId, "symbol"), retrieved.symbol.locator, MEDIA_SYMBOL, retrieved.symbol.retrievedAt, target.symbol.library, `kicad://symbols/${target.symbol.library}/${target.symbol.name}`);
      symbol = parseSymbolAssets({ source: symbolText, origin }).find((asset) => asset.symbolName === target.symbol.name) ?? null;
      if (!symbol) parseFailures.push(`symbol ${target.symbol.name} is not defined in its library file`);
    } catch (error) {
      parseFailures.push(`symbol ${target.symbol.library}:${target.symbol.name} was refused by the parser (${error instanceof IngestSecurityError ? error.code : "malformed"})`);
    }
  }
  let footprint: FootprintAssetVersion | null = null;
  if (footprintStored && retrieved.footprint && target.footprint) {
    try {
      const origin = parseOrigin(source, kicadLicense, retrieved.footprint.text, cadRevisionLabel(sourceId, "footprint"), retrieved.footprint.locator, MEDIA_FOOTPRINT, retrieved.footprint.retrievedAt, target.footprint.library, `kicad://footprints/${target.footprint.library}/${target.footprint.name}`);
      footprint = parseFootprintAsset({ source: retrieved.footprint.text, libraryNickname: target.footprint.library, origin });
    } catch (error) {
      parseFailures.push(`footprint ${target.footprint.library}:${target.footprint.name} was refused by the parser (${error instanceof IngestSecurityError ? error.code : "malformed"})`);
    }
  }
  let table: CadValidationTable | null = null;
  let pinTable: AcquisitionCandidate["pinTable"] = null;
  const missing = [...retrieved.missing];
  if (datasheetStored && retrieved.datasheet) {
    const parsed = parsePinTable(retrieved.datasheet.text);
    const tableClass = cadAssetPolicy(entry, "datasheet").sourceClass ?? "organization_authored";
    if (!parsed.ok) missing.push(`datasheet: the source's pin table was refused (${parsed.code}: ${parsed.detail}); nothing from it is used`);
    else {
      const rows = pinTableTerminals(parsed.table);
      table = { origin: "datasheet", part: parsed.table.part, sourceClass: tableClass, fixture: parsed.table.fixture, packageCode: parsed.table.packageCode, mounting: parsed.table.mounting, rows };
      pinTable = { part: parsed.table.part, fixture: parsed.table.fixture, packageCode: parsed.table.packageCode, mounting: parsed.table.mounting, rows, sourceClass: tableClass };
    }
  }
  const identityEvidence = target.exactMpn && ports.identityEvidence ? await ports.identityEvidence(target.exactMpn).catch(() => ({ distributorExactMpn: false, manufacturerDatasheet: false })) : { distributorExactMpn: false, manufacturerDatasheet: false };
  const report = validateAcquiredAssets({
    target: { exactMpn: target.exactMpn, packageCode: target.packageCode, mounting: target.mounting, symbol: `${target.symbol.library}:${target.symbol.name}`, footprint: target.footprint ? `${target.footprint.library}:${target.footprint.name}` : null },
    symbol, footprint, parseFailures, table,
    identityEvidence: { distributorExactMpn: identityEvidence.distributorExactMpn, manufacturerDatasheet: identityEvidence.manufacturerDatasheet && table?.sourceClass === "manufacturer_datasheet" },
  });
  const summary = <T extends { diagnostics: Array<{ code: string }> }>(asset: T): string[] => asset.diagnostics.map((item) => item.code).slice(0, 16);
  const candidate: AcquisitionCandidate = {
    schema: ACQUISITION_CANDIDATE_SCHEMA,
    candidateId: acquisitionCandidateId(target, sourceId, objects, report.digest),
    target, sourceId, registryVersion: retrieved.symbol.registryVersion, objects,
    symbolObject: symbol ? symbolObject : null,
    footprintObject: footprint && retrieved.footprint ? retrieved.footprint.sha256 : null,
    datasheetObject: pinTable && retrieved.datasheet ? retrieved.datasheet.sha256 : null,
    symbol: symbol ? { library: target.symbol.library, name: symbol.symbolName, versionId: symbol.versionId, semanticHash: symbol.semanticHash, validationState: symbol.validationState, diagnostics: summary(symbol), pins: symbol.pins.map((pin) => ({ number: pin.number, name: pin.name, electricalType: String(pin.electricalType) })) } : null,
    footprint: footprint && target.footprint ? { library: target.footprint.library, name: footprint.footprintName, versionId: footprint.versionId, semanticHash: footprint.semanticHash, validationState: footprint.validationState, diagnostics: summary(footprint), mountingTechnology: footprint.mountingTechnology, electricalPads: [...new Set(footprint.pads.filter((pad) => !pad.mechanical).map((pad) => pad.number))].sort() } : null,
    pinTable,
    missing,
    report,
    licence: { record: kicadLicense, attribution: entry.license.attribution || KICAD_LIBRARY_ATTRIBUTION, link: entry.license.attributionLink, retention: "indefinite", pinTableLicence: pinTable ? FIXTURE_PIN_TABLE_LICENSE : null },
    fixtureEvidence: entry.status === "fixture",
    state: report.verdict,
    history: [{ at: committedAt, to: report.verdict, by: `worker:${KICAD_ASSET_PARSER_VERSION}`, note: `validated by ${report.validator}${pinTable ? ` with a ${PIN_TABLE_PARSER_VERSION} pin table` : ""}` }],
    createdAt: committedAt,
  };
  void attempts;
  return ports.candidates.put(scope, candidate, committedAt);
}
