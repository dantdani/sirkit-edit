/**
 * [PR-M, 2026-10-18] Section M2 (runbook M.3 item 4, design M2.3): the PURE validation of an acquired symbol + footprint (+ pin table)
 * against the target it was retrieved for. Given the production parsers' assets (`parseSymbolAssets` / `parseFootprintAsset`, run by the
 * pipeline under their hostile-input limits) it checks, and reports - never guesses:
 *
 *  - the symbol and the footprint parsed `valid` or `valid_with_limitations` (anything else: `unsupported`);
 *  - package code and mounting against the footprint (a stated package the footprint does not carry is a conflict; no stated package is
 *    an unresolved fact);
 *  - pin 1 and pad 1 exist;
 *  - every electrical symbol pin has a pad of the same number, and every electrical pad a pin (an extra pad - an exposed or thermal pad
 *    - is UNRESOLVED: only a datasheet fact may say what it is);
 *  - a pin table (an admitted source's datasheet text) against the symbol: each row's pin exists, its function is the pin's name (K /
 *    cathode, A / anode, ...), its pads exist; a disagreement is a CONFLICT. Without a table the KiCad convention (pin n = pad n) is
 *    OFFERED for a person to confirm - it is recorded as an unresolved fact, not a proof;
 *  - a DRY-RUN `buildMappingCertificate` over that table in a scratch identity: report data only, never a certificate;
 *  - the identity: EXACT only with real evidence (a manufacturer datasheet naming the part, or a distributor exact-MPN observation);
 *    otherwise the candidate is a GENERIC KiCad library candidate and says so.
 *
 * Verdict `validated` | `conflicting` | `unsupported`, with a SHA-256 digest of the canonical report.
 */
import { buildMappingCertificate, provePackage } from "../atomic/mapping";
import { canonicalJson, sha256 } from "../atomic/stable";
import type { FootprintAssetVersion, ManufacturerTerminal, SymbolAssetVersion } from "../atomic/types";

export const CAD_VALIDATION_SCHEMA = "sirkit.cad-validation-report.v1" as const;
export const CAD_VALIDATION_VERSION = "sirkit.cad-validation/1" as const;

export type CadValidationVerdict = "validated" | "conflicting" | "unsupported";
export type CadCheckStatus = "pass" | "fail" | "unresolved" | "not-applicable";

export interface CadValidationTable {
  /** "datasheet": an admitted source's pin table; "symbol-convention": KiCad's pin n = pad n, offered for confirmation */
  origin: "datasheet" | "symbol-convention";
  /** the part the table says it is for (a datasheet only) */
  part: string | null;
  /** the table's source class (a fixture table is organization_authored, never a manufacturer datasheet) */
  sourceClass: string | null;
  fixture: boolean;
  packageCode: string | null;
  mounting: "smd" | "through_hole" | null;
  rows: ReadonlyArray<{ number: string; function: string; pads: readonly string[] }>;
}

export interface CadValidationInput {
  target: { exactMpn: string | null; packageCode: string | null; mounting: "smd" | "through_hole" | null; symbol: string; footprint: string | null };
  symbol: SymbolAssetVersion | null;
  footprint: FootprintAssetVersion | null;
  /** parser refusals (a hostile or malformed asset), as closed sentences */
  parseFailures: readonly string[];
  table: CadValidationTable | null;
  /** real identity evidence the pipeline found (never inferred from a name) */
  identityEvidence: { distributorExactMpn: boolean; manufacturerDatasheet: boolean };
}

export interface CadValidationCheck { id: string; status: CadCheckStatus; detail: string }
export interface CadValidationReport {
  schema: typeof CAD_VALIDATION_SCHEMA;
  validator: typeof CAD_VALIDATION_VERSION;
  verdict: CadValidationVerdict;
  target: CadValidationInput["target"];
  identity: { kind: "exact" | "generic"; exactMpn: string | null; basis: string };
  checks: CadValidationCheck[];
  /** the mapping the table (or the convention) states, pin by pin */
  mapping: Array<{ number: string; function: string; pinName: string | null; pads: string[]; origin: CadValidationTable["origin"] }>;
  /** report data only, never a certificate */
  dryRunCertificate: { state: string | null; issues: string[] };
  unresolved: string[];
  conflicts: string[];
  limitations: string[];
  digest: string;
}

