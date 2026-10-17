/**
 * [PR-F fB] The agent's DRAFT REQUEST proposal, `sirkit.parts.draft-request`: a sealed REQUEST for an explicitly UNVERIFIED draft of
 * ONE unresolved part, assembled from the documented facts the request carries (manufacturer, exact MPN, package, a pin table with
 * numbers / names / functions, body and pitch dimensions, pin-1 orientation, the exposed pad), each given WITH its source label or
 * listed as missing (section F.4 of the owner's assignment; CONTINUATION C.4-C.6). It is a REVIEW TASK for a human, never a part:
 *
 *  - the existing draft path is the human-only atomic publication request (`POST /api/components/atomic/publication submit_request`,
 *    app/api/components/atomic/publication/handler.ts; `submitAtomicPublicationRequest` in app/lib/atomic/publication-review.ts refuses
 *    any non-human actor with ATOMIC_PUBLICATION_HUMAN_REQUIRED, in the catalog governance project only). The agent may NOT file one
 *    (OD-244's reading stands), so this proposal seals the request in the publication path's OWN vocabulary (`AtomicPublicationSpec`,
 *    app/lib/atomic/publication-review-contract.ts: exactMpn, profile, terminals, package, datasheet, manufacturer; symbol and
 *    footprint references left to the person - the request never names a KiCad library asset, that would be inventing a plausible
 *    package) for a member to paste into the Build Library's Request evidence review. The server then runs its own normalizer
 *    (`normalizeAtomicPublicationSpec`) and assembles the draft (`assembleAtomicDraft`); this module never imports either (they live
 *    behind the chat route's import-closure ratchet) and never claims what they would decide;
 *  - the artifact lists the missing facts precisely and states the C.4 blockers of PCB assignment (an unknown package variant, pad
 *    numbering, pin-1 orientation, pitch, courtyard / body dimensions or exposed-pad mapping): `pcbAssignment.blocked` is data; a
 *    request for the `pcb_assignable` profile with any of them missing is `proposal-blocked`, never sealed with a weaker claim;
 *  - it never claims a mapping certificate, an approval or a publication: `verification` is the constant `unverified`; the next step
 *    is a human's request, then a reviewer's approval and a different administrator's publication, then the deterministic mapping
 *    checks - only then is the part PCB-assignable;
 *  - it refuses to seal without a pin table, without an exact MPN and manufacturer, with a fact given without a source label, with a
 *    fact both given and listed missing, with conflicting pin numbers or pad mappings, and - when the chat route's catalog port is
 *    bound - with an identity, package or pin count that conflicts with the catalog part the instance was placed from (a different
 *    part is never substituted silently, C.5). Every refusal is `proposal-blocked` data with the conflicting facts listed, never ok.
 *
 * Per invocation: the exact allowlisted binding, the context integrity check, a verified schematic snapshot with its digest (the
 * sheet whose unresolved instance the request names), a fresh discovery check, the role and capability recheck, the closed argument
 * surface (authority-shaped keys - and `symbol` / `footprint` references - refused by name), the optional catalog cross-check through
 * the injected port under a deadline, then the pure compile and seal. No distributor is called; nothing is placed, bound, published,
 * approved or bought.
 */
import { discoverTools } from "../engineering/tool-discovery";
import { assertSafeJsonValue, DEFAULT_INPUT_LIMITS } from "../engineering/tool-io-validation";
import type { ToolDescriptor, ToolRegistry } from "../engineering/tool-registry";
import { engineeringDigest } from "../engineering/stable";
import { buildAuthorizationBinding, isWellFormedAuthorizationBinding, type SchematicProposalAuthorizationBinding } from "../engineering/proposal-authorization";
import { validateSchematicCanonicalMark } from "../engineering/schematic-projection";
import type { Tier1ProposalScope } from "../engineering/schematic-proposals";
import { canonicalExactMpn } from "../atomic/identity";
import { ATOMIC_PUBLICATION_ROUTE, IMPORT_REVIEW_PROFILES, type AtomicPublicationSpec, type ImportReviewProfile } from "../atomic/publication-review-contract";
import { listUnresolvedInstances, type UnresolvedInstance } from "../pcb-sync/unresolved-instances";
import type { CatalogPartInspectionPort, CatalogPartInspectionPortAnswer } from "./catalog-inspection-reads";
import type { AgentRunContext, GatewayInvocationOutcome } from "./contracts";
import { sanitizeTraceText } from "./redaction";

