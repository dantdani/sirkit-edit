# Section G — provider-failure recovery proven through production code

## Defect

The B09.1 recovery tests exercised a test-local lookalike of the page's
`run_failed` settlement; the actual `page.tsx` logic (classification,
ownership gating, retry/switch wiring) was untested production code.

## Production changes

### `app/lib/agent/run-consumer.ts` (new production module)

- `isRecoverableProviderFailure(reason)` — `provider_*` except
  `provider_cancelled`.
- `settleAgentRunFailure({reason, provider, ownership, startNewRun})` —
  ownership gate FIRST (a stale run settles nothing), then classification,
  then `dispatchAiProviderFailure` (the B07.5-owned global event) with the
  injected new-run starter as the retry.
- `resolveProviderSwitch` / `performProviderSwitch(failed, {selectProvider,
  startNewRun})` — the switch SELECTS the alternative provider before
  starting the new run; a missing retry handle still performs the selection.

### `app/page.tsx`

Delegates to the module: the NDJSON `run_failed` consumer calls
`settleAgentRunFailure` with `provider: runProvider`, an ownership adapter
over the captured `ProjectAsyncScope` (`isCurrent: () => scope.isCurrent()`),
and `startNewRun` = a fresh `send(text)` (new scope, new AbortController).
The Switch button calls `performProviderSwitch(failed, {selectProvider:
selectAiBrain, startNewRun: lastAiRetryRef.current})`.

## Test results (`b09-2-recovery.test.tsx`, jsdom, production imports only)

| Case | Result |
| --- | --- |
| Classification table (`provider_insufficient_quota`, `provider_rate_limited`, `provider_http_500`, `provider_network` vs `provider_cancelled`, `cancelled`, `deadline`, `toolset_invalid`, `internal_error`) | recoverable / non-recoverable exactly as specified |
| Recoverable + current run | owned `sirkit:ai-provider-failure` event dispatched with the failed provider; invoking its retry starts exactly one NEW run |
| Recoverable + STALE run | `recovered: false`, no event, injected starter never invoked |
| `cancelled` / `provider_cancelled` / `deadline` while current | nothing recovered, no event |
| Switch | order is `select:anthropic` THEN `run-with:anthropic` — the new run observes the selection; reverse direction resolves to `openai`; null retry handle still selects |

Live provider turns remain UNKNOWN (both accounts out of credits); every
behavior above is proven against the production module with real event
dispatch, not network access.
