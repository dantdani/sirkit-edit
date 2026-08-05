/** Original MIT-licensed Stage 5 coverage corpus (metadata-only fixtures). */
export const ATOMIC_FIXTURE_CORPUS = [
  { id: "generic-resistor", category: "generic", identity: "generic", expectation: "no invented MPN; multiple footprint candidates remain unapproved" },
  { id: "exact-rc", category: "passive", identity: "exact_mpn", expectation: "typed value/tolerance/rating/package/temperature and supplier snapshots" },
  { id: "multi-unit-opamp", category: "op_amp", identity: "exact_mpn", expectation: "separate power unit maps to one footprint" },
  { id: "mcu-hidden-domains", category: "mcu", identity: "exact_mpn", expectation: "hidden power, config, debug pins and voltage domains retained" },
  { id: "regulator-ep", category: "regulator", identity: "exact_mpn", expectation: "capacitor stability guidance and exposed pad retained" },
  { id: "connector-mechanical-common", category: "connector", identity: "exact_mpn", expectation: "mechanical and repeated/commoned pads distinguished" },
  { id: "thermal-paste-apertures", category: "package", identity: "exact_mpn", expectation: "one logical EP and multiple physical/paste instances" },
  { id: "dense-bga", category: "dense_package", identity: "exact_mpn", expectation: "alphanumeric pad mapping is exact" },
  { id: "suffix-family", category: "variants", identity: "exact_mpn", expectation: "package/temperature suffix variants never merge" },
  { id: "filter-many-proof-one", category: "candidate_selection", identity: "exact_mpn", expectation: "filter yields candidates; one evidence-approved footprint" },
  { id: "missing-model", category: "mechanical", identity: "exact_mpn", expectation: "PCB assignable but not mechanically complete" },
  { id: "equal-count-mismatch", category: "negative_mapping", identity: "exact_mpn", expectation: "pin {1,3} versus pad {1,2} fails" },
  { id: "source-conflict", category: "conflict", identity: "exact_mpn", expectation: "both values retained and critical approval blocked" },
  { id: "stale-offer", category: "sourcing", identity: "supplier_sku", expectation: "expired availability cannot satisfy fresh requirement" },
  { id: "restricted-cad", category: "license", identity: "exact_mpn", expectation: "private quarantine allowed; publication/export prohibited" },
  { id: "malformed-untrusted", category: "security", identity: "none", expectation: "depth/size/path/URL/archive limits reject safely" },
] as const;

export const ATOMIC_FIXTURE_LICENSE = {
  spdxId: "MIT",
  author: "Sirkit",
  containsThirdPartyContent: false,
} as const;

