# B16.0.21 §G — Mutation & release confinement (CONFIRMED)

Code-only gates (comments + strings stripped) across all eight routes:

- no `releaseManufacturingPackage` / `manufacturing.release` /
  `DurableManufacturingAuthorityStore` — release authority unreachable;
- no `applySchematicTransaction` / `publishBoard` / `runEngineeringPlacement`
  — no direct schematic/PCB mutation authority;
- no firmware device/process/network execution identifiers;
- no agent tool exposure was added (registry still EXACTLY 12; no family name
  appears in any exposed descriptor);
- `sirkit.manufacturing.release` stays internal-only / not-callable /
  agentExposed false (descriptor re-asserted).

Aliases, dead code, and fake wrappers cannot fool the gates: canonical
classification requires exact provenance from the sanctioned module +
`APPROVED_ROUTE_WRAPPERS`; string/comment stripping precedes every scan;
TRANCHE_14 ratchet pins make any raw reversion fail CI.
