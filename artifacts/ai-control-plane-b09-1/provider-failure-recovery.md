# B09.1 — Provider Failure Recovery (NDJSON path)

Pre-B09.1: `run_failed provider_*` events rendered a message ending
"Choose an action below." but never set `aiProviderFailure` — the
existing owned Retry / Use-other-provider card (B07.5 contract) was
absent.

Now:

- `dispatchAiProviderFailure` (app/lib/ai-preferences.ts) is the ONE
  owned dispatch path for the global `sirkit:ai-provider-failure` event.
  The legacy JSON flow (`throwAiResponseError`) delegates to it; the
  NDJSON flow in `send()` calls it for every `provider_*` failure EXCEPT
  `provider_cancelled` (cancellation is never a provider failure).
- The dispatched detail carries the run's pinned provider (captured at
  submission), an OWNED retry closure, and a listener-side `stillCurrent`
  re-check — B07.5 guarantees preserved end to end:
  - a stale owner (project switched / generation retired) dispatches
    NOTHING;
  - a retry closure whose owner went stale after dispatch is inert;
  - the page listener drops events whose `stillCurrent()` is false.
- Retry = a fresh `send(text)` — a NEW run with a new run id; the failed
  run is never resumed or replayed. Provider switch uses the existing
  card action (new run on the other provider by the user's choice — no
  automatic fallback).
- Reason classification (`provider_insufficient_quota`, `provider_rate_limit`,
  `provider_authentication`, …) is preserved verbatim from the loop's
  structured `run_failed` reason; no raw upstream bodies/headers surface.

Proof: b09-1-recovery.test.tsx (current-owner dispatch for BOTH providers
with functioning owned retry; stale-owner silence; post-dispatch staleness
inertia + listener re-check; the cancellation/deadline exclusion contract).
Live quota/unavailable rendering on funded accounts remains **UNKNOWN**
(no credits); the B09 browser evidence already showed the classified
failure text rendering for both providers through this same event path's
message channel.
