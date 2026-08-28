# AI Control Plane — B08.2: Unforgeable PCB Composition Authority and Complete Lifecycle Ownership

> **[CORRECTED BY B08.3]** Independent verification accepted the internal
> bare-authority boundary and the autoroute/auto-place/repair/AI-assist
> lifecycle work, but the "complete lifecycle ownership" claim was
> OVERSTATED: `handleSync` (bindings/publication/snapshot-revision/
> preflight/pendingPreflight/progress/dialog/toast) was entirely
> unscoped; `syncing`/`applyingRef`+`applying`/`qualifying` remained
> ambient booleans with unconditional finalizers; and qualification
> adopted an UNVERIFIED `loadBoard()` record (no revision/digest/identity
> check — the typed response even omitted `boardDigest`). See
> `../ai-control-plane-b08-3/` for the owned workflow layer, the
> request-owned operation registry, and the verified adoption contract.

## Why this stage exists

Independent B08.1 verification accepted the retired-history model and the
linearizable retirement but confirmed two remaining defects:

1. **Forgeable canonical bypass** — `authorizeBarePcbHistory` was a PUBLIC
   export (`editor-adapter.ts` → re-exported by `pcb-commit-gateway.ts:31`
   → leaked by `index.ts:12` `export * from "./editor-adapter"`). Any
   module could mint legacy whole-board mutation authority for an unbound
   history, so "product editor code never authorizes" was a convention,
   not a boundary. The refusal taxonomy also conflated never-bound
   histories with retired ones (both `session_retired`).
2. **Incomplete async ownership** — autoroute, auto-place, and repair ran
   on digest pins and ambient single-flight flags without lifecycle
   scopes; the B08.1 lifecycle owner carried a PARTIAL identity
   (`projectId` + hardcoded `branchId: "main"`); a same-digest checkpoint
   restoration could not invalidate in-flight candidate work; and the
   B08.1 suite asserted the PcbEditor wiring by SOURCE STRINGS.

## Defect 1 closure — bare authority is now unreachable, not just unused

- **Runtime bare authorization is ELIMINATED.** The only production
  grantor was the repair-agent route; its `ALLOWED_TOOLS`
  (`app/api/pcb/repair/agent/route.ts`) is entirely read/plan-only
  (getters, `run_drc`, `analyze_routeability`, …, `plan_drc_repairs`) and
  its system prompt forbids applying changes — the route is a pure
  planning pass whose board is discarded. The grant call was removed;
  `planRepairs` works on a plain, powerless bare history (proven
  behaviorally in b08-2 test 4).
- **The capability is an internal module** —
  `app/lib/engineering/pcb-bare-authority.internal.ts` (the B03.2
  `interactive-channel.internal.ts` precedent): it owns the
  `BARE_AUTHORIZED` WeakSet, `authorizeBarePcbHistory` (grant — refuses
  active/retired), and `isBareHistoryAuthorized` (check). It is NOT
  exported from `index.ts` or the gateway; the gateway re-export at
  line 31 is deleted; `editor-adapter.ts` no longer defines or exports
  either function. Only test harnesses import the grant.
- **Import-boundary gate** (b08-2 test 5): a CI source walk pins the
  approved importer set — `editor-adapter.ts`, `pcb-commit-gateway.ts`,
  `select-move.ts` (checks only) and the internal module itself — AND
  separately asserts NO production file calls `authorizeBarePcbHistory(`.
- **Behavioral unforgeability** (b08-2 tests 1–2): `import * as` over the
  engineering barrel and the gateway shows no bare-authority export (name
  scan bans `/bare/i`), and a bare history driven through everything the
  public surface offers stays at exactly zero mutation (board reference
  identity, digest, entry count).
- **Taxonomy split** (b08-2 test 3): retired → `session_retired`
  (`HISTORY_RETIRED`); never-bound without capability →
  **`canonical_authority_missing`** (`HISTORY_UNAUTHORIZED_BARE`) in
  `commitPcbCandidate`, with matching distinct `applyEditsCanonical`
  errors ("…retired…" vs "…no bare-history capability…"). The
  `CanonicalCommitResult` reasonCode union carries both codes.

## Defect 2 closure — full-identity, generation-first lifecycle ownership

**`app/lib/pcb/lifecycle/board-lifecycle.ts`** (framework-free production
module):

- `PcbBoardLifecycleOwner` — identity is the FULL
  `{tenantId, projectId, branchId, boardId}` taken verbatim from the
  durable sync scope (demo/local editors use an explicit local sentinel —
  never a fake "main" branch). `adopt()` ALWAYS advances the generation
  and aborts the previous generation's AbortSignal — same-digest
  checkpoint restoration still invalidates every earlier scope
  (generation authoritative, digest pins only narrow). `capture()` scopes
  carry identity + generation + unique `requestId` + optional
  `baseDigest` + `signal` + `isCurrent()/ifCurrent()`.