export const DRAFT_REQUEST_TOOL_ID = "sirkit.parts.draft-request" as const;
/** The sealed artifact's schema id (discriminate on `schema`, as for every other sealed proposal family). */
export const DRAFT_REQUEST_SCHEMA = "sirkit.part-draft-request.v1" as const;
/** A draft request expires like a tier-1 proposal; an expired one can only be re-sealed. */
export const DRAFT_REQUEST_TTL_MS = 10 * 60 * 1000;
/** The ONE proven implementation the descriptor binds: the pure compile + seal of this module (`resolveDraftRequestBinding` matches it exactly). */
export const DRAFT_REQUEST_BINDING = Object.freeze({ module: "app/lib/agent/draft-request-proposals.ts", symbol: "compilePartDraftRequest" });
/** The one word the artifact says about itself: it is not verified, and nothing in it is a certificate, an approval or a publication. */
export const DRAFT_REQUEST_VERIFICATION = "unverified" as const;
/** The human path the sealed request feeds (the SAME route the Build Library's Request evidence review POSTs; humans only). */
export const DRAFT_REQUEST_HUMAN_PATH = `${ATOMIC_PUBLICATION_ROUTE} submit_request (Build Library → Request evidence review; a person requests, a reviewer approves, a different administrator publishes)`;
/** CONTINUATION C.4: the facts whose absence BLOCKS PCB assignment of a draft, in the artifact's words. */
export const PCB_ASSIGNMENT_BLOCKING_FACTS = Object.freeze(["package variant (code and mounting)", "pad numbering (a pad for every pin)", "pin-1 orientation", "pitch", "body dimensions (courtyard)", "exposed-pad mapping"] as const);
export const MAX_DRAFT_PIN_ROWS = 512;
export const MAX_DRAFT_PADS_PER_PIN = 16;
export const MAX_DRAFT_MISSING_ENTRIES = 32;
export const MAX_DRAFT_TEXT_CHARS = 120;
/** The closed deadline margin for the optional catalog cross-check (the proposal never waits past the call's own timer). */
export const DRAFT_REQUEST_CATALOG_MARGIN_MS = 500;
/** The descriptor's valid input example (the manual's example): a documented 8-pin timer, pcb facts given with their sources. */
export const DRAFT_REQUEST_INPUT_EXAMPLE = Object.freeze({
  refDes: "U1",
  exactMpn: { value: "NE555DR", source: "TI SLFS022I, page 1" },
  manufacturer: { name: "Texas Instruments", source: "TI SLFS022I, page 1" },
  package: { code: "SOIC-8 (D)", mounting: "smd", source: "TI SLFS022I, section 10 (D package)" },
  pinTable: [{ number: "1", name: "GND", function: "ground", source: "TI SLFS022I, table 5-1" }, { number: "8", name: "VCC", function: "supply", source: "TI SLFS022I, table 5-1" }],
  pitchMm: { value: 1.27, source: "TI SLFS022I, D package drawing" },
  bodyMm: { x: 4.9, y: 3.9, source: "TI SLFS022I, D package drawing" },
  pin1Orientation: { value: "pin 1 at the top-left corner, marked by the body dot", source: "TI SLFS022I, D package drawing" },
  exposedPad: { pads: [], source: "TI SLFS022I, D package drawing (no exposed pad)" },
  missing: ["courtyard per IPC-7351 is not in the datasheet"],
  profile: "schematic_only",
});

// ─── The request as the model states it (closed keys; every fact with its source label) ─────────────────────────────────────

const TERMINAL_NUMBER = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,15}$/;
const DOMAIN = /^[a-z0-9]([a-z0-9-]{0,62}\.)+[a-z]{2,63}$/;
const REQUEST_KEYS = Object.freeze(["refDes", "exactMpn", "manufacturer", "package", "pinTable", "pitchMm", "bodyMm", "pin1Orientation", "exposedPad", "datasheet", "missing", "profile"] as const);
/** Refused by name: a claim of authority, or a KiCad asset reference the person (never the model) picks at submission. */
const AUTHORITY_KEYS = new Set(["actor", "actorId", "role", "capability", "capabilities", "authority", "approval", "approvals", "approve", "approved", "apply", "commit", "bind", "publish", "publication", "publishRequest", "certificate", "mappingCertificate", "mappingCertificateId", "verified", "verification", "revision", "revisionId", "expectedRevision", "lineageId", "scope", "headMark", "symbol", "footprint", "symbolVersionId", "footprintVersionId", "links", "idempotencyKey", "sourceClass", "evidence", "facts", "values", "snapshot", "assets", "reviewerId", "reviewedAt"]);

export interface DraftRequestArgs {
  refDes: string;
  exactMpn?: { value: string; source: string };
  manufacturer?: { name: string; domains?: string[]; source: string };
  package?: { code: string; mounting: "smd" | "through_hole"; source: string };
  pinTable?: Array<{ number: string; name?: string; function: string; pads?: string[]; source: string }>;
  pitchMm?: { value: number; source: string };
  bodyMm?: { x: number; y: number; source: string };
  pin1Orientation?: { value: string; source: string };
  exposedPad?: { pads: string[]; source: string };
  datasheet?: { locator: string; source: string };
  missing?: string[];
  profile?: ImportReviewProfile;
}

/** What the catalog part the instance was placed from says (through the injected port), for the cross-check; null fields are not checked. */
export interface DraftRequestCatalogFacts { partId: string; mpn: string | null; manufacturer: string | null; packageNormalized: string | null; pinCount: number | null }
export type DraftRequestCatalogCrossCheck =
  | { state: "checked"; partId: string; compared: string[] }
  | { state: "unavailable"; reason: string };

export interface DraftRequestBlocker { code: string; detail: string }

/** A fact the request documents, with the label of the source that documents it. */
export interface DocumentedFact { fact: string; value: string; source: string }

export interface CompiledPartDraftRequest {
  instance: UnresolvedInstance;
  /** The request in the publication path's own vocabulary (`AtomicPublicationSpec`); the person adds the symbol and footprint references at submission. */
  draftRequest: AtomicPublicationSpec;
  documented: DocumentedFact[];
  /** The facts the request lists as missing (its own words, bounded) plus the C.4 facts it did not document. */
  missing: string[];
  pcbAssignment: { blocked: boolean; blockers: string[] };
  catalogCrossCheck: DraftRequestCatalogCrossCheck;
}

export type DraftRequestCompilation = { ok: true; compiled: CompiledPartDraftRequest } | { ok: false; blockers: DraftRequestBlocker[] };

