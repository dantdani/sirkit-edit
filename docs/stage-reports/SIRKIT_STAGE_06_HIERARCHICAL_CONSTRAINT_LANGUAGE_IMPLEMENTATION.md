# Sirkit Stage 6 — Hierarchical Constraint Language Implementation

Date: 2026-07-17  
Branch: `codex/stage-06-hierarchical-constraint-language`  
Protected working copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`  
Original source tree: `C:\Users\robsa\sirkit` — not modified

## 1. Executive summary

Stage 6 now has a real, typed engineering-constraint foundation rather than another collection of UI rule fields. The implementation adds:

- a JSON-only canonical constraint AST;
- exact deterministic quantities and unit conversion;
- stable-ID selectors, explicit cardinality, conditions, relationships, and revision-bound target snapshots;
- order-independent restrictive merge algebra with stable conflict reports;
- immutable compiled programs carrying source/design/catalog/variant/profile/compiler identity;
- enforcement coverage, physical and relationship lowerings, evaluation, waivers, explainability, preview/apply/revert transactions, and semantic caches;
- legacy board-rule migration, Stage 5 guidance conversion, component/application checks, physical routing/placement checks, manufacturing-profile compilation, KiCad rule adapters, AI proposal boundaries, database persistence primitives, and a checked-in ten-scenario corpus;
- integration into net-class resolution, routing profiles, DRC lineage, zone-fill identity, FreeRouting DSN loss accounting, readiness, release evidence, and the PCB DRC panel.

This is a substantial working foundation and all automated build/test gates pass. It is not declared complete because the primary UI does not yet author/apply/revert constraint sets and several rule sources/consumers are not yet driven by one exact active program end to end.

## 2. Prerequisite results

The Stage 1–5 gate was run before Stage 6 implementation:

```text
npx vitest run data-integrity pin-pad-mapping locked-copper-integrity \
  net-reconciliation electrical-truth electrical-consistency readiness-policy \
  schematic-parity dsn-integrity read-ses autoroute-verification build-bundle \
  native-fab release-persistence stage-04-native-planes copper-policy drc-clearance \
  app/lib/atomic --reporter=dot
