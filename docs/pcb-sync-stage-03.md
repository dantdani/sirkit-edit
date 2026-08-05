# Stage 3 PCB synchronization: safety preflight and atomic plan application

## Purpose and product truth

Stage 3 turns schematic-to-PCB transfer into two explicit operations: a read-only complete preflight, followed by a separately authorized application of one immutable plan. It consumes Stage 2 footprint-resolution results and existing verified mapping certificates. It never guesses a package, footprint, pin mapping, power net, or board repair.

Stage 3 does not place for quality, route, repair copper, fill zones, prove manufacturability, or verify a new pin-pad mapping. Newly added parts receive only deterministic staging coordinates so a later placement stage can act.

## Supported capability profile

| Capability | Stage 3 status |
|---|---|
| New Sirkit JSON board | Supported by engine/tests |
| Existing empty/placed unrouted Sirkit JSON board | Supported when every change is explicit and safe |
| Metadata-only refdes update on routed board | Supported with exact copper/state preservation checks |
| Footprint replacement/removal or net topology change on routed/zoned/constrained/locked board | Previewed and blocked for Stage 8 |
| Arbitrary `.kicad_pcb` parse-modify-write | Unsupported; no lossless parser transaction is proven |
| Browser-local production project persistence | Legacy only; not a qualified Stage 3 transaction store |
| Server qualification repository | In-memory only; restart durability is unproven |
| Router handoff | Emitted only after successful commit |

The strict rollout verdict is therefore `BLOCKED`; the engine is implemented but cannot become production authority yet.

## Versioned contracts

- Preflight request/result: `sirkit.pcb-sync-preflight-request.v1`, `sirkit.pcb-sync-preflight-result.v1`.
- Snapshot: `sirkit.pcb-sync-snapshot.v1`.
- Policy: `sirkit.pcb-sync-policy/1.0.0`, policy `sirkit.safe-pcb-sync@1.0.0`.
- Plan: `sirkit.pcb-sync-plan.v1`.
- Apply request/result: `sirkit.pcb-sync-apply-request.v1`, `sirkit.pcb-sync-apply-result.v1`.
- Audit: `sirkit.pcb-sync-audit.v1`.
- Router handoff: `sirkit.pcb-router-handoff.v1`.
- Engine/board adapter: `sirkit.pcb-sync-engine/3.0.0`, `sirkit.json-pcb-board-adapter/1.0.0`.

The TypeScript source of truth is `app/lib/pcb-sync/types.ts`. Requests pin tenant/project/branch/design, schematic revision, assembly variant, target board/revision, Stage 2 policy, Stage 3 policy, actor, mode, and time. Client API scope is overwritten from authenticated headers.

## Authoritative snapshot

`PcbSyncSnapshotProvider` freezes one scope-bound snapshot containing project/design/schematic/component-set/net-graph/variant/library/constraint revisions, stable component and pin identities, stable nets, prerequisite issues, and an optional validated new-board template. `authoritativeSnapshotDigest` canonicalizes array/set-like ordering and board semantic payload. A digest, scope, revision, variant, duplicate identity, or size failure stops Stage 2 before it is invoked.

The public HTTP API intentionally has no snapshot, board-content, or filesystem-path upload operation. A trusted server coordinator must register snapshots. This missing production coordinator is a rollout blocker, not a reason to trust browser input.

## Stage 2 integration and forbidden fallback

Every applicable component is resolved for `layout_transfer`, exact assembly variant, and exact component revision. Components are sorted, sent in deterministic batches of at most 256, with at most four batches concurrent, then merged and checked for an exact complete component set, policy, purpose, and variant. Only `status === resolved` can advance.

`AtomicPcbSyncResourceProvider` reloads the published atomic revision server-side, checks asset version, content digest and mapping-certificate identity, checks raw blob encoding/hash, parses the immutable footprint, and constructs a materialization digest. There is no import of `netlist-bridge`, `guessPackageToken`, `heuristicFootprint`, or `footprint-assign`; a static test and `ForbiddenLegacyResolverGuard` protect this boundary.

## Stable reconciliation and connectivity