const text = (value: unknown, max = MAX_DRAFT_TEXT_CHARS): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "").trim();
  if (trimmed.length === 0) return null;
  const points = Array.from(trimmed);
  return points.length <= max ? trimmed : `${points.slice(0, max - 1).join("")}…`;
};
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const closed = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => record(value) && Object.keys(value).every((key) => keys.includes(key));
const norm = (value: string): string => value.normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * The pure compile: the request against the run's verified schematic (the instance must be one the editor's own list refuses) and,
 * when supplied, the catalog part the instance was placed from. All-or-nothing: any blocker refuses the whole request, listing
 * every blocker found. No I/O.
 */
export function compilePartDraftRequest(input: { args: Record<string, unknown>; unresolved: readonly UnresolvedInstance[]; catalog: DraftRequestCatalogFacts | null; catalogReason?: string }): DraftRequestCompilation {
  const blockers: DraftRequestBlocker[] = [];
  const block = (code: string, detail: string): void => { blockers.push({ code, detail: sanitizeTraceText(detail, 300) }); };
  const args = input.args as Partial<DraftRequestArgs>;
  // 1. the instance: one the editor's own refusal list names
  const refDes = text(args.refDes, 32);
  const instance = refDes ? input.unresolved.find((item) => item.refDes === refDes) ?? input.unresolved.find((item) => item.refDes.toUpperCase() === refDes.toUpperCase()) ?? null : null;
  if (!refDes) block("instance-missing", "refDes must name an unresolved instance of the verified schematic.");
  else if (!instance) block("instance-not-unresolved", `${refDes} is not an unresolved instance of the verified schematic (it carries a published exact revision and its symbol asset, or no such reference exists): nothing to draft.`);
  // 2. every documented fact carries its source label; a fact without one is refused, never kept as if documented
  const documented: DocumentedFact[] = [];
  const sourceOf = (fact: string, holder: unknown): string | null => {
    if (!record(holder)) return null;
    const source = text(holder.source);
    if (source === null) block("source-label-missing", `${fact} is given without a source label: each fact is given WITH the label of the document that states it, or listed as missing.`);
    return source;
  };
  // 3. identity: exact MPN and manufacturer are required (a draft is of one exact manufacturer part; C.2)
  let exactMpn: string | null = null;
  if (args.exactMpn !== undefined) {
    const value = closed(args.exactMpn, ["value", "source"]) ? text(args.exactMpn.value, 64) : null;
    const source = sourceOf("exact manufacturer part number", args.exactMpn);
    if (value === null) block("identity-malformed", "exactMpn.value must be a non-empty printable manufacturer part number (at most 64 characters).");
    else {
      try {
        exactMpn = canonicalExactMpn(value) ? value : null;
        if (exactMpn === null || !/^[!-~]([ -~]*[!-~])?$/.test(exactMpn)) { exactMpn = null; block("identity-malformed", "exactMpn.value must be printable ASCII as the manufacturer publishes it (every suffix character counts; an invisible or confusable character is refused, never folded)."); }
      } catch { exactMpn = null; block("identity-malformed", "exactMpn.value is not a canonical exact manufacturer part number."); }
    }
    if (exactMpn && source) documented.push({ fact: "exact manufacturer part number", value: exactMpn, source });
  }
  let manufacturer: AtomicPublicationSpec["manufacturer"] = null;
  if (args.manufacturer !== undefined) {
    const name = closed(args.manufacturer, ["name", "domains", "source"]) ? text(args.manufacturer.name) : null;
    const source = sourceOf("manufacturer", args.manufacturer);
    const domains = record(args.manufacturer) && args.manufacturer.domains !== undefined ? args.manufacturer.domains : [];
    if (name === null) block("identity-malformed", "manufacturer.name must be a non-empty name (at most 120 characters).");
    else if (!Array.isArray(domains) || domains.length > 8 || domains.some((domain) => typeof domain !== "string" || !DOMAIN.test(domain))) block("identity-malformed", "manufacturer.domains must be at most 8 lower-case official domain names.");
    else {
      manufacturer = { canonicalName: name, officialDomains: [...new Set(domains as string[])].sort() };
      if (source) documented.push({ fact: "manufacturer", value: name, source });
    }
  }
  const identityMissing = [...(exactMpn === null ? ["exact manufacturer part number"] : []), ...(manufacturer === null ? ["manufacturer"] : [])];
  if (identityMissing.length > 0 && !blockers.some((blocker) => blocker.code === "identity-malformed")) block("identity-missing", `A draft is of ONE exact manufacturer part: ${identityMissing.join(" and ")} must be documented first (search the catalog, then the admitted distributors for an exact identity; a vendor spelling is a hint, never proof).`);
  // 4. the pin table: required; unique pin numbers; a pad named by one pin only (pad numbering is a C.4 fact)
  const terminals: AtomicPublicationSpec["terminals"] = [];
  const rows = args.pinTable;
  if (rows === undefined || (Array.isArray(rows) && rows.length === 0)) block("pin-table-missing", "A documented pin table (number, name, function per pin, with its source) is required: a plausible image or a matching pin count is insufficient (C.4).");
  else if (!Array.isArray(rows) || rows.length > MAX_DRAFT_PIN_ROWS) block("pin-table-malformed", `pinTable must list 1 to ${MAX_DRAFT_PIN_ROWS} pins.`);
  else {
    const numbers = new Map<string, number>();
    const padOwners = new Map<string, string>();
    rows.forEach((row, index) => {
      if (!closed(row, ["number", "name", "function", "pads", "source"])) { block("pin-table-malformed", `pinTable[${index}] carries an unknown key or is not an object.`); return; }
      const number = text(row.number, 16);
      const fn = text(row.function, 64);
      const name = row.name === undefined ? null : text(row.name, 64);
      const source = sourceOf(`pin ${number ?? `#${index + 1}`}`, row);
      if (number === null || !TERMINAL_NUMBER.test(number)) { block("pin-table-malformed", `pinTable[${index}].number must be a pin number of 1 to 16 letters, digits, dot, underscore, plus or hyphen.`); return; }
      if (fn === null) { block("pin-table-malformed", `pin ${number}: function is required (the datasheet's pin function, at most 64 characters).`); return; }
      if (numbers.has(number)) { block("pin-table-conflict", `pin ${number} is listed twice (rows ${numbers.get(number)! + 1} and ${index + 1}): conflicting pin numbering.`); return; }
      numbers.set(number, index);
      const pads = row.pads === undefined ? [number] : row.pads;
      if (!Array.isArray(pads) || pads.length === 0 || pads.length > MAX_DRAFT_PADS_PER_PIN || pads.some((pad) => typeof pad !== "string" || !TERMINAL_NUMBER.test(pad))) { block("pin-table-malformed", `pin ${number}: pads must be 1 to ${MAX_DRAFT_PADS_PER_PIN} pad numbers.`); return; }
      for (const pad of pads as string[]) {
        const owner = padOwners.get(pad);
        if (owner !== undefined && owner !== number) block("pin-table-conflict", `pad ${pad} is mapped to pins ${owner} and ${number}: conflicting pad numbering.`);
        padOwners.set(pad, number);
      }
      terminals.push({ number, function: name ? `${name}: ${fn}` : fn, pads: [...new Set(pads as string[])] });
      if (source) documented.push({ fact: `pin ${number}`, value: `${name ?? "-"} / ${fn} / pads ${[...new Set(pads as string[])].join(",")}`, source });
    });
  }
  // 5. the package and geometry facts (C.4): each documented with its source, or missing
  let pkg: AtomicPublicationSpec["package"] = null;
  if (args.package !== undefined) {
    const code = closed(args.package, ["code", "mounting", "source"]) ? text(args.package.code, 64) : null;
    const mounting = record(args.package) ? args.package.mounting : undefined;
    const source = sourceOf("package variant", args.package);
    if (code === null || (mounting !== "smd" && mounting !== "through_hole")) block("package-malformed", "package must give the manufacturer's package code and its mounting (smd or through_hole).");
    else { pkg = { code, mounting }; if (source) documented.push({ fact: "package variant (code and mounting)", value: `${code}, ${mounting}`, source }); }
  }
  const geometry: Array<{ fact: string; given: boolean }> = [];
  const numberFact = (fact: string, holder: unknown, keys: readonly string[], read: (holder: Record<string, unknown>) => string | null): void => {
    if (holder === undefined) { geometry.push({ fact, given: false }); return; }
    const value = closed(holder, keys) ? read(holder) : null;
    const source = sourceOf(fact, holder);
    if (value === null) block("geometry-malformed", `${fact} must be a finite positive dimension in millimetres with its source.`);
    else { geometry.push({ fact, given: true }); if (source) documented.push({ fact, value, source }); }
  };
  const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value < 10_000;
  numberFact("pitch", args.pitchMm, ["value", "source"], (holder) => (positive(holder.value) ? `${holder.value} mm` : null));
  numberFact("body dimensions (courtyard)", args.bodyMm, ["x", "y", "source"], (holder) => (positive(holder.x) && positive(holder.y) ? `${holder.x} mm × ${holder.y} mm` : null));
  if (args.pin1Orientation === undefined) geometry.push({ fact: "pin-1 orientation", given: false });
  else {
    const value = closed(args.pin1Orientation, ["value", "source"]) ? text(args.pin1Orientation.value) : null;
    const source = sourceOf("pin-1 orientation", args.pin1Orientation);
    if (value === null) block("geometry-malformed", "pin1Orientation.value must describe where pin 1 sits and how it is marked.");
    else { geometry.push({ fact: "pin-1 orientation", given: true }); if (source) documented.push({ fact: "pin-1 orientation", value, source }); }
  }
  if (args.exposedPad === undefined) geometry.push({ fact: "exposed-pad mapping", given: false });
  else {
    const pads = closed(args.exposedPad, ["pads", "source"]) ? args.exposedPad.pads : undefined;
    const source = sourceOf("exposed-pad mapping", args.exposedPad);
    if (!Array.isArray(pads) || pads.length > MAX_DRAFT_PADS_PER_PIN || pads.some((pad) => typeof pad !== "string" || !TERMINAL_NUMBER.test(pad))) block("geometry-malformed", `exposedPad.pads must list the exposed pad's pad numbers (an empty list documents that there is none).`);
    else { geometry.push({ fact: "exposed-pad mapping", given: true }); if (source) documented.push({ fact: "exposed-pad mapping", value: pads.length === 0 ? "none" : (pads as string[]).join(","), source }); }
  }
  let datasheet: AtomicPublicationSpec["datasheet"] = null;
  if (args.datasheet !== undefined) {
    const locator = closed(args.datasheet, ["locator", "source"]) ? text(args.datasheet.locator, 300) : null;
    const source = sourceOf("datasheet citation", args.datasheet);
    if (locator === null) block("datasheet-malformed", "datasheet.locator must cite the document revision and section (at most 300 characters); a link is never carried here.");
    else { datasheet = { url: null, locator }; if (source) documented.push({ fact: "datasheet citation", value: locator, source }); }
  }
  // 6. the facts the request itself lists as missing; a fact both given and listed missing is a conflict
  const listedMissing: string[] = [];
  if (args.missing !== undefined) {
    if (!Array.isArray(args.missing) || args.missing.length > MAX_DRAFT_MISSING_ENTRIES) block("missing-malformed", `missing must list at most ${MAX_DRAFT_MISSING_ENTRIES} facts.`);
    else for (const entry of args.missing) { const words = text(entry); if (words === null) block("missing-malformed", "missing entries must be non-empty text."); else listedMissing.push(words); }
  }
  for (const entry of listedMissing) {
    const given = documented.find((fact) => norm(entry).includes(norm(fact.fact)) || norm(fact.fact).includes(norm(entry)));
    if (given) block("fact-conflict", `"${entry}" is listed as missing while "${given.fact}" is documented (${given.source}): conflicting facts; keep one.`);
  }
  // 7. the catalog cross-check (C.5: a different part is never substituted silently) - only with the port; absent, recorded as not checked
  const compared: string[] = [];
  const catalog = input.catalog;
  if (catalog) {
    if (catalog.mpn && exactMpn) { compared.push("exact MPN"); if (norm(catalog.mpn) !== norm(exactMpn)) block("identity-conflict", `the request names MPN ${exactMpn} but the placed catalog part (${catalog.partId}) names ${catalog.mpn}: a different part is never substituted silently - request the draft for the placed part, or re-place the instance first.`); }
    if (catalog.manufacturer && manufacturer) { compared.push("manufacturer"); if (norm(catalog.manufacturer) !== norm(manufacturer.canonicalName)) block("identity-conflict", `the request names manufacturer ${manufacturer.canonicalName} but the placed catalog part names ${catalog.manufacturer}: conflicting identity facts.`); }
    if (catalog.packageNormalized && pkg) { compared.push("package"); if (norm(catalog.packageNormalized) !== norm(pkg.code) && !norm(pkg.code).includes(norm(catalog.packageNormalized)) && !norm(catalog.packageNormalized).includes(norm(pkg.code))) block("incompatible-package", `the request documents package ${pkg.code} but the placed catalog part is ${catalog.packageNormalized}: an incompatible package blocks the draft (a package variant is never guessed).`); }
    if (catalog.pinCount !== null && catalog.pinCount > 0 && terminals.length > 0) { compared.push("pin count"); if (catalog.pinCount !== terminals.length) block("pin-count-conflict", `the pin table lists ${terminals.length} pins but the placed catalog part's symbol has ${catalog.pinCount}: conflicting pin evidence (a matching count would still not be a mapping).`); }
  }
  // 8. the profile: pcb_assignable only when every C.4 fact is documented; the default is what the facts reach
  const pcbBlockers = [...(pkg === null ? [PCB_ASSIGNMENT_BLOCKING_FACTS[0]] : []), ...(terminals.length === 0 ? [PCB_ASSIGNMENT_BLOCKING_FACTS[1]] : []), ...geometry.filter((entry) => !entry.given).map((entry) => PCB_ASSIGNMENT_BLOCKING_FACTS.find((fact) => fact.startsWith(entry.fact)) ?? entry.fact)];
  const requestedProfile = args.profile;
  if (requestedProfile !== undefined && !(IMPORT_REVIEW_PROFILES as readonly string[]).includes(requestedProfile)) block("profile-malformed", `profile must be one of ${IMPORT_REVIEW_PROFILES.join(", ")}.`);
  else if (requestedProfile === "pcb_assignable" && pcbBlockers.length > 0) block("pcb-assignable-blocked", `the pcb_assignable profile needs every package fact documented; missing: ${pcbBlockers.join("; ")} - these BLOCK PCB assignment (C.4). Request schematic_only, or document them with their sources.`);
  if (blockers.length > 0) return { ok: false, blockers };
  const profile: ImportReviewProfile = requestedProfile ?? (pcbBlockers.length === 0 ? "pcb_assignable" : "schematic_only");
  const draftRequest: AtomicPublicationSpec = { exactMpn: exactMpn!, profile, symbol: null, footprint: null, terminals, package: pkg, datasheet, manufacturer };
  const missing = [...new Set([...listedMissing, ...pcbBlockers.map((fact) => `${fact} - not documented; blocks PCB assignment`), "symbol and footprint references into the bundled KiCad library: the person picks them at submission (never the model)"])];
  return {
    ok: true,
    compiled: {
      instance: instance!,
      draftRequest,
      documented,
      missing,
      pcbAssignment: { blocked: pcbBlockers.length > 0 || profile !== "pcb_assignable", blockers: pcbBlockers.length > 0 ? [...pcbBlockers] : ["deterministic mapping checks and the human review and publication have not run: a draft is not PCB-assignable until they pass"] },
      catalogCrossCheck: catalog ? { state: "checked", partId: catalog.partId, compared } : { state: "unavailable", reason: input.catalogReason ?? "catalog unavailable: the placed part was not cross-checked (no catalog port is bound to this run)" },
    },
  };
}

// ─── The sealed artifact ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The sealed draft request. Receiving or displaying one mutates NOTHING and grants nothing. It binds, under one whole-body identity
 * digest: the tool, the scope, the authorization binding (verified principal + membership revision), the base schematic digest (the
 * sheet whose unresolved instance it names), the instance row, the request in the publication path's vocabulary, the documented and
 * missing facts, the PCB-assignment blockers, the catalog cross-check, actor, effective actor, provenance, creation and expiry.
 */
export interface SealedPartDraftRequest {
  schema: typeof DRAFT_REQUEST_SCHEMA;
  proposalId: string;
  toolId: typeof DRAFT_REQUEST_TOOL_ID;
  version: string;
  /** The tier-1 scope contract: tenant / project / branch and the editor's canonical head mark at sealing (the loop's B09.1 gate for every schematic proposal). */
  scope: Tier1ProposalScope;
  authorization: SchematicProposalAuthorizationBinding;
  /** `schematicStateDigest` of the validated sheet the unresolved instance belongs to. */
  baseSchematicDigest: string;
  verification: typeof DRAFT_REQUEST_VERIFICATION;
  instance: UnresolvedInstance;
  draftRequest: AtomicPublicationSpec;
  documented: DocumentedFact[];
  missing: string[];
  pcbAssignment: { blocked: boolean; blockers: string[] };
  catalogCrossCheck: DraftRequestCatalogCrossCheck;
  /** The human path and what it decides; the artifact itself decides nothing. */
  reviewTask: { path: string; submitter: string; decides: string; neverClaims: string };
  /** Digest over the base and the request; the trace records it as the proposal's operations digest. */
  requestDigest: string;
  actor: { actorId: string; kind: "ai" };
  effectiveActor: { actorId: string; kind: "human" | "worker" };
  provenance: { provider: string; runId: string; note: string; instruction: string };
  createdAt: number;
  expiresAt: number;
}

const IDENTITY_DIGEST_SCHEMA = "sirkit.part-draft-request-id.v1";
const REQUEST_DIGEST_SCHEMA = "sirkit.part-draft-request-body.v1";
const PROPOSAL_KEYS = Object.freeze(["schema", "proposalId", "toolId", "version", "scope", "authorization", "baseSchematicDigest", "verification", "instance", "draftRequest", "documented", "missing", "pcbAssignment", "catalogCrossCheck", "reviewTask", "requestDigest", "actor", "effectiveActor", "provenance", "createdAt", "expiresAt"] as const);
const SPEC_KEYS = Object.freeze(["exactMpn", "profile", "symbol", "footprint", "terminals", "package", "datasheet", "manufacturer"] as const);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function draftRequestDigest(baseSchematicDigest: string, draftRequest: AtomicPublicationSpec): string {
  return engineeringDigest({ schema: REQUEST_DIGEST_SCHEMA, base: baseSchematicDigest, draftRequest });
}

export type DraftRequestVerification = { ok: true } | { ok: false; code: "malformed" | "wrong-version" | "altered"; detail: string };

/** INTEGRITY-ONLY verification (an intake runs it first): schema, exact shape, both sealed digests, no claim of verification. */
export function verifySealedPartDraftRequestIntegrity(candidate: unknown): DraftRequestVerification {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return { ok: false, code: "malformed", detail: "The draft request is not an object." };
  const proposal = candidate as Record<string, unknown>;
  if (proposal.schema !== DRAFT_REQUEST_SCHEMA) return { ok: false, code: "wrong-version", detail: "The artifact is not a sirkit.part-draft-request.v1 artifact." };
  if (Object.keys(proposal).sort().join(",") !== [...PROPOSAL_KEYS].sort().join(",")) return { ok: false, code: "malformed", detail: "The draft request does not carry exactly the sealed key set." };
  if (proposal.toolId !== DRAFT_REQUEST_TOOL_ID || proposal.verification !== DRAFT_REQUEST_VERIFICATION) return { ok: false, code: "malformed", detail: "The artifact names another tool, or claims a verification a draft request can never have." };
  const scope = proposal.scope as Record<string, unknown> | null;
  if (!record(scope) || typeof scope.tenantId !== "string" || typeof scope.projectId !== "string" || typeof scope.branchId !== "string" || validateSchematicCanonicalMark(scope.headMark) === null) return { ok: false, code: "malformed", detail: "The scope or its canonical head mark is malformed." };
  if (!isWellFormedAuthorizationBinding(proposal.authorization) || proposal.authorization.tenantId !== scope.tenantId || proposal.authorization.projectId !== scope.projectId || proposal.authorization.branchId !== scope.branchId) return { ok: false, code: "malformed", detail: "The authorization binding is malformed or does not agree with the sealed scope." };
  const spec = proposal.draftRequest as Record<string, unknown> | null;
  if (!record(spec) || Object.keys(spec).sort().join(",") !== [...SPEC_KEYS].sort().join(",") || spec.symbol !== null || spec.footprint !== null || !Array.isArray(spec.terminals) || spec.terminals.length === 0) return { ok: false, code: "malformed", detail: "The draft request is not a publication spec with a pin table and no asset reference." };
  if (typeof proposal.baseSchematicDigest !== "string" || typeof proposal.requestDigest !== "string" || typeof proposal.proposalId !== "string") return { ok: false, code: "malformed", detail: "A sealed digest is missing." };
  if (draftRequestDigest(proposal.baseSchematicDigest, spec as unknown as AtomicPublicationSpec) !== proposal.requestDigest) return { ok: false, code: "altered", detail: "The request digest does not match the sealed request." };
  const { proposalId, ...body } = proposal;
  if (`draftreq-${engineeringDigest({ schema: IDENTITY_DIGEST_SCHEMA, body }).slice(5)}` !== proposalId) return { ok: false, code: "altered", detail: "The artifact body does not match its sealed identity." };
  return { ok: true };
}

/** Seal a compiled request. Pure; the caller supplied every server-derived fact. */
export function sealPartDraftRequest(input: { compiled: CompiledPartDraftRequest; provider: string; runId: string; context: AgentRunContext; headMark: Tier1ProposalScope["headMark"]; descriptor: Pick<ToolDescriptor, "version">; instruction: string; now: number }): SealedPartDraftRequest {
  const { context, compiled } = input;
  const baseSchematicDigest = context.schematicDigest!;
  const body = {
    schema: DRAFT_REQUEST_SCHEMA,
    toolId: DRAFT_REQUEST_TOOL_ID,
    version: input.descriptor.version,
    scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, headMark: { ...input.headMark } },
    authorization: buildAuthorizationBinding({ principalId: context.actor.actorId, ...(context.actor.membershipRevision ? { membershipRevision: context.actor.membershipRevision } : {}), scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId } }),
    baseSchematicDigest,
    verification: DRAFT_REQUEST_VERIFICATION,
    instance: { ...compiled.instance },
    draftRequest: structuredClone(compiled.draftRequest),
    documented: compiled.documented.map((fact) => ({ ...fact })),
    missing: [...compiled.missing],
    pcbAssignment: { blocked: compiled.pcbAssignment.blocked, blockers: [...compiled.pcbAssignment.blockers] },
    catalogCrossCheck: structuredClone(compiled.catalogCrossCheck),
    reviewTask: {
      path: DRAFT_REQUEST_HUMAN_PATH,
      submitter: "a human member of the catalog governance project (pcb_editor, reviewer or project_admin); the assistant cannot file it",
      decides: "the server normalizes the request and assembles the UNVERIFIED draft; a reviewer approves or rejects; a different administrator publishes; the deterministic mapping and profile checks decide PCB assignability",
      neverClaims: "no mapping certificate, no approval, no publication, no PCB assignment: this artifact is a review task",
    },
    requestDigest: draftRequestDigest(baseSchematicDigest, compiled.draftRequest),
    actor: { actorId: `agent:${input.provider}`, kind: "ai" as const },
    effectiveActor: { actorId: context.actor.actorId, kind: (context.actor.source === "verified-worker" ? "worker" : "human") as "human" | "worker" },
    provenance: { provider: input.provider, runId: input.runId, note: "AI-assembled UNVERIFIED draft request from the documented facts it carries, proposed for a human to file; nothing applied, nothing published", instruction: sanitizeTraceText(input.instruction, 300) },
    createdAt: input.now,
    expiresAt: input.now + DRAFT_REQUEST_TTL_MS,
  };
  return deepFreeze({ ...body, proposalId: `draftreq-${engineeringDigest({ schema: IDENTITY_DIGEST_SCHEMA, body }).slice(5)}` });
}