```

Result: **24 files passed; 169 tests passed**.

The gate verifies stable identities and pin/pad mapping, authoritative electrical truth, strict DSN/SES conservation, readiness unknown/stale behavior, native planes and same-net copper semantics, immutable atomic-part facts/evidence, project pinning, and exact-snapshot release behavior. Stage 6 was therefore not blocked by an earlier stage.

## 3. Rule-source inventory and migration matrix

| Existing source | Canonical treatment implemented | Live consumer state | Remaining work |
|---|---|---|---|
| Default/Power/HighCurrent net classes | Migrated to typed trace, clearance, via-diameter, and via-drill constraints | Net-class and new-route resolution read compiled lowering when active | A legacy rule delta added after migration is not yet forced through the constraint transaction automatically |
| Explicit per-net/class rule deltas | Stable selectors and typed numeric requirements; unsafe regex is omitted with a diagnostic | Migrated load/import paths are deterministic and idempotent | Replace the old latest-wins authoring path with preview/apply transactions |
| Name/topology power classification | Advisory deterministic inference requiring review | Never activated as hidden hard truth | Add the review/approval UI |
| Routing width/padstack preferences | Interactive choices are clamped by compiled hard minima | Manual new-route profile uses the compiled minimum | Convert preferences themselves into soft/project constraint sources |
| Manufacturing DRC presets | Converted into a manufacturing constraint document and compiled into the readiness candidate | DRC/readiness candidate uses the selected profile and conflicts block release | The ephemeral selected-profile program is not yet shared by every fill/router/export path before activation |
| Zone clearance/fill identity | Compiled hard clearance clamps a weaker zone override; program hash participates in fill revision | Stage 4 fill invalidates after constraint activation | Thermal/spoke/island settings are still partly direct zone fields |
| Stackup/layers | Stable layer targets and layer/via restrictions are representable | Static route checker and DSN loss ledger consume restrictions | Layer purpose, preferred direction, plane policy, and all stackup intent are not fully migrated |
| Placement policy/preferences | Typed fixed/side/orientation/region/proximity/group/loop rules and static checks | Constraint graph/static checker implemented | Existing placement preference fields and autoplace scoring are not fully driven by the program |
| DRC severity/ignore settings | Severity policy identity exists in the AST | DRC violations carry constraint lineage | Existing ignore/severity settings are not fully migrated; waiver must remain separate |
| Stage 5 claims/guidance | Exact approved/published snapshots convert to typed documents; prose/conflicting facts are excluded | Deterministic application checker implemented | Not yet wired automatically from every saved schematic/project into the active program and readiness flow |
| KiCad net classes | Clearance imports hard; preferred track/via defaults import soft | Standalone typed adapter and loss ledger | Existing KiCad project import/export route is not yet fully switched to this adapter |
| KiCad `.kicad_dru` | Bounded version-1 S-expression subset | Deterministic import/export with unsupported-loss records | Broader KiCad condition/function subset and full round-trip integration remain |
| Stage 3 readiness/waivers | Exact program/evaluation hashes and coverage become readiness evidence | Release evidence/manifest carry constraint identity | Deployed-database and multi-user activation tests remain |

## 4. Canonical language and type model

The schema version is `1`, compiler version is `sirkit-constraints/1.0.0`, and merge policy is `restrictive-algebra/1.0.0`.

Every definition carries stable ID, revision, name, domain, kind, scope, typed selector, optional pure condition, typed requirement, strength, severity policy, origin, evidence, lifecycle, waiver policy, lineage, and optional source location.

Supported domains are component, sourcing, schematic, application, manufacturing, PCB geometry, routing, placement, and release. Requirement forms include minimum, maximum, range, equality/inequality, allowed/forbidden/required sets, existence/cardinality, connection/prohibition, distance, containment, ordering, budget, tolerance target, soft objective, and required-checker coverage.

Quantities use decimal text and explicit dimensions/units. Internal conversion uses exact power-of-ten integer arithmetic rather than floating-point values. Scientific notation, non-finite values, dimension mismatches, and fractional canonical geometry are rejected.

Example:

```json
{
  "id": "project:usb:pair-skew",
  "revision": 1,
  "domain": "routing",
  "kind": "pair_skew",
  "scope": { "type": "project", "id": "project:usb" },
  "selector": {
    "objectType": "differential_pair",
    "predicate": { "kind": "ids", "ids": ["pair:usb"] },
    "cardinality": { "kind": "exactly", "count": 1 }
  },
  "requirement": {
    "form": "maximum",
    "value": { "dimension": "length", "value": "0.5", "unit": "mm" }
  },
  "strength": "hard"
}
```

## 5. Domains, scopes, selectors, and relationships

Selectors support stable IDs, membership, tags, bounded attributes, bounded globs, all/any composition, and explicit cardinality. Resolution produces a snapshot containing target IDs, target-set hash, design revision, state, and per-target reasons. Renaming an object does not change identity.

First-class relationship types include rail membership, decoupling, differential pair, bus membership, current loop, placement group, aggressor/victim, return reference, connector edge, test-point coverage, and termination. Differential pairs require explicit ordered positive/negative roles. Invalid/missing/duplicate members are compilation errors.

Relationship IDs may themselves be selected as typed pair/bus/rail/interface targets. The corpus exposed and fixed a compiler defect where such a target could be materialized twice; compiler target materialization is now stable-ID deduplicated and reports a type collision instead of producing false cardinality failures.

## 6. Precedence and merge algebra

There is no implicit last-wins precedence for active hard engineering truth.

| Input forms | Effective operation | Conflict condition |
|---|---|---|
| Minimum + minimum | Maximum of minima | — |
| Maximum + maximum | Minimum of maxima | — |
| Minimum/maximum/range | Feasible-range intersection | Lower bound exceeds upper bound |
| Allowed sets | Intersection | Empty intersection |
| Forbidden sets | Union | — |
| Required sets | Union | — |
| Equalities | Exact agreement | Incompatible equality values |
| Budgets | Most restrictive compatible limit | Incompatible aggregate/dimension |
| Connection relations | Accumulated relationship requirements | Missing/invalid relation |
| Soft objectives | Retained independently with explicit weights | Never weakens hard truth |

Manufacturing/component/project rules enter the same candidate. More-specific project intent cannot silently weaken a manufacturing minimum. Conflicts contain a stable ID, target/kind, minimal contributing constraint IDs, normalized values, explanation, and next actions. Results are independent of source and array order.

## 7. Compiler contract

`compileConstraintProgram` validates every runtime source document at the compiler boundary before canonicalization. Invalid documents return a rejected candidate with diagnostics and cannot partially activate.

Successful compilation binds:

- exact source-set revisions;
- design, catalog, variant, and manufacturing-profile revisions;
- compiler and merge-policy versions;
- resolved selector snapshots;
- active constraint IDs and relationships;
- effective rules and merge steps;
- diagnostics/conflicts;
- enforcement coverage;
- physical, schematic, component, routing, placement, readiness, and KiCad lowerings;
- a deterministic semantic program hash.

Program integrity can be recomputed before persistence. The cache key hashes the complete compilation input and is bounded/LRU-like; all authoritative revision changes miss the cache and change program identity.

Preview computes target, effective-rule, and coverage diffs. Apply performs compare-and-commit against the active program hash and current target revision, invalidates derived fills/evaluation, and appends an exact program/source snapshot. Revert restores an exact historical program/source snapshot.

## 8. Enforcement coverage matrix

| Rule family | Current support | Readiness meaning |
|---|---|---|
| Trace width, clearance, via dimensions | Enforced/lowered into PCB rules and DRC | Pass/fail when checker ran |
| Allowed/forbidden layers, via type/span/count, length/skew | Enforced by post-route static checker where inputs exist | Unknown/not-run/unsupported never becomes pass |
| Preferred layers, topology, relationship graphs | Compiled for consumer | Verification incomplete until a consumer proves it |
| Voltage/current/connection/decoupling/exposed-pad/DNC | Deterministic application checker exists | Evidence-bound result required |
| Fixed/side/orientation/region | Static placement checker | Pass/fail when geometry exists |
| Proximity/separation/group/current-loop optimization | Compiled for placement graph | Explicit Stage 7 coverage gap |
| Differential-pair routing graph | Compiled for routing graph | Explicit Stage 8 coverage gap |
| Target impedance | Unsupported without validated stackup/materials/field solver | Verification incomplete, never pass |
| Advisory/proposed inference | Inspectable, not active hard truth | Advisory only |

Every active constraint gets a coverage record. Required hard constraints in unsupported, unknown, not-run, or stale states block a false ready claim.

## 9. Component and application/ERC integration

Stage 5 guidance conversion accepts only an exact part revision whose lifecycle and evidence state permit use. Recommended operating limits remain distinct from absolute maximum claims. Conflicting, prose-only, or unapproved guidance is excluded with diagnostics rather than converted into numbers.

The application checker implements deterministic voltage compatibility, operating-versus-absolute-limit checks, DNC, exposed-pad, decoupling/cardinality, current budgets, and relationship-based connection checks. Violations retain the constraint ID, required value, actual value when known, checker identity, evidence IDs, and next action.

Current limitation: these services and tests exist, but the main schematic editing/readiness path does not yet compile every selected Stage 5 snapshot and run the application checker automatically.

## 10. PCB, manufacturing, DRC, zones, and router integration

- Board persistence performs identity migration followed by idempotent constraint migration.
- PCB semantic revision includes constraint sources, active program hash, and waivers.
- Net-class lookup reads compiled lowerings and reports contributing constraint IDs/program hash.
- Routing profiles prevent custom width/padstack choices from weakening compiled hard minima while retaining exact legacy class-padstack behavior on unmigrated boards.
- DRC results/violations carry program hash, composite rule-resolution hash, and constraint lineage.
- Selected fabrication presets become a constraint document compiled with the active source set before readiness.
- Zone-fill input identity contains the program hash and compiled clearance clamps weaker direct overrides.
- DSN exports aggregate compiled physical rules conservatively, retain program identity and a constraint-loss ledger, and block preflight on hard per-net layer/via semantic loss.
- Maximum-via-count requirements are explicitly marked for post-route verification.

Current limitation: the selected fabrication candidate is not yet activated/shared automatically with zone fill, interactive routing, DSN, and all export paths before those consumers run.

## 11. High-speed routing and placement

Typed intent covers explicit differential pairs/polarity, length/skew, allowed/preferred/forbidden layers, via type/span/count, impedance target, topology, return reference, fixed/side/orientation, region containment, proximity/separation, groups, and critical loops.

Name-based pair inference produces a low-confidence proposed constraint and never activates without review. The physical checker evaluates current track/via/placement facts for supported cases. Relationship graphs are deterministic inputs for later placement/routing engines.

No SI, impedance, route optimization, or placement optimization success is inferred merely from a declaration. Missing Stage 7/8 engines remain explicit coverage gaps.

## 12. Readiness, evaluations, and waivers

Stage 3 includes an `ENGINEERING_CONSTRAINTS` check. Readiness consumes a program and evaluation bound to exact revisions. Evaluation states remain distinct: pass, fail, unknown, unsupported, not-run, not-applicable, and stale.

Constraint compilation conflicts are non-waivable readiness failures. Fabrication-only readiness selects constraints relevant to the claim, so an unrelated SI solver does not falsely block a fabrication claim while still remaining visible as incomplete in the full engineering report.

Waivers are separate immutable records bound to exact constraint IDs, violation IDs, target IDs, design revision, program hash, and release profile. They require an independent requester/authorizer and may expire. A waiver never changes a failed underlying evaluation or effective rule.

## 13. Explanation examples

### Restrictive merge

```text
Target net:vin / trace_width
  legacy:default:width       minimum 0.25 mm
  project:power:width        minimum 0.80 mm
  fab:jlcpcb:width           minimum 0.15 mm
