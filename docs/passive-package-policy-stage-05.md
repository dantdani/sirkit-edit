# Project Passive-Package Policy — Stage 5

## Purpose and boundary

Stage 5 reserves a physical package/footprint for a narrowly supported ordinary passive after deterministic checks. It does not select a purchasable manufacturer part, prove ratings or derating, certify availability/manufacturability, alter connectivity, or edit a PCB. Every result explicitly reports `manufacturingReady: false`, `selectsExactPart: false`, `mutatesSchematic: false`, and `mutatesPcb: false`.

Rollout is default-off under `SIRKIT_PASSIVE_POLICY_STAGE5`. The current implementation is qualification-only because Stages 1–4 lack the required durable cross-domain transaction and restart evidence.

## Authority contracts

- Stage 1 supplies stable project/component/variant identity and exact selected bindings. A current approved effective Stage 1 selection suppresses policy evaluation.
- Stage 2 owns final footprint resolution. The opt-in Stage 5 adapter contributes at reserved rank 6, below selected/exact/component/symbol/package authorities. Default policy `1.0.0` still disables it; qualification policy `1.1.0-stage5-passive-policy` requires explicit service opt-in.
- Stage 3 plans retain component-level resolver dependencies. Policy publication/revocation stales affected unapplied plans without changing a board.
- Stage 4 owns pin/package-terminal/pad verification. Profiles accept only approved/current/active/conflict-free `verified` mappings at `exact_part`, `package_family`, or `curated_pair`; `limited_direct_pair` is forbidden.

## Supported capability

The conservative qualified profile includes ordinary nonpolar SMD resistors and MLCC capacitors only, for roles such as decoupling, bypass, pull-up/down, bias, ordinary series signal, LED current limiting, and generic noncritical use. A rule must name the class, role, required typed facts, explicit package profile revision, assembly variant, precedence, exclusions, and evidence.

Mandatory exclusions cannot be overridden: polarized, bulk energy storage, high voltage/mains/safety, high power/current, pulse/surge, current sense/shunt, precision/low-tempco, RF, timing critical, ripple/DC-bias critical, networks/arrays, adjustable, power magnetics, unknown class/role/risk, and all unsupported inductor/ferrite/thermistor/varistor/fuse/diode/LED/crystal/connector/switch/electromechanical/IC cases. Those require exact-part or later human resolution.

## Modes

1. `exact_part_required`: package compatibility can be acknowledged only after an approved exact binding is compatible; policy never creates that exact part.
2. `characterized_generic`: all rule-required characterized facts must be exact or explicitly approved inference. The result remains layout-only and lists manufacturing gaps.
3. `layout_reservation`: explicitly enabled and allows only rule-named unknown facts. Every permitted unknown becomes a warning and manufacturing gap. It is never a silent default.

## Typed facts and package identity

Facts preserve `exact`, `approved_inference`, `unknown`, `conflicting`, or `stale`, source/evidence references, and optional approver/time. Class, subclass, role, technology, polarity, value/rating quantities, application risks, variant, domains, and tags remain separate. Reference designator, value text, and position never infer role or risk.

The value parser is bounded, dimension-specific, SI-normalized, and rejects wrong units, controls, commas, overflow, and underflow. It accepts forms such as `100nF`, `10k`, `4K7`, and `0.1W` only when the caller supplies the intended dimension.

Bare chip codes are ambiguous and rejected. `0603 imperial / 1608 metric` is one explicit identity; `0603 metric` means `0201 imperial / 0603 metric` and is materially distinct. A package profile pins one explicit normalized identity, exact immutable footprint asset/content digest, one accepted Stage 4 mapping revision/result/dependency digest, allowed classes/technologies/ranges, assembly profiles, lifecycle/approval/freshness, and evidence.

## Declarative rules and decisions

Rules are data, not executable code. Limits are 256 rules, 128 exclusions, 2,048 exceptions, 64 matcher terms, 128 profiles, 4,096 preview components, 4,096 trace steps, 8 MB result, 5 s evaluator budget, and 2 s scope-lock budget.

Evaluation freezes one trusted context, validates schemas/digests/scope/lifecycle, applies exact override and mandatory exclusions, checks approved exceptions/global exclusions, evaluates every enabled rule, validates profile/mapping/assembly feasibility, and then chooses maximum specificity followed by maximum priority. Equal winners that select the same immutable profile merge with provenance; materially different equal winners produce `conflicting_rules`. Array order never breaks a tie.