Components match by `componentInstanceId`. Refdes changes are metadata. Exact footprint equality requires binding revision, asset version, content digest, symbol version and mapping certificate. Existing duplicates or mismatches block.

Nets match by `stableNetId`; names and aliases are display metadata. Every schematic net member must resolve through a verified mapping entry to exact pad numbers. Pad ownership conflicts, unmapped pins, label collisions, unintended merge/split and stable-identity mismatch block. Power and ground classifications are preserved but never used to invent missing connectivity.

## Board inspection and risk

The inspector classifies `new_board`, `empty_unrouted`, `unplaced_unrouted`, `placed_unrouted`, `locked_unrouted`, `routed`, `zoned`, `constrained`, or `unsupported`. Tracks, vias, zones, locks, constraints and unknown root constructs influence risk independently. Zones count as copper even when no tracks exist. Unknown constructs block rather than being dropped.

Allowed automatic risks are `none`, `metadata_only`, and `unrouted_structural`. `placement_affecting`, `copper_affecting`, `constraint_affecting`, `destructive`, and `unsupported_unknown` cannot cross the safe Stage 3 boundary. Policy validation rejects attempts to weaken routed-board or lossless-model gates.

## Status, gate, and issue behavior

Top-level statuses are `ready_no_changes`, `ready_to_apply`, or one of the explicit blocked/error categories for resolution, mapping, net integrity, board risk, staleness, conflict, support, authorization or system error. Component and net assessments retain stable IDs, display refs, resolver evidence, proposed operation/risk and all blockers. Issues contain code, severity, scope, stable/display identities, safe message, remediation category, evidence, causes, retryability and help key.

Representative stable issue families:

- snapshot/request: `PS_SNAPSHOT_DIGEST_MISMATCH`, `PS_SNAPSHOT_SCOPE_MISMATCH`, `PS_SCHEMATIC_REVISION_MISMATCH`, `PS_VARIANT_REVISION_MISMATCH`, `PS_SNAPSHOT_LIMIT_EXCEEDED`;
- resolver/component: `PS_RESOLVER_BATCH_COMPONENT_SET_MISMATCH`, `PS_COMPONENT_UNRESOLVED`, `PS_COMPONENT_IDENTITY_DUPLICATE`;
- asset/mapping: `PS_MATERIALIZATION_MISSING`, `PS_MAPPING_PIN_MISSING`, `PS_MAPPING_VERIFIER_UNSUPPORTED`, `PS_ASSET_IDENTITY_MISMATCH`;
- net: `PS_NET_MEMBER_MAPPING_MISSING`, `PS_PAD_NET_CONFLICT`, `PS_ROUTED_NET_CHANGE_REQUIRES_STAGE8`;
- board: `PS_BOARD_REVISION_MISMATCH`, `PS_BOARD_CONSTRUCT_UNSUPPORTED`, `PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8`;
- apply/storage: `PS_PLAN_STALE`, `PS_PLAN_DIGEST_MISMATCH`, `PS_BOARD_LOCK_TIMEOUT`, `PS_STAGED_*`, `PS_COMMIT_RESULT_UNCERTAIN`.

Results and blockers are deterministically sorted. Preflight always reports `summary.boardChanged: false`.

## Exact plan and lifecycle

Plans contain sorted explicit operations, blocked operations, prerequisite gates, exact resolver evidence/materializations, expected output, policy versions and snapshot identities. Operation kinds cover create/add/preserve/metadata/refdes/value/net/pad/unrouted replacement/removal/DNP/no-op. No hidden mutation is allowed.

Technical plan identity excludes actor, timestamps, lifecycle and display-only summaries, so request IDs/times and harmless input ordering do not churn a plan. It includes scope, frozen snapshot, exact operations, blocked operations, prerequisites, exact asset/mapping materializations and expected output. Lifecycle is `draft -> validated -> applicable -> applying -> applied`, with stale/aborted/failed terminal alternatives enforced by `lifecycle.ts`. Preview plans remain `validated`; only `prepare_apply` can create an `applicable` plan.

## Apply, atomicity, and recovery

