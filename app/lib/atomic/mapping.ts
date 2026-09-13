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
 * [B19-D I5d row 38] Cross-entry conflicts: one pad number or one symbol pin claimed by more than one terminal. Sharing is
 * legitimate only for terminals the manufacturer declares internally common (the same `internallyCommonGroup`) or, for pads,
 * when every claim is the exposed thermal pad. Anything else is a short the certificate must not approve.
 */
function crossEntryConflicts(entries: readonly TerminalMappingEntry[]): string[] {
  const conflicts: string[] = [];
  const shareable = (claims: readonly TerminalMappingEntry[], allowThermal: boolean): boolean => {
    const group = claims[0]?.internallyCommonGroup;
    if (group && claims.every((entry) => entry.internallyCommonGroup === group)) return true;
    return allowThermal && claims.every((entry) => entry.classification === "exposed_thermal");
  };
  const padClaims = new Map<string, TerminalMappingEntry[]>();
  const pinClaims = new Map<string, TerminalMappingEntry[]>();
  for (const entry of entries) {
    for (const number of new Set(entry.logicalPadNumbers)) padClaims.set(number, [...(padClaims.get(number) ?? []), entry]);
    for (const pinId of new Set(entry.symbolPinIds)) pinClaims.set(pinId, [...(pinClaims.get(pinId) ?? []), entry]);
  }
  for (const [number, claims] of padClaims) {
    if (claims.length > 1 && !shareable(claims, true)) {
      conflicts.push(`pad ${number} is claimed by terminals ${unique(claims.map((entry) => entry.manufacturerTerminalId)).join(", ")}`);
    }
  }
  for (const [pinId, claims] of pinClaims) {
    if (claims.length > 1 && !shareable(claims, false)) {
      conflicts.push(`symbol pin ${pinId} is claimed by terminals ${unique(claims.map((entry) => entry.manufacturerTerminalId)).join(", ")}`);
    }
  }
  return conflicts;
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
    // [B19-D I5d row 38] an entry may supply a classification only where the terminal's own is unknown; silently turning an
    // electrical terminal into a no-connect would drop it from coverage
    if (requested.classification && terminal.classification !== "unknown" && requested.classification !== terminal.classification) {
      ambiguous.push(`mapping entry for terminal ${terminal.id} reclassifies it from ${terminal.classification} to ${requested.classification}`);
    }
    const classification = requested.classification ?? terminal.classification;
    if (classification === "unknown") ambiguous.push(`terminal ${terminal.id} is mapped but its classification is unknown`);
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

  ambiguous.push(...crossEntryConflicts(entries));
  // [B19-D I5d row 38] a terminal whose classification is unknown might be electrical: unmapped, it is unresolved, not ignorable
  for (const terminal of input.terminals) {
    if (terminal.classification === "unknown" && !mappedTerminalIds.has(terminal.id)) ambiguous.push(`terminal ${terminal.id} has an unknown classification and is not mapped`);
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

/**
 * [B19-D I5d row 38] Re-verify a certificate as it arrives in a snapshot, from its own content and the exact assets it names.
 * Publication used to trust `state`; a certificate whose entries were edited afterwards still said "approved". This checks
 * that the content still hashes to the certificate's id, that every entry names real pins and pads, that no pad or pin is
 * claimed by conflicting terminals, and — for an approved certificate — that coverage is complete and nothing is unresolved.
 */
export function mappingCertificateIntegrityErrors(certificate: MappingCertificate, symbol: SymbolAssetVersion, footprint: FootprintAssetVersion): string[] {
  const errors: string[] = [];
  const { id, semanticHash: declaredHash, ...body } = certificate;
  const hash = semanticHash(body);
  if (hash !== declaredHash || id !== `map_${hash}`) errors.push("its content does not match its hash");
  if (certificate.symbolVersionId !== symbol.versionId || certificate.footprintVersionId !== footprint.versionId) errors.push("it is bound to other asset versions");
  const pinById = new Map(symbol.pins.map((pin) => [pin.id, pin]));
  const padById = new Map(footprint.pads.map((pad) => [pad.id, pad]));
  const electricalPadNumbers = new Set(footprint.pads.filter((pad) => !(pad.mechanical || pad.number === "" || pad.padType === "np_thru_hole")).map((pad) => pad.number));
  for (const entry of certificate.entries) {
    for (const pinId of entry.symbolPinIds) if (!pinById.has(pinId)) errors.push(`terminal ${entry.manufacturerTerminalId} names an absent symbol pin`);
    for (const padId of entry.physicalPadIds) {
      const pad = padById.get(padId);
      if (!pad) errors.push(`terminal ${entry.manufacturerTerminalId} names an absent pad`);
      else if (!entry.logicalPadNumbers.includes(pad.number)) errors.push(`terminal ${entry.manufacturerTerminalId} names pad ${pad.number} outside its logical pad numbers`);
    }
    for (const number of entry.logicalPadNumbers) if (!electricalPadNumbers.has(number)) errors.push(`terminal ${entry.manufacturerTerminalId} names absent electrical pad ${number}`);
  }
  errors.push(...crossEntryConflicts(certificate.entries));
  if (certificate.state === "approved") {
    const mappedPads = new Set(certificate.entries.flatMap((entry) => entry.logicalPadNumbers));
    for (const number of electricalPadNumbers) if (!mappedPads.has(number)) errors.push(`electrical pad ${number} is not mapped`);
    const mappedPinNumbers = new Set(certificate.entries.flatMap((entry) => entry.symbolPinIds.map((pinId) => pinById.get(pinId)?.number)));
    for (const pin of symbol.pins) if (pin.number && !mappedPinNumbers.has(pin.number)) errors.push(`symbol pin ${pin.number} is not mapped`);
    if (certificate.entries.some((entry) => entry.classification === "unknown")) errors.push("an entry's classification is unknown");
    if (certificate.ambiguous.length || certificate.missingTerminalIds.length || certificate.missingSymbolPinIds.length || certificate.missingPadNumbers.length || certificate.extraElectricalPadNumbers.length) {
      errors.push("it is approved while listing unresolved items");
    }
  }
  return [...new Set(errors)].sort();
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
