import { circuitDigest } from "./stable";

export interface Cd5CorpusManifestEntry { fixtureId: string; title: string; expectedOutcome: "supported" | "external_review_required" | "rejected" | "blocked" | "quarantined" | "lifecycle_invalidation" | "scale_only"; sourceLicenseId: "cd5-corpus-metadata-only"; provenance: "hand_authored_manifest"; immutableManifestHash: string; implementationState: "manifest_only"; }

const CASES: Array<[string, Cd5CorpusManifestEntry["expectedOutcome"]]> = [
  ["generic digital IC support", "supported"], ["MCU minimum system", "supported"], ["two MCU package overlays", "supported"],
  ["LDO role and stability obligations", "supported"], ["buck converter", "external_review_required"], ["boost or buck-boost", "external_review_required"], ["reverse polarity source selection load switch", "supported"],
  ["voltage and current monitor", "supported"], ["crystal or resonator", "external_review_required"], ["external oscillator and clock buffer", "supported"], ["reset supervisor watchdog power-good", "supported"],
  ["boot strap configuration", "supported"], ["I2C open-drain shared pull", "supported"], ["SPI point-to-point and multitarget", "supported"], ["UART external interface", "supported"],
  ["CAN transceiver", "external_review_required"], ["RS-485 transceiver", "external_review_required"], ["USB interface", "external_review_required"], ["ADC input", "external_review_required"],
  ["voltage reference", "external_review_required"], ["op-amp gain stage", "external_review_required"], ["active or passive filter", "external_review_required"], ["comparator threshold hysteresis", "external_review_required"],
  ["digital or analog sensor interface", "supported"], ["low-side MOSFET load driver", "supported"], ["high-side load switch", "supported"], ["relay or solenoid", "external_review_required"],
  ["LED indicator", "supported"], ["button switch input", "supported"], ["connector and ESD protection", "supported"], ["programming debug test points", "supported"],
  ["functional isolation crossing", "external_review_required"], ["multi-recipe composition", "supported"], ["deliberate composition conflicts", "rejected"], ["generic family exact overlay chain", "supported"],
  ["erratum workaround", "supported"], ["inapplicable reference design", "rejected"], ["missing unlicensed conflicting evidence", "blocked"], ["novel analog or power proposal", "quarantined"],
  ["deprecation revocation upgrade", "lifecycle_invalidation"], ["malicious inputs", "rejected"], ["scale family", "scale_only"],
];

export const CD5_CORPUS_MANIFEST: Cd5CorpusManifestEntry[] = CASES.map(([title, expectedOutcome], index) => {
  const fixtureId = `cd5-fixture-${String(index + 1).padStart(2, "0")}`;
  const base = { fixtureId, title, expectedOutcome, sourceLicenseId: "cd5-corpus-metadata-only" as const, provenance: "hand_authored_manifest" as const, implementationState: "manifest_only" as const };
  return { ...base, immutableManifestHash: circuitDigest(base) };
});

export const CD5_CORPUS_MANIFEST_DIGEST = circuitDigest(CD5_CORPUS_MANIFEST);
