import type { FootprintDef, PinPadMappingKind, ResolvedPinPadMapping } from "./types";
import {
  canonicalEndpointSet,
  compareDiagnostics,
  engineeringDiagnostic,
  normalizePinIdentifier,
  schematicEndpointKey,
  type EngineeringDiagnostic,
} from "./integrity";

export interface ExplicitPinPadMapping {
  symbolPinNumber: string;
  padNumbers: string[];
  mappingKind: PinPadMappingKind;
  provenance?: "library-explicit" | "user-explicit";
}

export interface PinPadMappingContract {
  mappings?: ExplicitPinPadMapping[];
  /** Explicit classification for electrical-looking footprint pads not mapped to a symbol pin. */
  footprintPadClassifications?: Record<string, "mechanical" | "intentional-no-connect">;
  /** Explicit classification for symbol pins that intentionally have no physical pad. */
  schematicPinClassifications?: Record<string, "intentional-no-connect" | "schematic-only">;
}

export interface PinPadComponent {
  id: string;
  ref: string;
  pins: Array<{ number: string; name?: string }>;
  pinPadMapping?: PinPadMappingContract;
}

export interface PinPadMappingResult {
  ok: boolean;
  mappings: ResolvedPinPadMapping[];
  padNets: Record<string, number>;
  diagnostics: EngineeringDiagnostic[];
  footprintPadClassifications: Record<string, "mechanical" | "intentional-no-connect">;
  accounting: {
    electricalSchematicPins: string[];
    mappedSchematicPins: string[];
    intentionalSchematicOnlyPins: string[];
    unmappedSchematicPins: string[];
    electricalFootprintPads: string[];
    mappedFootprintPads: string[];
    classifiedExtraPads: string[];
    unclassifiedExtraPads: string[];
  };
}

function normalizedRecord<T>(record: Record<string, T> | undefined): Map<string, T> {
  return new Map(Object.entries(record ?? {}).map(([key, value]) => [normalizePinIdentifier(key), value]));
}

/**
 * Exact identifier matching is the only implicit policy. Identifiers are
 * trimmed but remain case-sensitive strings; no count/order/position/numeric
 * coercion participates in acceptance.
 */