Operation: max(minima)
Effective: minimum 0.80 mm
Lineage: all three constraint IDs retained
```

### Conflict

```text
Target net:conflict / trace_width
  manufacturing minimum 0.50 mm
  project maximum       0.20 mm
Result: EMPTY_NUMERIC_FEASIBLE_RANGE
Activation: rejected; previous program remains active
```

### Component evidence

```text
Recommended operating range and absolute maximum are separate typed claims.
An absolute maximum cannot satisfy a recommended operating requirement.
Unknown/prose-only guidance produces unsupported/unknown coverage, not pass.
```

### Unsupported impedance

```text
90-ohm differential target is compiled and visible.
Without validated stackup/material and a field solver:
  support = unsupported
  readiness = verification_incomplete
  success is not claimed
```

The same effective-rule explanation service is exposed to API and agent tooling.

## 14. KiCad and import/export compatibility matrix

Target baseline: KiCad 10.

| External semantic | Adapter behavior |
|---|---|
| Net-class clearance | Imported as hard minimum |
| Net-class track width/via values | Imported as soft preferred defaults |
| `.kicad_dru` version 1 | Bounded S-expression parser |
| Net-name equality condition | Stable net-name mapping transformed into stable IDs |
| Clearance/track width/length/skew/via-count supported forms | Imported into typed requirements when representable |
| Unsupported function/property/constraint | Omitted from activation with explicit error loss |
| Syntax error/unsupported schema version | Complete imported set quarantined |
| KiCad rule ordering/severity override | Not silently reproduced; reported as transformed/unsupported |
| Exported supported physical rules | Deterministic `.kicad_dru` with program hash |
| Hard unrepresentable semantics | Error loss; verified export remains false |

Reference baseline used during implementation:

- https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html
- https://docs.kicad.org/10.0/en/pcbnew/pcbnew.pdf

## 15. AI, UI, and API transactions

API routes:

- `POST /api/constraints/preview` validates bounded documents, compiles a stateless preview, and returns target/effective/coverage diffs plus canonical source text.
- `POST /api/constraints/explain` returns target-specific matched rules, merge path, effective requirement, coverage, and program identity.

`ConstraintAgentTools` permits list, explain, propose, and preview only. AI proposals are draft/review-required, unsourced numeric proposals are rejected, and there is no agent activation or waiver bypass.

The PCB DRC panel shows the exact program hash, active constraint count, conflicts, incomplete coverage, and rule lineage on violations.

Current limitation: there is no primary constraint authoring editor/form with inline source diagnostics, preview diff, explicit apply/revert, inference review, and loss-ledger UI. Therefore the Stage 6 UI acceptance criteria are not complete.

## 16. Files added or materially changed

### Canonical engine

- `app/lib/constraints/types.ts`
- `app/lib/constraints/stable.ts`
- `app/lib/constraints/quantity.ts`
- `app/lib/constraints/parser.ts`
- `app/lib/constraints/selectors.ts`
- `app/lib/constraints/expressions.ts`
- `app/lib/constraints/merge.ts`
- `app/lib/constraints/compiler.ts`
- `app/lib/constraints/cache.ts`
- `app/lib/constraints/explain.ts`
- `app/lib/constraints/index.ts`

### Sources, migration, evaluation, and persistence

- `app/lib/constraints/board-model.ts`
- `app/lib/constraints/legacy.ts`
- `app/lib/constraints/manufacturing.ts`
- `app/lib/constraints/atomic-guidance.ts`
- `app/lib/constraints/inference.ts`
- `app/lib/constraints/transactions.ts`
- `app/lib/constraints/evaluation.ts`
- `app/lib/constraints/waiver.ts`
- `app/lib/constraints/server-repository.ts`
- `app/lib/db/schema.ts`
- `drizzle/0008_stage06_hierarchical_constraints.sql`
- `drizzle/meta/0008_snapshot.json`

### Checkers and adapters

- `app/lib/constraints/application-checker.ts`
- `app/lib/constraints/physical-checker.ts`
- `app/lib/constraints/drc-adapter.ts`
- `app/lib/constraints/kicad-dru.ts`
- `app/lib/constraints/agent-tools.ts`
- `app/lib/constraints/corpus.ts`

### Application integration

- `app/api/constraints/preview/route.ts`
- `app/api/constraints/explain/route.ts`
- `app/lib/pcb/types.ts`
- `app/lib/pcb/revision.ts`
- `app/lib/pcb/board-persistence.ts`
- `lib/persistence.ts`
- `app/lib/pcb/netclass.ts`
- `app/lib/pcb/routing-profile.ts`
- `app/lib/pcb/drc/*`
- `app/lib/pcb/dsn/*`
- `app/lib/pcb/readiness/*`
- `app/lib/pcb/zones/compute-fill.ts`
- `app/components/pcb/DrcPanel.tsx`
- `app/components/pcb/PcbEditor.tsx`

### Tests

- `app/lib/constraints/__tests__/parser-quantity.test.ts`
- `app/lib/constraints/__tests__/selector-merge-compiler.test.ts`
- `app/lib/constraints/__tests__/legacy-consumer-integration.test.ts`
- `app/lib/constraints/__tests__/transactions-evaluation.test.ts`
- `app/lib/constraints/__tests__/atomic-application.test.ts`
- `app/lib/constraints/__tests__/physical-routing-placement.test.ts`
- `app/lib/constraints/__tests__/kicad-api-agent.test.ts`
- `app/lib/constraints/__tests__/corpus-performance.test.ts`

## 17. Test and build evidence

| Command | Result |
|---|---|
| Stage 1–5 prerequisite command in section 2 | 24 files, 169 tests passed |
| `npx vitest run app/lib/constraints --reporter=dot` | 8 files, 41 tests passed |
| Focused constraints + readiness/DRC regression | 11 files, 63 tests passed before the final compiler-boundary test was added |
| `npx vitest run --reporter=dot` | 119 files passed, 2 skipped; 738 tests passed, 9 skipped (747 total) |
| `npx tsc --noEmit --pretty false` | Passed |
| Targeted ESLint over all Stage 6/touched integration paths with `--max-warnings=0` | Passed |
| `npm run build` | Passed; 47 static pages generated |
| `git diff --check` | Passed; only line-ending conversion notices |

The complete suite initially exposed two legacy via-profile regressions. They were fixed by distinguishing seeded legacy class padstacks from activated compiled hard minima. A subsequent full run passed.

One repository-wide performance test transiently exceeded its 250 ms limit under parallel suite load (302 ms) and passed isolated at 73 ms; the next complete run passed. This is recorded as a flaky timing observation, not hidden.

Repository-wide `npm run lint` still reports **30 errors and 15 warnings** in pre-existing React ref/effect and unused-directive sites outside the Stage 6 paths. Stage 6/touched-path lint is clean. The production build succeeds despite five existing Turbopack dynamic executable/file-tracing warnings involving Java/NGSpice.

Optional/environment-backed integrations were not asserted as passed: live KiCad CLI availability, deployed PostgreSQL migration/concurrency, external component databases, SI field solver, and Stage 7/8 optimization engines.

## 18. Corpus and performance report

The checked-in original corpus contains ten deterministic scenarios:

1. LED/resistor manufacturing minima.
2. MCU voltage domains, decoupling, reset/boot bias, programming access, and DNC intent.
3. Regulator input/output ranges, current budget, capacitors/ESR coverage, exposed pad, switch layer, loop, and thermal intent.
4. USB differential membership/polarity, impedance, skew, layer, return plane, termination, and ESD placement.
5. Power entry width/clearance, fuse relationship, and edge placement.
6. Four-layer layer/via/span/return-plane/thermal intent.
7. Crowded placement with hard room/fixed/side constraints and a soft routeability objective.
8. Conditional assembly-variant population rule.
9. Deliberately conflicting hierarchy rules.
10. Mixed supported/unsupported KiCad custom rules.

The performance fixture compiles 1,000 independently targeted hard rules twice under input permutation. Measured focused runs were approximately 0.35 seconds, with identical program hashes. Cache tests prove warm hits and invalidation when manufacturing-profile or design revision changes. Parser/KiCad adapters impose byte, depth, node, array, selector, and pattern limits.

## 19. Backward compatibility

- Constraint state is additive and optional on the board schema.
- Old boards load through identity repair and idempotent constraint migration.
- Existing projects without Stage 5 enrichment remain loadable.
- Release persistence was corrected to read stored raw project state rather than accidentally materializing a lazy migration and changing the semantic release revision.
- Existing class padstack behavior remains exact until a compiled hard minimum is active.
- Invalid migration/compilation leaves the prior active program untouched.
- The original source tree was not changed; all work remains in the protected copy/branch.

## 20. Remaining risks and exact unmet criteria

Blocking Stage 6 completion:

1. **Primary authoring UI:** no complete editor/form, inline diagnostics, target/merge/coverage preview, explicit apply/revert, inference review, and import/export loss-ledger workflow.
2. **Single live program across every consumer:** selected manufacturing candidates, Stage 5 application constraints, zone fills, manual routing, DSN, native/KiCad export, AI snapshots, and readiness are not yet guaranteed to share one exact active program/hash in every workflow.
3. **Complete legacy source migration:** stackup direction/plane intent, zone thermal/island settings, placement preferences, keepouts, DRC severity/ignore, and post-migration rule-delta authoring still have out-of-band state.
4. **Live schematic integration:** Stage 5 guidance/application checker is not automatically compiled/evaluated from every current project revision.
5. **Existing KiCad route integration:** the typed adapter is implemented and tested, but the existing application import/export routes are not fully switched to it; supported-subset full round-trip coverage is incomplete.
6. **Persistence deployment:** migration and repository code exist, but no live PostgreSQL migration, isolation/concurrency, rollback, or multi-user activation test was run.
7. **Required test matrix breadth:** high-value tests exist, but the full requested matrix (formula cycles/domain errors, every cardinality/hierarchy permutation, open-drain/ERC cases, all existing legacy rule fields, UI activation, and all cross-consumer hash equality) is not complete.
8. **Repository lint baseline:** full lint is not green because of unrelated existing React/unused-directive debt, although Stage 6 paths are clean and build/tests pass.

Non-blocking/later-stage gaps are intentionally honest: placement optimization quality (Stage 7), advanced routing/SI/impedance solving (Stage 8), and competitive benchmark engines (Stage 9+) are not claimed.

## 21. Final verdict

**STAGE 6 INCOMPLETE — the canonical typed language, deterministic compiler, restrictive merge/conflict model, coverage/evaluation/waiver foundation, key PCB/readiness integrations, persistence schema, adapters, security limits, corpus, and regression evidence are implemented; completion is blocked by the missing primary authoring/apply UI, incomplete migration of all live rule sources/consumers to one exact active program, incomplete live Stage 5/KiCad/database integration, and remaining required cross-consumer/security/UI test breadth.**