Approved component exceptions can opt out, require an exact part, or assign one approved profile. Contradictory current exceptions block. Exact Stage 1 selection remains higher authority.

## Lifecycle, preview, and invalidation

Lifecycle is draft → validate → ready for review → approve → publish. Revocation and successor creation preserve immutable history. Editing, approval, and publication are role-separated; policy authority requires a human. Digests bind technical content, approval binds that digest, scope locks plus optimistic revisions prevent concurrent publication, and idempotency keys return the original result.

Preview evaluates the complete trusted project/variant snapshot in deterministic 16-component chunks. It reports status coverage, changed component IDs, profile/gap counts, affected Stage 2 dependencies, affected Stage 3 plans, routed-board risk IDs, and `boardChanged: false`.

Stage 2 cache remains disabled. Publication computes precise component dependency keys. Stage 3 invalidates only validated/applicable plans whose resolver evidence names an affected component. Applied board data is untouched. The current in-memory policy commit and Stage 3 invalidation are not one crash-safe durable transaction; this is the decisive production blocker.

## API, UI, security, and operations

`/api/passive-policy` requires authenticated tenant/project/branch/actor/role headers, JSON, and a 64 KB limit. It accepts scoped IDs/operations only; client-uploaded facts, profiles, contexts, snapshots, assets, mappings, evidence, paths, URLs, and files are rejected. Read-only evaluation/history/preview require rollout above `off`. Lifecycle mutation additionally requires `opt_in`, an acknowledgement header, human authority, appropriate role, expected revision/digest, and idempotency key. Public creation/editing of authoritative policy content is intentionally absent while blocked.

`PassivePackagePolicyPanel` is an unmounted read-only review component that shows active state, mode, exact normalized package, rule count, blockers, preview impact, and the permanent manufacturing warning.

Metrics contain pseudonymous project scope, versions, operation/status/mode/reason counts, and timing only. Raw facts/evidence/project content/secrets are excluded. No cache exists, avoiding stale authority. Cancellation propagates through context collection and preview chunks.

## Worked examples

| Input | Result | Explanation |
|---|---|---|
| Approved 100 nF nonpolar MLCC decoupler with working voltage, characterized mode | `eligible_characterized_generic` | Exact profile/asset/mapping may reserve layout; exact part, ratings/derating, supply, assembly and manufacturing evidence remain gaps |
| Same 100 nF decoupler with explicitly permitted unknown working voltage, reservation mode | `eligible_layout_reservation` | Warning plus named working-voltage gap; layout redesign may be needed |
| `100n` text without approved class/role/rating facts | `missing_required_facts` or `unsupported` | Value text does not infer MLCC, decoupling, voltage, package, or safety |
| 10 µF bulk capacitor | `excluded_specialized_role` | Bulk behavior requires exact electrical/physical decision |
| Polarized capacitor | `excluded_safety` | Mandatory exclusion |
| Approved ordinary 10 kΩ pull-up and power fact | `eligible_characterized_generic` | Conservative profile may reserve layout; no exact part/manufacturing claim |
| Current-sense/high-power resistor | `excluded_specialized_role`/`excluded_safety` | Exact part and specialized validation required |
| Current approved Stage 1 binding | `not_applicable` policy outcome | Exact selection wins; Stage 2 uses rank 1 |
| Bare `0603` | parser error `PP_PACKAGE_ALIAS_AMBIGUOUS` | Metric/imperial meaning is not guessed |
| Equal winning rules selecting 0603 and 0805 profiles | `conflicting_rules` | Human/policy correction required |

## Legacy defaults and retirement

Discovery identified refdes/package-token defaults in `lib/footprint-assign.ts`, `app/lib/pcb/package-map.ts`, and `app/lib/pcb/netlist-bridge.ts`. Stage 5 imports none of them and never legitimizes their hard-coded 0603 behavior. They remain in the live legacy path because the durable Stage 1–4 cutover is not qualified. Retirement requires migration into explicit Stage 1 binding candidates, shadow comparison, durable transaction/restart proof, then removal from the authoritative path—never silent reinterpretation.

## Verification

Focused tests live under `app/lib/passive-policy/__tests__`, `app/api/passive-policy/__tests__`, and `app/components/pcb/__tests__`. Machine evidence is `artifacts/footprint-binding-stage-05/qualification-evidence.json`. The exact final command matrix and any unrun/failed checks are recorded in `SIRKIT_FOOTPRINT_BINDING_STAGE_05_IMPLEMENTATION.md`.