Apply requires a human PCB editor/admin, exact scope, plan ID/digest, lifecycle `applicable`, `apply_exact_plan`, idempotency key and non-expired plan. Under a per-board bounded lock it reruns the entire preflight and requires the same technical plan digest. It then:

1. clones the current board/template;
2. executes only decoded plan operations;
3. serializes and reparses the staged board;
4. validates exact component/net sets, exact asset/mapping/binding identity, exact pad-to-net assignments, uniqueness and canonical serialization;
5. proves tracks, vias, zones, texts, silkscreen, keepouts, routing history, stackup, outline, constraints and net classes remain unchanged when an existing board is updated;
6. atomically commits board, applied plan, audit and replay result;
7. emits router handoff after commit.

Precommit failures restore plan applicability and leave board/audit/replay unchanged. A postcommit response failure returns `recoverable_commit_uncertainty`; retrying the same idempotency key retrieves the committed result. The in-memory adapter proves transaction semantics and concurrency but not process-restart durability.

## API and UI boundary

`POST /api/pcb-sync` accepts `preflight` or `apply`; `GET` reports rollout/capability truth. JSON is capped at 8 MB, `application/json` is mandatory, and client snapshot/board/path fields are rejected. Apply is denied in `off`/`observe`, requires `opt_in` or `authoritative_safe_profile`, plus `X-Sirkit-Pcb-Sync-Opt-In: true`. The default runtime is qualification-only and cannot become authoritative without a trusted snapshot coordinator and durable repository.

`PcbSyncReadinessPanel` labels preview versus apply, says `Board unchanged`, shows target class, exact counts/risks/all blockers/stable IDs, states that Stage 3 does not place or route, and requires a checkbox before calling apply with exact plan ID/digest. It is intentionally not wired over the legacy production button while rollout is blocked.

## Rollout, router handoff, and observability

Rollout sequence: `off` -> `observe` -> `opt_in` safe test boards -> `authoritative_safe_profile` -> retire bridge decisions. Rollback is whole-feature only; new preflight may never fall back per component. Comparison categories expose legacy guesses, partial mutation and risk without changing production behavior.

Telemetry records pseudonymized project identity, engine/policy versions, counts, status, blocker codes, operation/risk, board class, durations, apply/commit/recovery/handoff. It never stores raw tenant/project, raw schematic, board, component values, API keys or paths. Router handoff contains exact committed revision/digest, plan/audit IDs, variant, counts and placement/routing state and is valid only against the current board record.

## Performance and operational budgets

- request: 4,096 components, 32,768 nets, 131,072 operations, 8,192 trace steps;
- Stage 2: batches of 256, four batches concurrently; resource parsing chunks of 16;
- lock: 2 seconds; plan TTL: 15 minutes; API JSON: 8 MB;
- qualification budgets: small preview under 2 s; 500-component fully blocked preview under 10 s.

Measured Windows x64/Node 24 results are in `artifacts/footprint-binding-stage-03/qualification-evidence.json`: small preview mean 5.556 ms/p95 7.059 ms; complete 500-component blocked result 515.259 ms and 1.868 MB; sixteen concurrent previews 44.065 ms with one stable plan digest.

## Worked examples

- Exact mapped new board: `ready_to_apply`; plan creates board/net/component and verified pad assignment; apply emits audit and router handoff.
- Generic `J1`: `blocked_component_resolution`; exact `J1` reference shown; no board created.
- Value-only `100n`: blocked; output contains no `0603` inference.
- Missing pin mapping: `blocked_mapping`; exact component/pin finding; no partial ready-component transfer.
- Existing supported unrouted change: explicit add/replace/net operation with staging/validation/atomic commit.
- Routed footprint change: blocked operation remains visible with Stage 8 reason; copper is byte-equivalent in the Sirkit JSON model.

## Remaining qualification work

Implement and prove a durable transactional repository and trusted server snapshot coordinator, crash/restart recovery, isolated PostgreSQL migration apply/rollback/restart, arbitrary KiCad adapter only if a lossless parser exists, full browser integration/cutover, review nine skipped repository tests, and clear unrelated broad lint debt. Until then `SIRKIT_PCB_SYNC_STAGE3=off` is the correct production setting.