- `settleServerCommit` — THE reconciliation-notice boundary for verified
  durable server commits whose scope went stale: `adopt` (current) /
  `reconcile-required` (same board identity → a display-only
  `PcbServerDivergenceNotice` addressed to the ACTIVE generation) /
  `discard` (identity changed or owner disposed → NOTHING is written).
  `divergenceNoticeCurrent` retires a recorded notice on any later
  adoption or identity change.

**PcbEditor** (`app/components/pcb/PcbEditor.tsx`):

- `pcbLifecycleRef` is now a `PcbBoardLifecycleOwner`;
  `boardLifecycleIdentity` replaces the hardcoded
  `projectId/branchId:"main"` partial identity.
- `adoptBoardLifecycle` retires the session synchronously (unchanged),
  then `owner.adopt(identity)` + bumps a `lifecycleGeneration` state that
  (a) runs the hook-invalidation effect and (b) remounts AssistBox
  (`key={assist-generation-N}`) so pending AI chips die with the board.
- `handleApplySync`/`handleQualify` route EVERY verified-server-commit
  settlement through `settleServerCommit`; the stale path calls one
  dedicated `settleStaleServerCommit` recorder (divergence state + toast,
  rendered as a self-retiring banner `data-testid="server-divergence-banner"`)
  and NEVER adopts/caches/checkpoints/writes evidence/toasts success.
  A cross-project/branch settlement is discarded entirely.
  (Deliberate: the sync/qualify fetches do NOT take the scope signal — the
  response is required to know whether the server durably committed, which
  the reconciliation boundary then classifies.)
- Hooks receive `captureLifecycle`; the AI ownership passed to AssistBox
  and net-class briefs composes the page's B07.5 project generation AND
  the board lifecycle scope.

**Hooks** (`useAutoroute` / `useAutoPlace` / `usePcbRepair`):

- Scope captured at SUBMISSION (and again at auto-place apply), verified
  after EVERY await before EVERY side effect: progress writes, elapsed
  timers, previews/candidates, results, errors, toasts, `onApplied`,
  state transitions. Stale outcomes (success or failure) are discarded
  silently — the dead generation owns no UI.
- `scope.signal` aborts the autoroute fetch and the repair fetches and
  terminates the auto-place worker on lifecycle replacement (listener
  removed in the finalizer).
- Busy ownership is REQUEST-KEYED (`requestId`): a stale in-flight run no
  longer blocks a fresh-generation run, and a stale finalizer can never
  release a newer run's flag; auto-place candidates carry their scope so
  `apply()` refuses stale previews even when the digest pin still matches.
- Every hook exposes `invalidate()` — called by the editor's
  generation effect: abort/terminate, discard previews/candidates/plans,
  reset busy/progress/state silently.

## Mandatory behavioral tests (no source-string satisfaction)

- `b08-2-authority-boundary.test.ts` — 5 tests (barrel/gateway cannot
  mint authority; bare history powerless with exact zero mutation;
  taxonomy split; authority-free planning composition; import-boundary +
  no-production-grant gate).
- `b08-2-async-ownership.test.tsx` — 7 tests against the REAL hooks +
  AssistBox with a real owner: (6) autoroute abort-on-replacement +
  fresh-generation usability, (7) request-keyed busy release with an
  abort-ignoring zombie request, (8) worker termination, silent, (9)
  same-digest replacement kills the placement preview at apply
  (generation beats digest), (10) repair plan race discard + native
  fallback usability, (11) verify-after-every-await with an
  abort-ignoring late response, (12) stale AI assist response discarded.
- `b08-1-lifecycle-hardening.test.ts` — the B08.1 SOURCE-STRING wiring
  test is REPLACED by behavioral coverage of the owner + the
  reconciliation boundary (checkpoint-restore race → reconcile notice;
  notice retirement; cross-identity discard; dispose discard); T10's
  unauthorized-bare expectation moved to `canonical_authority_missing`;
  the §3 mechanism test runs on the new full-identity owner.

## Verification (observed on this tree)

- B04+B06+B07+B08+B08.1+B08.2 gate: **303 passed** (the accepted 291 +
  12 new/updated behavioral tests).
- PCB domain sweep (`app/lib/pcb` + `app/components/pcb`): 762 passed /
  4 skipped; 3 failures are the DOCUMENTED parallel-load perf flakes
  (route-tool perf, auto-place 100-footprint, pcb-repair-agent snapshot
  perf) — all pass in isolation (25/8/8).
- `npx tsc --noEmit` clean; ESLint clean on every changed file
  (pre-existing baseline unchanged).
- Full suite: see the final report (documented flaky set isolated-rerun).

## Files

`capability-boundary.md` (export/import boundary matrix + authorized
compositions), `producer-ownership-matrix.md` (per-producer scope
capture / gated side effects / abort wiring / busy keying / invalidation),
`reconciliation-truth-table.md` (server-commit settlement outcomes),
and the race fixtures inline in the two b08-2 suites.

## Corrected prior artifacts

`artifacts/ai-control-plane-b08-1/README.md` and
`lifecycle-state-and-authority.md` are corrected in place (addendum
markers): the B08.1 producer-ownership rows overstated
autoroute/auto-place/repair ownership, the authority table's public grant
is superseded by the internal capability, and the unauthorized-bare
reason code changed.