export function resolvePinPadMapping(
  component: PinPadComponent,
  footprint: FootprintDef,
  netIdByEndpoint: ReadonlyMap<string, number>,
): PinPadMappingResult {
  const diagnostics: EngineeringDiagnostic[] = [];
  const contract = component.pinPadMapping;
  const pinClassifications = normalizedRecord(contract?.schematicPinClassifications);
  const padClassifications = normalizedRecord(contract?.footprintPadClassifications);
  const uniquePins = new Map<string, { number: string; name?: string }>();
  for (const pin of component.pins) {
    const number = normalizePinIdentifier(pin.number);
    if (!number) {
      diagnostics.push(engineeringDiagnostic(
        "INVALID_SCHEMATIC_PIN_IDENTITY",
        `${component.ref} contains an empty schematic pin identifier.`,
        { componentIds: [component.id], context: { pin: pin.number } },
      ));
      continue;
    }
    const prior = uniquePins.get(number);
    if (prior && prior.name !== pin.name) {
      diagnostics.push(engineeringDiagnostic(
        "PIN_PAD_MAPPING_AMBIGUOUS",
        `${component.ref} contains conflicting symbol definitions for pin '${number}'.`,
        { componentIds: [component.id], context: { pinNumber: number } },
      ));
    }
    uniquePins.set(number, { ...pin, number });
  }

  const electricalPads = footprint.pads.filter((pad) => pad.type !== "np_thru_hole");
  const padsByNumber = new Map<string, number[]>();
  for (let index = 0; index < electricalPads.length; index++) {
    const number = normalizePinIdentifier(electricalPads[index].number);
    if (!number) {
      diagnostics.push(engineeringDiagnostic(
        "UNCLASSIFIED_FOOTPRINT_PAD",
        `${component.ref} footprint ${footprint.libName}:${footprint.name} has an electrical pad with no identifier.`,
        { componentIds: [component.id], context: { footprint: `${footprint.libName}:${footprint.name}`, padIndex: index } },
      ));
      continue;
    }
    const indices = padsByNumber.get(number) ?? [];
    indices.push(index);
    padsByNumber.set(number, indices);
  }

  const explicitByPin = new Map<string, ExplicitPinPadMapping>();
  for (const explicit of contract?.mappings ?? []) {
    const pin = normalizePinIdentifier(explicit.symbolPinNumber);
    if (explicitByPin.has(pin)) {
      diagnostics.push(engineeringDiagnostic(
        "PIN_PAD_MAPPING_AMBIGUOUS",
        `${component.ref} has more than one explicit mapping for symbol pin '${pin}'.`,
        { componentIds: [component.id], context: { pinNumber: pin } },
      ));
      continue;
    }
    explicitByPin.set(pin, explicit);
  }

  const mappings: ResolvedPinPadMapping[] = [];
  const intentionalSchematicOnlyPins: string[] = [];
  const unmappedSchematicPins: string[] = [];
  for (const [pinNumber] of [...uniquePins].sort(([a], [b]) => a.localeCompare(b))) {
    const endpointKey = schematicEndpointKey(component.id, pinNumber);
    const explicit = explicitByPin.get(pinNumber);
    if (explicit) {
      const padNumbers = [...new Set(explicit.padNumbers.map(normalizePinIdentifier))].sort();
      const missing = padNumbers.filter((pad) => !padsByNumber.has(pad));
      if (missing.length > 0) {
        diagnostics.push(engineeringDiagnostic(
          "PIN_PAD_MAPPING_MISSING",
          `${component.ref}.${pinNumber} maps to missing footprint pad${missing.length === 1 ? "" : "s"} ${missing.join(", ")}.`,
          { componentIds: [component.id], context: { pinNumber, missingPadNumbers: missing } },
        ));
        unmappedSchematicPins.push(pinNumber);
        continue;
      }
      if (padNumbers.length === 0 && explicit.mappingKind !== "intentional-no-connect" && explicit.mappingKind !== "schematic-only") {
        diagnostics.push(engineeringDiagnostic(
          "UNMAPPED_SCHEMATIC_PIN",
          `${component.ref}.${pinNumber} has an explicit electrical mapping with no physical pad.`,
          { componentIds: [component.id], context: { pinNumber, mappingKind: explicit.mappingKind } },
        ));
        unmappedSchematicPins.push(pinNumber);
        continue;
      }
      mappings.push({
        componentInstanceId: component.id,
        endpointKey,
        symbolPinNumber: pinNumber,
        padNumbers,
        mappingKind: explicit.mappingKind,
        provenance: explicit.provenance ?? "library-explicit",
      });
      if (explicit.mappingKind === "intentional-no-connect" || explicit.mappingKind === "schematic-only") {
        intentionalSchematicOnlyPins.push(pinNumber);
      }
      continue;
    }

    const pinClassification = pinClassifications.get(pinNumber);
    if (pinClassification) {
      mappings.push({
        componentInstanceId: component.id,
        endpointKey,
        symbolPinNumber: pinNumber,
        padNumbers: [],
        mappingKind: pinClassification,
        provenance: "library-explicit",
      });
      intentionalSchematicOnlyPins.push(pinNumber);
      continue;
    }

    if (padsByNumber.has(pinNumber)) {
      mappings.push({
        componentInstanceId: component.id,
        endpointKey,
        symbolPinNumber: pinNumber,
        padNumbers: [pinNumber],
        mappingKind: "electrical",
        provenance: "exact-number",
      });
      continue;
    }

    unmappedSchematicPins.push(pinNumber);
    diagnostics.push(engineeringDiagnostic(
      "UNMAPPED_SCHEMATIC_PIN",
      `${component.ref}.${pinNumber} has no exact physical pad and no explicit trusted mapping.`,
      {
        componentIds: [component.id],
        context: { pinNumber, footprint: `${footprint.libName}:${footprint.name}` },
        suggestedActions: ["Choose a footprint with matching pad identifiers or provide an explicit library mapping."],
      },
    ));
  }

  for (const pin of explicitByPin.keys()) {
    if (uniquePins.has(pin)) continue;
    diagnostics.push(engineeringDiagnostic(
      "PIN_PAD_MAPPING_AMBIGUOUS",
      `${component.ref} has an explicit mapping for unknown symbol pin '${pin}'.`,
      { componentIds: [component.id], context: { pinNumber: pin } },
    ));
  }

  for (const padNumber of padClassifications.keys()) {
    if (padsByNumber.has(padNumber)) continue;
    diagnostics.push(engineeringDiagnostic(
      "PAD_CLASSIFICATION_UNKNOWN",
      `${component.ref} classifies footprint pad '${padNumber}', but that pad does not exist.`,
      { componentIds: [component.id], context: { padNumber } },
    ));
  }

  for (const mapping of mappings) {
    if (mapping.mappingKind !== "intentional-no-connect" && mapping.mappingKind !== "schematic-only") continue;
    const connectedNetId = netIdByEndpoint.get(mapping.endpointKey) ?? 0;
    if (connectedNetId === 0) continue;
    diagnostics.push(engineeringDiagnostic(
      "CONNECTED_NONPHYSICAL_PIN_UNSUPPORTED",
      `${component.ref}.${mapping.symbolPinNumber} participates in net ${connectedNetId} but is classified as ${mapping.mappingKind}.`,
      {
        componentIds: [component.id],
        context: { pinNumber: mapping.symbolPinNumber, netId: connectedNetId, mappingKind: mapping.mappingKind },
        suggestedActions: ["Map the connected schematic pin to physical pad(s), or remove it from the routable schematic net."],
      },
    ));
  }

  const mappedPads = new Set(mappings.flatMap((mapping) => mapping.padNumbers));
  const classifiedExtraPads: string[] = [];
  const unclassifiedExtraPads: string[] = [];
  for (const padNumber of [...padsByNumber.keys()].sort()) {
    if (mappedPads.has(padNumber)) continue;
    if (padClassifications.has(padNumber)) classifiedExtraPads.push(padNumber);
    else {
      unclassifiedExtraPads.push(padNumber);
      diagnostics.push(engineeringDiagnostic(
        "UNCLASSIFIED_FOOTPRINT_PAD",
        `${component.ref} footprint pad '${padNumber}' is electrical but has no symbol mapping or explicit classification.`,
        {
          componentIds: [component.id],
          context: { padNumber, footprint: `${footprint.libName}:${footprint.name}` },
          suggestedActions: ["Classify the pad as mechanical/no-connect or map it explicitly to a symbol pin."],
        },
      ));
    }
  }

  const mappingsByPad = new Map<string, ResolvedPinPadMapping[]>();
  for (const mapping of mappings) {
    for (const padNumber of mapping.padNumbers) {
      const bucket = mappingsByPad.get(padNumber) ?? [];
      bucket.push(mapping);
      mappingsByPad.set(padNumber, bucket);
    }
  }
  const padNets: Record<string, number> = {};
  for (const [padNumber, owners] of [...mappingsByPad].sort(([a], [b]) => a.localeCompare(b))) {
    const electricalOwners = owners.filter((owner) => owner.mappingKind !== "intentional-no-connect" && owner.mappingKind !== "schematic-only");
    const netIds = new Set(electricalOwners.map((owner) => netIdByEndpoint.get(owner.endpointKey) ?? 0));
    const sharedIsExplicit = electricalOwners.length > 1 && electricalOwners.every((owner) => owner.mappingKind === "internally-common");
    const mixesNonElectrical = owners.length !== electricalOwners.length && electricalOwners.length > 0;
    if (mixesNonElectrical || (electricalOwners.length > 1 && (!sharedIsExplicit || netIds.size !== 1))) {
      diagnostics.push(engineeringDiagnostic(
        "PAD_NET_CONFLICT",
        `${component.ref} footprint pad '${padNumber}' is claimed by incompatible schematic pins.`,
        {
          componentIds: [component.id],
          context: {
            padNumber,
            symbolPins: electricalOwners.map((owner) => owner.symbolPinNumber),
            netIds: [...netIds],
          },
        },
      ));
      continue;
    }
    const assigned = [...netIds].find((netId) => netId !== 0);
    if (assigned !== undefined) padNets[padNumber] = assigned;
  }

  const mappedSchematicPins = canonicalEndpointSet(mappings.map((mapping) => mapping.symbolPinNumber));
  const accounting = {
    electricalSchematicPins: [...uniquePins.keys()].sort(),
    mappedSchematicPins,
    intentionalSchematicOnlyPins: [...new Set(intentionalSchematicOnlyPins)].sort(),
    unmappedSchematicPins: [...new Set(unmappedSchematicPins)].sort(),
    electricalFootprintPads: [...padsByNumber.keys()].sort(),
    mappedFootprintPads: [...mappedPads].sort(),
    classifiedExtraPads,
    unclassifiedExtraPads,
  };
  diagnostics.sort(compareDiagnostics);
  return {
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    mappings: mappings.sort((a, b) => a.symbolPinNumber.localeCompare(b.symbolPinNumber)),
    padNets,
    diagnostics,
    footprintPadClassifications: Object.fromEntries([...padClassifications].sort(([a], [b]) => a.localeCompare(b))),
    accounting,
  };
}