// ─── Binding resolution ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type DraftRequestBindingResolution = { state: "resolved" } | { state: "not_callable"; reason: string };

/** Allowlist-only: the descriptor is callable here only as the one draft request over this module's pure compile. */
export function resolveDraftRequestBinding(descriptor: ToolDescriptor): DraftRequestBindingResolution {
  if (descriptor.toolId !== DRAFT_REQUEST_TOOL_ID) return { state: "not_callable", reason: "Only the draft request proposal is invocable here." };
  if (descriptor.operationClass !== "propose" || descriptor.sideEffects !== "proposal-artifact" || descriptor.approvalTier !== "none") return { state: "not_callable", reason: "The draft request is a sealed proposal artifact (propose class, proposal-artifact side effects, no approval tier of its own)." };
  if (descriptor.binding.status !== "bound-proposal" || descriptor.binding.module !== DRAFT_REQUEST_BINDING.module || descriptor.binding.symbol !== DRAFT_REQUEST_BINDING.symbol) return { state: "not_callable", reason: "The descriptor does not bind the one draft request compile." };
  return { state: "resolved" };
}

// ─── The service ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PartDraftRequestProposalServiceOptions {
  /** The catalog port the chat route injects for the catalog inspection (the SAME port); absent: the cross-check is recorded unavailable. */
  port?: CatalogPartInspectionPort;
  /** The gateway's context integrity check (injected so this module never imports the gateway). */
  integrity: (context: AgentRunContext) => readonly string[];
  now?: () => number;
}
export interface PartDraftRequestProposalInput { toolId: string; version: string; args: Record<string, unknown>; context: AgentRunContext; runId: string; provider: string; timeoutMs: number; signal?: AbortSignal }

