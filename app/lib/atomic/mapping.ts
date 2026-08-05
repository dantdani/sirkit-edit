import type {
  FootprintAssetVersion,
  ManufacturerTerminal,
  MappingCertificate,
  PackageProof,
  SymbolAssetVersion,
  TerminalMappingEntry,
} from "./types";
import { semanticHash } from "./stable";

export const MAPPING_VALIDATOR_VERSION = "sirkit.atomic-mapping/1";

export interface ExplicitTerminalMap {
  manufacturerTerminalId: string;
  symbolPinNumbers: string[];
  logicalPadNumbers: string[];
  classification?: ManufacturerTerminal["classification"];
  internallyCommonGroup?: string;
  evidenceIds: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Produce exact revision-bound proof. Matching counts are never evidence: every
 * electrical symbol pin number and every electrical pad number must be covered
 * by an explicit terminal map (unless classified NC/DNC/NU).
 */
export function buildMappingCertificate(input: {
  exactPartId?: string;
  genericDeviceId?: string;
  symbol: SymbolAssetVersion;
  footprint: FootprintAssetVersion;
  terminals: ManufacturerTerminal[];
  mapping: ExplicitTerminalMap[];
  packageProof?: PackageProof;
  evidenceIds?: string[];
}): MappingCertificate {
  if (Boolean(input.exactPartId) === Boolean(input.genericDeviceId)) {
    throw new Error("Mapping requires exactly one exactPartId or genericDeviceId");
  }

  const terminalById = new Map(input.terminals.map((terminal) => [terminal.id, terminal]));
  const pinsByNumber = new Map<string, string[]>();
  for (const pin of input.symbol.pins) {
    if (!pin.number) continue;
    const ids = pinsByNumber.get(pin.number) ?? [];
    ids.push(pin.id);
    pinsByNumber.set(pin.number, ids);
  }
  const padsByNumber = new Map<string, string[]>();
  const mechanicalPadIds: string[] = [];
  for (const pad of input.footprint.pads) {
    if (pad.mechanical || pad.number === "" || pad.padType === "np_thru_hole") {
      mechanicalPadIds.push(pad.id);
      continue;
    }
    const ids = padsByNumber.get(pad.number) ?? [];
    ids.push(pad.id);
    padsByNumber.set(pad.number, ids);
  }

  const ambiguous: string[] = [];
  const entries: TerminalMappingEntry[] = [];
  const mappedTerminalIds = new Set<string>();
  const mappedPinNumbers = new Set<string>();
  const mappedPadNumbers = new Set<string>();
  const exposedPadIds = new Set<string>();

  for (const requested of [...input.mapping].sort((a, b) => a.manufacturerTerminalId.localeCompare(b.manufacturerTerminalId))) {
    const terminal = terminalById.get(requested.manufacturerTerminalId);
    if (!terminal) {
      ambiguous.push(`unknown manufacturer terminal ${requested.manufacturerTerminalId}`);
      continue;
    }
    if (mappedTerminalIds.has(terminal.id)) {
      ambiguous.push(`manufacturer terminal ${terminal.id} appears in more than one mapping entry`);
    }
    mappedTerminalIds.add(terminal.id);

    const pinIds: string[] = [];
    for (const number of unique(requested.symbolPinNumbers)) {
      const matched = pinsByNumber.get(number);
      if (!matched?.length) ambiguous.push(`terminal ${terminal.id} references absent symbol pin ${number}`);
      else pinIds.push(...matched);
      mappedPinNumbers.add(number);
    }
    const physicalPadIds: string[] = [];
    for (const number of unique(requested.logicalPadNumbers)) {
      const matched = padsByNumber.get(number);
      if (!matched?.length) ambiguous.push(`terminal ${terminal.id} references absent electrical pad ${number}`);
      else physicalPadIds.push(...matched);
      mappedPadNumbers.add(number);
    }
    const classification = requested.classification ?? terminal.classification;
    if (classification === "exposed_thermal") physicalPadIds.forEach((id) => exposedPadIds.add(id));
    entries.push({
      manufacturerTerminalId: terminal.id,
      symbolPinIds: unique(pinIds),
      logicalPadNumbers: unique(requested.logicalPadNumbers),
      physicalPadIds: unique(physicalPadIds),
      classification,
      internallyCommonGroup: requested.internallyCommonGroup,
      evidenceIds: unique([...terminal.evidenceIds, ...requested.evidenceIds]),
    });
  }

  const requiredTerminals = input.terminals.filter((terminal) =>
    terminal.classification !== "mechanical" && terminal.classification !== "unknown",
  );
  const missingTerminalIds = requiredTerminals.filter((terminal) => !mappedTerminalIds.has(terminal.id)).map((terminal) => terminal.id);

  // A symbol number may occur across alternate graphical bodies/units. It is
  // one physical electrical identity for coverage purposes, not extra pads.
  const symbolPinNumbers = unique([...pinsByNumber.keys()]);
  const logicalPadNumbers = unique([...padsByNumber.keys()]);
  const ignoredClassifications = new Set(["nc", "dnc", "nu"]);
  const ignoredPinIds = new Set(entries.filter((entry) => ignoredClassifications.has(entry.classification)).flatMap((entry) => entry.symbolPinIds));
  const requiredPinNumbers = symbolPinNumbers.filter((number) =>
    (pinsByNumber.get(number) ?? []).some((id) => !ignoredPinIds.has(id)),
  );

  const missingSymbolPinIds = requiredPinNumbers
    .filter((number) => !mappedPinNumbers.has(number))
    .flatMap((number) => pinsByNumber.get(number) ?? []);
  const missingPadNumbers = unique([...mappedPadNumbers].filter((number) => !padsByNumber.has(number)));
  const extraElectricalPadNumbers = logicalPadNumbers.filter((number) => !mappedPadNumbers.has(number));

  const packagePinCountMatches = input.packageProof?.pinCount === undefined
    || input.packageProof.pinCount === logicalPadNumbers.length;
  const packageMountMatches = input.packageProof?.mountingTechnology === undefined
    || input.packageProof.mountingTechnology === input.footprint.mountingTechnology;
  const packageIdentityMatches = input.packageProof?.exactPartId === undefined
    || input.packageProof.exactPartId === input.exactPartId;
  const packageProven = input.packageProof?.state === "proven"
    && input.packageProof.footprintVersionId === input.footprint.versionId
    && packagePinCountMatches
    && packageMountMatches
    && packageIdentityMatches;
  if (input.packageProof && input.packageProof.footprintVersionId !== input.footprint.versionId) {
    ambiguous.push("package proof is bound to a different footprint revision");
  }
  if (!packagePinCountMatches) ambiguous.push("package proof pin count does not match exact electrical pad identities");
  if (!packageMountMatches) ambiguous.push("package proof mounting technology does not match footprint semantics");
  if (!packageIdentityMatches) ambiguous.push("package proof is bound to a different exact part");

  let state: MappingCertificate["state"] = "approved";
  if (ambiguous.length) state = "ambiguous";
  else if (missingTerminalIds.length || missingSymbolPinIds.length || missingPadNumbers.length || extraElectricalPadNumbers.length) state = "missing";
  else if (!packageProven) state = "candidate";

  const body = {
    exactPartId: input.exactPartId,
    genericDeviceId: input.genericDeviceId,
    symbolVersionId: input.symbol.versionId,
    footprintVersionId: input.footprint.versionId,
    entries,
    requiredTerminalIds: unique(requiredTerminals.map((terminal) => terminal.id)),
    symbolPinIds: unique(input.symbol.pins.map((pin) => pin.id)),
    logicalPadNumbers,
    missingTerminalIds: unique(missingTerminalIds),
    missingSymbolPinIds: unique(missingSymbolPinIds),
    missingPadNumbers,
    extraElectricalPadNumbers,
    ambiguous: unique(ambiguous),
    mechanicalPadIds: unique(mechanicalPadIds),
    exposedPadIds: unique([...exposedPadIds]),
    evidenceIds: unique(input.evidenceIds ?? []),
    packageProofId: input.packageProof?.id,
    validatorVersion: MAPPING_VALIDATOR_VERSION,
    schemaVersion: 1 as const,
    state,
  };
  const hash = semanticHash(body);
  return { id: `map_${hash}`, semanticHash: hash, ...body };
}

export function mappingIsCurrent(certificate: MappingCertificate, symbolVersionId: string, footprintVersionId: string): boolean {
  return certificate.symbolVersionId === symbolVersionId && certificate.footprintVersionId === footprintVersionId;
}

/** Candidate names and footprint filters deliberately cannot call this. */
export function provePackage(input: Omit<PackageProof, "id" | "state" | "conflicts"> & {
  checks: Array<{ field: string; expected: string | number; actual: string | number | undefined; tolerance?: number }>;
}): PackageProof {
  const { checks, ...body } = input;
  const conflicts: string[] = [];
  let unknown = false;
  for (const check of checks) {
    if (check.actual === undefined) {
      unknown = true;
      continue;
    }
    if (typeof check.expected === "number" && typeof check.actual === "number") {
      if (Math.abs(check.actual - check.expected) > (check.tolerance ?? 0)) conflicts.push(`${check.field} mismatch`);
    } else if (String(check.expected).trim().toLowerCase() !== String(check.actual).trim().toLowerCase()) {
      conflicts.push(`${check.field} mismatch`);
    }
  }
  const state: PackageProof["state"] = conflicts.length ? "conflicting" : unknown ? "unknown" : input.evidenceIds.length ? "proven" : "candidate";
  const hash = semanticHash({ ...body, conflicts, state });
  return { id: `pkg_${hash}`, ...body, conflicts, state };
}
