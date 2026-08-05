# Stage 5 project passive-package policy repository discovery

## Prerequisite finding

Stages 1–4 expose the necessary contract shapes, but each strict completion report is `BLOCKED`. In particular, Stage 4's handoff says production consumption requires a durable atomic-catalog + Stage 1 mapping transaction and restart qualification. Stage 3 has no qualified durable server project snapshot/board/plan transaction. Stage 5 therefore cannot replace the live footprint path or claim production policy authority. Any implementation in this stage must remain default-off and qualification-only.

## Ownership table

| Path | Classification | Current authority and Stage 5 consequence |
|---|---|---|
| `app/lib/physical-binding/types.ts` | authoritative component physical identity/classification and exact override contract | stable component/project/branch/variant identity; physical class/polarity/mounting; exact part, package, asset, Stage 4 mapping, origin, approval, freshness/conflict and layout/manufacturing readiness axes |
| `app/lib/physical-binding/{validation,readiness,repository,server-repository}.ts` | Stage 1 validation/readiness/lifecycle/persistence | distinguishes layout from manufacturing; `project_passive_policy` origin and `packagePolicyRevision` dependency hooks exist; durable cross-stage policy publication is not implemented |
| `app/lib/atomic/types.ts` and `app/lib/atomic/quantity.ts` | authoritative catalog engineering claims and SI quantity normalization | typed quantities/claims support passive/electrical facets, evidence, conflicts and safety-critical flags; the live browser schematic does not provide a complete approved projection of these facts per generic component |
| `app/lib/schematic-compiler/types.ts` | authoritative CD-8 exact-component graph | stable role/value/property/variant provenance, but components already require exact part/package/footprint/mapping; not a generic-passive policy input source |
| `lib/schematic-types.ts` | legacy/live browser schematic model | value, coarse type and AI/layout role only; role normalization falls back from refdes and cannot establish Stage 5 eligibility |
| `app/lib/calculation/*` | deterministic engineering quantity/calculation evidence | can provide future approved rating/derating facts, but there is no current Stage 5 projection keyed to generic component and policy snapshot |
| `app/lib/component-selection/*` | exact candidate/part authority | outside Stage 5 package reservation; must remain higher authority where an exact approved binding exists |
| `app/lib/mapping-verification/*` and `docs/mapping-verification-stage-05-handoff.json` | Stage 4 mapping authority | only verified, approved, current, conflict-free active `exact_part`, `package_family` or `curated_pair` mappings may be consumed; limited direct mappings are forbidden for layout |
| `app/lib/footprint-resolver/{types,policy,adapters,service}.ts` | Stage 2 final footprint resolution authority | reserved `passive_policy` source and rank 6 exist but are intentionally disabled; exact/selected sources rank above policy; cache is disabled |
| `app/lib/pcb-sync/*` | Stage 3 complete-design preflight/plan/apply authority | consumes only Stage 2 results; plan dependencies and stale lifecycle exist; policy change may stale affected plans without board mutation |
| `lib/footprint-assign.ts` | legacy hidden default/heuristic | assigns R/C/L/FB to 0603 and D/Q defaults from refdes; candidate-only in newer evidence but still a live compatibility path; must never be imported by Stage 5 authority |
| `app/lib/pcb/package-map.ts` and `app/lib/pcb/netlist-bridge.ts` | legacy PCB heuristic path | scans value/MPN/name/description for package text, collapses bare imperial-like tokens, and maps by refdes prefix; Stage 3 excludes these functions, but live legacy synchronization still uses them |
| `app/lib/parts-normalization.ts` | catalog search/identifier normalization | contains package token normalization for catalog discovery, not policy proof; ambiguous bare package names are unsuitable as Stage 5 identity |
| `app/lib/physical-binding/legacy.ts` | legacy preservation/migration | preserves ambiguous package tokens as unapproved migration diagnostics; appropriate source for dry-run suggestions only |
| `app/components/editor/BuildLibraryPanel.tsx` and current PCB panels | UI-only display | no approved project passive-policy editor or trusted server policy snapshot exists |
| `app/lib/db/schema.ts`, `drizzle/0022_footprint_binding_stage01.sql` | existing durable Stage 1/atomic storage | no Stage 5 policy/profile/rule/audit/idempotency tables or transaction coordinator exist |

## Passive facts and classification inventory

### Available typed authorities