class CatalogTimeout { readonly kind = "timeout"; }

export class PartDraftRequestProposalService {
  constructor(private readonly registry: ToolRegistry, private readonly options: PartDraftRequestProposalServiceOptions) {}

  async invoke(input: PartDraftRequestProposalInput): Promise<GatewayInvocationOutcome> {
    const refuse = (status: string, diagnostics: string[]): GatewayInvocationOutcome => ({ kind: "refused", ok: false, toolId: input.toolId, version: input.version, status, diagnostics });
    const descriptor = this.registry.get(input.toolId, input.version);
    if (!descriptor) return refuse("not_registered", ["Unknown tool."]);
    const resolution = resolveDraftRequestBinding(descriptor);
    if (resolution.state !== "resolved") return refuse("not_callable", [resolution.reason]);
    const integrity = this.options.integrity(input.context);
    if (integrity.length > 0) return refuse("context_integrity", integrity.slice(0, 5));
    const context = input.context;
    if (!context.schematic || !context.schematicDigest) return refuse("authority_unavailable", ["No verified schematic snapshot is available for this run; the draft request is unavailable."]);
    // The scope anchor: the editor's canonical head mark (the loop's B09.1 gate for every schematic proposal; discovery requires the lineage).
    const headMark = context.schematicHeadMark ? validateSchematicCanonicalMark(context.schematicHeadMark) : null;
    if (!headMark) return refuse("authority_unavailable", ["No canonical schematic head mark is available for this run; the draft request is unavailable until the editor session is ready."]);
    const discovery = discoverTools(this.registry, context.discovery);
    if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
      const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
      return refuse("not_discoverable", [`Tool is not discoverable in the current context (${reason}).`]);
    }
    if (!descriptor.requiredRoles.includes(context.actor.actorRole) || !context.actor.grantedCapabilities.includes(descriptor.requiredCapability)) {
      return refuse("unauthorized", [`Role ${context.actor.actorRole} / capability ${descriptor.requiredCapability} is not permitted for this tool.`]);
    }
    // The closed argument surface: the request's keys only; authority-shaped keys and KiCad asset references are refused by name.
    const safety = assertSafeJsonValue(input.args, DEFAULT_INPUT_LIMITS, "args");
    if (safety.length > 0) return refuse("invalid_input", safety.slice(0, 5));
    for (const key of Object.keys(input.args)) {
      if ((REQUEST_KEYS as readonly string[]).includes(key)) continue;
      return refuse("invalid_input", [AUTHORITY_KEYS.has(key) ? `Argument "${key.slice(0, 40)}" is an authority-shaped claim (or a KiCad asset reference the person picks at submission) - the draft request accepts only ${REQUEST_KEYS.join(", ")}.` : `Unexpected argument "${key.slice(0, 40)}" - the draft request accepts only ${REQUEST_KEYS.join(", ")}.`]);
    }
    if (typeof input.args.refDes !== "string" || input.args.refDes.trim().length === 0) return refuse("invalid_input", ["refDes must name the unresolved instance the draft is for."]);
    if (input.signal?.aborted) return refuse("cancelled", ["The run was cancelled before the draft request was compiled; nothing was changed."]);
    const unresolved = listUnresolvedInstances(context.schematic);
    // The optional catalog cross-check: the placed part's identity through the SAME injected port, only with the server's fact.
    let catalog: DraftRequestCatalogFacts | null = null;
    let catalogReason = "catalog unavailable: no catalog port is bound to this run, so the placed part was not cross-checked";
    const port = this.options.port;
    const refDes = typeof input.args.refDes === "string" ? input.args.refDes.trim() : "";
    const placed = (context.schematic.kicadComponents ?? []).find((component) => component.refDes === refDes || component.refDes.toUpperCase() === refDes.toUpperCase());
    if (port && context.catalogInspectionAvailable === true && placed && unresolved.some((item) => item.refDes === placed.refDes)) {
      const timeoutMs = Math.max(1, Math.min(Math.floor(input.timeoutMs), descriptor.timeoutMs) - DRAFT_REQUEST_CATALOG_MARGIN_MS);
      const controller = new AbortController();
      const onAbort = (): void => controller.abort();
      input.signal?.addEventListener("abort", onAbort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const work = Promise.resolve().then(() => port.inspect({ partId: placed.partId, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId }, runId: input.runId, deadlineMs: timeoutMs, signal: controller.signal }));
        work.catch(() => undefined);
        const answer = await Promise.race<CatalogPartInspectionPortAnswer | CatalogTimeout>([work, new Promise<CatalogTimeout>((resolve) => { timer = setTimeout(() => { resolve(new CatalogTimeout()); controller.abort(); }, timeoutMs); })]);
        if (answer instanceof CatalogTimeout) catalogReason = "catalog unavailable: the catalog read exceeded the call's deadline; the placed part was not cross-checked";
        else if (answer.state === "found") catalog = { partId: placed.partId, mpn: answer.detail.mpn ?? null, manufacturer: answer.detail.manufacturer ?? null, packageNormalized: answer.detail.packageNormalized ?? null, pinCount: Array.isArray(answer.detail.pins) ? answer.detail.pins.length : null };
        else if (answer.state === "not_found") catalogReason = "no catalog part has the placed part id: the identity was not cross-checked";
        else catalogReason = "catalog unavailable: the catalog read failed; the placed part was not cross-checked";
      } catch {
        catalogReason = "catalog unavailable: the catalog read failed; the placed part was not cross-checked";
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
      }
      if (input.signal?.aborted) return refuse("cancelled", ["The run was cancelled while the placed part was read; nothing was changed."]);
    }
    let compilation: DraftRequestCompilation;
    try {
      compilation = compilePartDraftRequest({ args: input.args, unresolved, catalog, catalogReason });
    } catch (error) {
      return refuse("implementation_failed", [`The draft request failed internally: ${sanitizeTraceText(error instanceof Error ? error.message : String(error), 200) || "unknown error"}. Nothing was changed.`]);
    }
    if (!compilation.ok) return { kind: "proposal-blocked", ok: false, toolId: input.toolId, version: input.version, blockers: compilation.blockers };
    const now = this.options.now ? this.options.now() : Date.now();
    const instruction = typeof input.args.refDes === "string" ? `draft request for ${input.args.refDes}` : "draft request";
    return { kind: "draft-request-proposal", ok: true, toolId: input.toolId, version: input.version, proposal: sealPartDraftRequest({ compiled: compilation.compiled, provider: input.provider, runId: input.runId, context, headMark, descriptor, instruction, now }) };
  }
}