const FUNCTION_ALIASES: Readonly<Record<string, string>> = Object.freeze({ k: "cathode", cathode: "cathode", kathode: "cathode", a: "anode", anode: "anode", g: "gate", gate: "gate", d: "drain", drain: "drain", s: "source", source: "source", b: "base", base: "base", c: "collector", collector: "collector", e: "emitter", emitter: "emitter", gnd: "ground", vss: "ground", ground: "ground", vcc: "supply", vdd: "supply" });
const norm = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
const fnKey = (value: string): string => FUNCTION_ALIASES[norm(value)] ?? norm(value);
const pkgNorm = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]+/g, "");

/** Whether a footprint name carries a package code (a name token, or the normalized name containing it). */
export function footprintCarriesPackage(footprintName: string, packageCode: string): boolean {
  const wanted = pkgNorm(packageCode);
  if (!wanted) return false;
  return footprintName.split(/[_\s]+/).some((token) => pkgNorm(token) === wanted) || pkgNorm(footprintName).includes(wanted);
}

const ELECTRICAL_EXEMPT_TYPES = new Set(["no_connect", "unconnected"]);

/** Validate; deterministic over its input. */
export function validateAcquiredAssets(input: CadValidationInput): CadValidationReport {
  const checks: CadValidationCheck[] = [];
  const unresolved: string[] = [];
  const conflicts: string[] = [];
  const limitations: string[] = [];
  const check = (id: string, status: CadCheckStatus, detail: string): void => {
    checks.push({ id, status, detail });
    if (status === "fail") conflicts.push(detail);
    if (status === "unresolved") unresolved.push(detail);
  };
  const { symbol, footprint, target } = input;
  for (const failure of input.parseFailures) check("parse", "fail", failure);
  const symbolUsable = Boolean(symbol) && (symbol!.validationState === "valid" || symbol!.validationState === "valid_with_limitations");
  check("symbol-parsed", symbolUsable ? "pass" : "fail", symbol ? `symbol ${target.symbol} parsed ${symbol.validationState}${symbol.diagnostics.length ? ` (${symbol.diagnostics.slice(0, 3).map((item) => item.code).join(", ")})` : ""}` : `symbol ${target.symbol} was not parsed`);
  const footprintUsable = Boolean(footprint) && (footprint!.validationState === "valid" || footprint!.validationState === "valid_with_limitations");
  if (target.footprint === null) check("footprint-parsed", "unresolved", "no footprint was named for the target: the candidate can be schematic-only at most");
  else check("footprint-parsed", footprintUsable ? "pass" : "fail", footprint ? `footprint ${target.footprint} parsed ${footprint.validationState}` : `footprint ${target.footprint} was not parsed`);
  if (footprint?.validationState === "valid_with_limitations") limitations.push(...footprint.diagnostics.filter((item) => item.severity === "warning").slice(0, 8).map((item) => item.message));
  if (footprint?.modelReferences.some((model) => model.state === "blocked")) limitations.push("a 3D model reference was refused by the model path policy");
  if (footprint?.modelReferences.length) limitations.push("3D model references are recorded but not retrieved (K.6, OD-M2-7); visualization is optional and does not block an electrical replacement");

  const unsupported = !symbolUsable || (target.footprint !== null && !footprintUsable) || input.parseFailures.length > 0;
  const tableRows = input.table?.rows ?? [];
  const mapping: CadValidationReport["mapping"] = [];
  let dryRun: CadValidationReport["dryRunCertificate"] = { state: null, issues: ["not evaluated: the assets are not usable"] };

  if (!unsupported && symbol) {
    const pins = symbol.pins.filter((pin) => pin.number && !ELECTRICAL_EXEMPT_TYPES.has(String(pin.electricalType)));
    const pinNumbers = new Set(pins.map((pin) => pin.number));
    check("pin-1", pinNumbers.has("1") ? "pass" : "fail", pinNumbers.has("1") ? "symbol pin 1 exists" : "the symbol has no pin 1");
    if (footprint) {
      const pads = footprint.pads.filter((pad) => !pad.mechanical);
      const padNumbers = new Set(pads.map((pad) => pad.number));
      check("pad-1", padNumbers.has("1") ? "pass" : "fail", padNumbers.has("1") ? "footprint pad 1 exists" : "the footprint has no electrical pad 1");
      const pinWithoutPad = [...pinNumbers].filter((number) => !padNumbers.has(number) && !tableRows.some((row) => row.number === number && row.pads.every((pad) => padNumbers.has(pad))));
      check("pins-have-pads", pinWithoutPad.length === 0 ? "pass" : "fail", pinWithoutPad.length === 0 ? `every electrical symbol pin (${[...pinNumbers].sort().join(", ")}) has a pad` : `symbol pin(s) ${pinWithoutPad.sort().join(", ")} have no pad of that number`);
      const tablePads = new Set(tableRows.flatMap((row) => row.pads));
      const extraPads = [...padNumbers].filter((number) => !pinNumbers.has(number) && !tablePads.has(number));
      check("pads-have-pins", extraPads.length === 0 ? "pass" : "unresolved", extraPads.length === 0 ? "every electrical pad is a symbol pin" : `electrical pad(s) ${extraPads.sort().join(", ")} are not symbol pins: an exposed or thermal pad needs a datasheet fact (never assumed)`);
      // package and mounting
      const statedPackage = target.packageCode ?? input.table?.packageCode ?? null;
      if (statedPackage === null) check("package", "unresolved", `no package was stated for the target; the footprint is ${footprint.footprintName}`);
      else check("package", footprintCarriesPackage(footprint.footprintName, statedPackage) ? "pass" : "fail", footprintCarriesPackage(footprint.footprintName, statedPackage) ? `footprint ${footprint.footprintName} is package ${statedPackage}` : `the stated package ${statedPackage} is not footprint ${footprint.footprintName}`);
      const statedMounting = target.mounting ?? input.table?.mounting ?? null;
      if (statedMounting === null) check("mounting", "unresolved", `no mounting was stated; the footprint is ${footprint.mountingTechnology}`);
      else check("mounting", footprint.mountingTechnology === statedMounting ? "pass" : "fail", footprint.mountingTechnology === statedMounting ? `mounting ${statedMounting}` : `the stated mounting ${statedMounting} is not the footprint's ${footprint.mountingTechnology}`);
    }
    // the table against the symbol
    const rows = input.table ? tableRows : [...pinNumbers].sort().map((number) => ({ number, function: symbol.pins.find((pin) => pin.number === number)?.name ?? number, pads: [number] }));
    const origin: CadValidationTable["origin"] = input.table?.origin ?? "symbol-convention";
    for (const row of rows) {
      const pin = symbol.pins.find((candidate) => candidate.number === row.number) ?? null;
      mapping.push({ number: row.number, function: row.function, pinName: pin?.name ?? null, pads: [...row.pads], origin });
      if (!input.table) continue;
      if (!pin) { check(`table-pin-${row.number}`, "fail", `the pin table names pin ${row.number}, which the symbol does not have`); continue; }
      const same = fnKey(row.function) === fnKey(pin.name);
      check(`table-pin-${row.number}`, same ? "pass" : "fail", same ? `pin ${row.number}: ${row.function} is the symbol's ${pin.name}` : `pin ${row.number}: the table says ${row.function}, the symbol says ${pin.name}`);
      if (footprint) for (const pad of row.pads) if (!footprint.pads.some((candidate) => !candidate.mechanical && candidate.number === pad)) check(`table-pad-${row.number}-${pad}`, "fail", `pin ${row.number}: the table names pad ${pad}, which the footprint does not have`);
    }
    if (input.table) {
      const missing = [...pinNumbers].filter((number) => !tableRows.some((row) => row.number === number));
      if (missing.length > 0) check("table-covers-pins", "unresolved", `the pin table does not state pin(s) ${missing.sort().join(", ")}`);
      if (input.table.part && target.exactMpn && norm(input.table.part) !== norm(target.exactMpn)) check("table-part", "fail", `the pin table is for ${input.table.part}, not ${target.exactMpn}`);
    } else {
      check("terminal-table", "unresolved", "no permitted datasheet source delivered a pin table: the KiCad library convention (pin n = pad n, pin names from the official symbol) is OFFERED for a person to confirm against a datasheet - it is not a proof");
    }
    if (footprint) {
      try {
        const terminals: ManufacturerTerminal[] = rows.map((row) => ({ id: `scratch_terminal_${row.number}`, publishedIdentifier: row.number, function: row.function, classification: "electrical", evidenceIds: ["scratch_evidence"] }));
        // the package proof the publication would build from the stated package (authoring.ts's rule): pad count and mounting checked
        const statedPackage = target.packageCode ?? input.table?.packageCode ?? null;
        const statedMounting = target.mounting ?? input.table?.mounting ?? null;
        const electricalPadCount = new Set(footprint.pads.filter((pad) => !pad.mechanical).map((pad) => pad.number)).size;
        const packageProof = provePackage({ exactPartId: "scratch_exact_part", footprintVersionId: footprint.versionId, ...(statedPackage && statedMounting ? { packageCode: statedPackage, mountingTechnology: statedMounting } : {}), pinCount: electricalPadCount, evidenceIds: ["scratch_evidence"], checks: [{ field: "pinCount", expected: electricalPadCount, actual: new Set(rows.flatMap((row) => row.pads)).size }, ...(statedMounting ? [{ field: "mountingTechnology", expected: statedMounting, actual: footprint.mountingTechnology }] : [])] });
        const certificate = buildMappingCertificate({ exactPartId: "scratch_exact_part", symbol, footprint, terminals, mapping: rows.map((row) => ({ manufacturerTerminalId: `scratch_terminal_${row.number}`, symbolPinNumbers: [row.number], logicalPadNumbers: [...row.pads], evidenceIds: ["scratch_evidence"] })), packageProof, evidenceIds: ["scratch_evidence"] });
        dryRun = { state: certificate.state, issues: [...certificate.ambiguous, ...certificate.missingPadNumbers.map((pad) => `pad ${pad} is not mapped`), ...certificate.extraElectricalPadNumbers.map((pad) => `electrical pad ${pad} is extra`)].slice(0, 10) };
      } catch (error) {
        dryRun = { state: null, issues: [error instanceof Error ? error.message.slice(0, 200) : "the dry run could not be built"] };
      }
      if (dryRun.state !== "approved") check("dry-run-mapping", dryRun.state === null ? "fail" : "unresolved", `a dry-run mapping over the ${origin === "datasheet" ? "pin table" : "KiCad convention"} is ${dryRun.state ?? "not buildable"}${dryRun.issues.length ? `: ${dryRun.issues.slice(0, 3).join("; ")}` : ""} (report data, never a certificate)`);
      else check("dry-run-mapping", "pass", `a dry-run mapping over the ${origin === "datasheet" ? "pin table" : "KiCad convention"} covers every pin and pad (report data, never a certificate)`);
    }
  }

  const exactBasis = input.identityEvidence.manufacturerDatasheet ? "a manufacturer datasheet names the exact part" : input.identityEvidence.distributorExactMpn ? "a distributor observation names the exact MPN (an identity hint for the reviewer, never engineering proof)" : null;
  const identity: CadValidationReport["identity"] = exactBasis
    ? { kind: "exact", exactMpn: target.exactMpn, basis: exactBasis }
    : { kind: "generic", exactMpn: null, basis: `a GENERIC KiCad library candidate (${target.symbol}): no manufacturer datasheet or distributor exact-MPN observation establishes a manufacturer part number${input.table?.fixture ? "; the fixture pin table names a part but is not manufacturer evidence" : ""}` };
  if (identity.kind === "generic") unresolved.push("the exact manufacturer and MPN: a person enters them from the datasheet they cite (organization-authored under that person)");

  const verdict: CadValidationVerdict = unsupported ? "unsupported" : conflicts.length > 0 ? "conflicting" : "validated";
  const body = { schema: CAD_VALIDATION_SCHEMA, validator: CAD_VALIDATION_VERSION, verdict, target, identity, checks, mapping, dryRunCertificate: dryRun, unresolved: [...new Set(unresolved)], conflicts: [...new Set(conflicts)], limitations: [...new Set(limitations)] };
  return { ...body, digest: `sha256:${sha256(canonicalJson(body))}` };
}
