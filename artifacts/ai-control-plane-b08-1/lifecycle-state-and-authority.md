# B08.1 — Lifecycle State Transitions, Fallback Authority, Server Truth

> **[CORRECTED BY B08.2]** This document is superseded where it claims:
> `authorizeBarePcbHistory (planner/test only)` — the grant was a PUBLIC
> export (forgeable) and the planner no longer authorizes at all (the
> repair route is a pure planning pass); the capability now lives in
> `pcb-bare-authority.internal.ts` (test-only, CI import gate), and the
> unauthorized-unbound refusal is `canonical_authority_missing`, not
> `session_retired`. The producer-ownership rows for autoroute/auto-place
> and repair OVERSTATED ownership: digest pins + single-flight flags +
> the retired-history wall were NOT lifecycle scopes — B08.2 gives every
> producer a submission-captured full-identity scope (gated side effects,
> AbortSignal to fetch/worker, request-keyed busy/finalizers,
> invalidate-on-adoption, generation authoritative over digest). The
> stale sync/qualify toasts are replaced by the `settleServerCommit`
> reconciliation-notice boundary. See
> `../ai-control-plane-b08-2/producer-ownership-matrix.md` and
> `reconciliation-truth-table.md`.

## History binding-state transitions

| from | event | to | mutation authority |
|---|---|---|---|
| (created) | createHistory | unbound | NONE (structured refusal) |
| unbound | authorizeBarePcbHistory (planner/test only) | unbound+authorized | legacy funnel (explicit) |
| unbound | bindCanonicalEditorSession | active | canonical executor only |
| active | session.dispose (lifecycle replacement/unmount) | retired (permanent tombstone) | NONE — session_retired refusal everywhere |
| retired | any | retired | NONE (can never be re-authorized or re-bound) |

Enforcement points: `commitPcbCandidate`, `applyEditsCanonical`,
select/move legacy branches (`legacyMutationAllowed`), plus the adapter's
own post-await `disposed` rechecks in `runCommit` and
`scheduleReconcile`, and the `disposed` guard in `persistEnvelope`.

## Lifecycle generations (PcbEditor `pcbLifecycleRef`)

Generation advances (aborting prior scopes) on: initial mount (boot),
`adoptBoardLifecycle` for checkpoint-restore / working-copy-restore /
server-authority-adoption / sync-adoption / qualification-adoption, and
`dispose()` on unmount (project change remounts via the B07.5 key).
`adoptBoardLifecycle` retires the old session SYNCHRONOUSLY (cleanup →
tombstone → generation advance) BEFORE dispatching the replacement board.

## Async producer ownership matrix

| producer | scope capture | side effects gated | stale behavior |
|---|---|---|---|
| hydration loadBoard | effect entry (`scope` + `cancelled`) | every adoptBoardLifecycle / cache / conflict stash / toast | late resolution ignored; restored board kept |
| sync preflight (handleSync) | no board adoption (plan only); dialog state current-generation UI | plan display | plan apply re-verified separately |
| sync apply (handleApplySync) | at submission | apply-failed toast, verification toast, cache, authority record, adoption, pendingPreflight, success toast, checkpoint | server committed → explicit "applied on the server … reconcile" toast; NOTHING local adopted/written |
| qualification (handleQualify) | at submission | failure toast, cache, authority, adoption, evidence, stale-notice clear, checkpoint, success toast | same reconcile-required semantics |
| autoroute / auto-place | base-digest pin + single-flight + retired-history refusal wall | board commit via gateway; completion toasts describe discard truthfully | stale base discards; retired history refuses |
| repair plan/preview/apply | serviceCurrent history-identity guard + preview base pin + gateway | all service calls | stale binding refused with truthful toast |
| autonomous layout commitSelected | expectedSourceRevision + gateway | commit | stale source refuses |

## Server-commit vs local-adoption truth table

| scope current | server committed | local adoption | cache/checkpoint/evidence | message |
|---|---|---|---|---|
| yes | yes (verified) | adopt via adoptBoardLifecycle | write | success |
| yes | no / failed | none | none | truthful failure |
| no | no / failed | none | none | scoped failure toast suppressed to the dead generation (ifCurrent) |
| no | yes | REFUSED — replacement board kept | REFUSED | "WAS applied on the server … board replaced locally … reconcile" (never 'canceled'/'unchanged'; never stale success) |