- Stage 1 `ComponentPhysicalClassification`: device class, physical/DNP state, mounting technology, polarity and classification evidence.
- Atomic `EngineeringClaim`: property/facet, typed quantity or value, condition scope, source state, evidence, conflicts and `safetyCritical`.
- Atomic `Quantity`: resistance, capacitance, inductance, voltage, current, power, frequency, time, temperature and dimensionless ranges/tolerances normalized to SI.
- CD-8 exact component graph: stable component identity, architecture/recipe roles, selected value, exact revisions, property provenance and per-variant population rules.
- Stage 1 exact binding: exact manufacturer part/package/footprint/mapping, approval and readiness.
- Stage 4 mapping: explicit symmetry/permutation, polarity/function, package terminal and exact footprint pad dependencies.

### Present but not authoritative enough for eligibility

- `SchComponent.type` and free-form `value` distinguish only basic resistor/capacitor/inductor symbols.
- `BuildLogicalComponent.role` is a layout role; `normalizeComponentRole` may infer from refdes and defaults unknown cases to passive.
- net-label kind inference and free-form role text do not prove decoupling, bulk, current-sense, RF, safety, timing or voltage domain.
- catalog search package/value strings and symbol footprint hints are suggestions, not approved package/rating facts.

### Missing production projection

There is no current authoritative per-generic-component snapshot that jointly supplies approved class/subclass, application role, normalized value, technology, polarity, tolerance, voltage, power/current, temperature coefficient/dielectric, ESR/DCR/frequency/pulse/surge/safety flags, domain/environment, assembly capability, source state and exact Stage 1/4 dependencies. Stage 5 can define and qualify this provider contract, but cannot safely infer the missing projection from the live schematic.

## Every current passive footprint assignment/suggestion rule

1. `lib/footprint-assign.ts#resolveFootprint`
   - approved atomic footprint wins;
   - fully qualified symbol hint becomes an unapproved candidate;
   - otherwise refdes R/C/L/FB gets 0603 imperial/1608 metric; diode/LED/transistor defaults also exist;
   - used for compatibility/tests and reproduces the generic capacitor inconsistency.
2. `app/lib/pcb/netlist-bridge.ts#resolveFootprint`
   - consumes explicit resolved/hinted library data first;
   - then `guessPackageToken` scans footprint hint, value, MPN, name and description;
   - `heuristicFootprint` maps chip packages using the refdes prefix and checks lookup/pad count downstream;
   - this remains legacy live synchronization, not Stage 2/3 authority.
3. `app/lib/physical-binding/legacy.ts`
   - imports footprint/package strings as unapproved/stale/ambiguous candidates with raw source capture; it does not establish readiness.
4. `app/lib/footprint-resolver`
   - selected approved Stage 1 binding, exact part, explicit assignment, approved symbol fact and approved package mapping are ranked authorities;
   - legacy/human/AI are suggestions;
   - `passive_policy` is a reserved disabled source at lower precedence than exact/component sources.
5. Demo/test fixtures and catalog search prompting contain package names, but are not project policy authority.

## Ambiguity and migration finding

- Stage 1 correctly rejects bare `0603` unless the identity system explicitly states metric/imperial semantics.
- `app/lib/pcb/package-map.ts#normalizePackage` still treats bare chip codes as imperial-like tokens for the legacy bridge and collapses `0603 (1608 metric)` to `0603`.
- `lib/footprint-assign.ts` still carries a universal refdes-based 0603 default.
- These paths cannot be silently rewritten because the running product still depends on the legacy browser flow. Stage 5 will provide a dry-run diagnostic/migration contract and prove its new authority never calls either helper. Removing/cutting over the legacy paths requires the durable Stage 1–5 transaction/provider work identified by the prerequisite blockers.

## Safe implementation boundary

Stage 5 may safely add:

- immutable versioned policy/profile/fact/evaluation/lifecycle contracts;
- strict package identity normalization and typed value parsing;
- a pure evaluator with mandatory exclusions, explicit modes, complete gaps and no board mutation;
- in-memory qualification repositories, preview, audit, idempotency and precise Stage 3 plan invalidation;
- a Stage 2 candidate-source adapter that is not installed in the default source list/policy;
- default-off API/UI and dry-run legacy diagnostics;
- tests/evidence/documentation.

It may not safely enable the source, publish durable production policies, project generic browser components into trusted facts, or alter the live legacy resolver. Those remain explicit blockers rather than hidden assumptions.
