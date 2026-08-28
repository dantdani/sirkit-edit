# B07.4 — Project Async Scope Contract

## The mechanism

`ProjectAsyncScopeRegistry` (app/lib/engineering/project-async-scope.ts) —
ONE per page lifetime, framework-free, behaviorally tested.

| Element | Meaning |
|---|---|
| `generation` | Monotonic counter bumped by every `beginProject` (hydration, switch, creation, import, recovery re-open). Project ID alone is NEVER used for currency — the same project can be rehydrated into a new session. |
| `identity` | `{projectId, branchId, session}` — the session is the exact captured object; commands submit to it, never to whatever ref is current later. |
| `AbortSignal` | One per generation; `beginProject`/`dispose` abort it (in-flight fetches cancel; abort is a CANCELLATION, never classified as provider failure). |
| tracked timers | Every `scope.setTimeout` is generation-owned: canceled at transition, guarded at fire time, and returns a cancel handle for effect teardown. No unowned `setTimeout` performs project writes anywhere in the page. |
| `requestId` | Unique per capture — owns busy flags, retries, streams. |

`capture({baseDigest?})` → `ProjectAsyncScope`:

- `isCurrent()` — registry not disposed AND generation unchanged;
- `ifCurrent(fn)` — scoped state application / error & completion reporting;
- `setTimeout(fn, ms)` — tracked + guarded, returns cancel;
- `signal` — pass to fetch;
- `session` — captured-session command submission
  (`runSchematicCommand(label, cmd, build, { scope })` → coordinator
  `stillCurrent` cancels stale submissions at execution position).

## Rules (enforced in page handlers)

1. Capture the scope BEFORE the first await (fetch, catalog preflight,
   screenshot, Promise.all).
2. Check `isCurrent()` after EVERY await and before any state write, queue
   submission, or user notification. Stale → cancel silently (or mark only
   the originating id-keyed activity log).
3. Submit commands with the captured scope; never let
   `schematicSessionRef.current` substitute for the captured session.
4. Report errors/completions through `ifCurrent` / `setScopedGenError`.
5. Busy flags: `active*Ref.current = scope.requestId` at start; in
   `finally`, clear only `if (active*Ref.current === scope.requestId)` — a
   stale completion can never clear a newer request's busy state.
6. Semantic pins compose: scope currency (project/session generation) AND
   `baseDigest` equality where the operation's meaning depends on the base
   (suggestions, replacement dialog, tier-1 sealing, AI/tidy adoption).

## Scoped suggestion batches

`ScopedSuggestionBatch` = `{items, scope, baseSchematicDigest, createdAt}`.
`evaluateSuggestionBatch(batch, currentDigest)` is THE apply gate:
stale project/session → refused; digest moved → refused ("never silently
rebase old findings"); both refusals clear the batch and surface a truthful
message BEFORE any request is built. An authoritative-mirror effect clears
the batch the moment any mutation supersedes its base; the transition reset
clears it on every hydration.

## Pinning tests

`__tests__/b07-4-project-async-scope.test.ts`: §1 registry generations /
aborts / timers / request-owned busy mechanism; §2 batch gating (project,
session-generation, digest, late-producer); §3 preflight command pinning
over a real coordinator+session (canceled-stale before execution;
same-project latest-head execution); §5 page-wiring supplements
(transition reset contents, dialog gating, immediate scoped checkpoint,
tier-1 snapshot compilation, scoped errors/busy/streams/timers).
