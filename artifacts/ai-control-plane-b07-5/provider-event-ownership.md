# B07.5 — Provider-Failure Event and Retry Ownership

## The failure (CONFIRMED)

`throwAiResponseError` dispatched the GLOBAL
`sirkit:ai-provider-failure` event before the originating handler's
catch block could evaluate its `ProjectAsyncScope`. An old project-A
request could therefore repopulate `aiProviderFailure`,
`lastAiRetryRef`, and chat-open state AFTER project B's transition reset
had cleared them — and the retained ambient retry callback could replay
A's request against B. Component callers (SpiceStudio, PCB AssistBox,
useNetClass) passed no ownership at all, and useNetClass could apply a
stale-project rule delta to the new project's board.

## The contract

`app/lib/ai-preferences.ts`:

- `AiRequestOwnership { isCurrent(): boolean }` — the owner handle. Page
  requests pass their `ProjectAsyncScope`
  (`{ isCurrent: () => scope.isCurrent() }`); component requests combine
  the page's project-generation factory (`captureAiRequestOwnership`,
  captured per request at submission) with their own mount lifetime
  (`aliveRef`).
- `throwAiResponseError(response, retry?, ownership?)`:
  - re-checks `ownership.isCurrent()` AFTER the body-parse await (the
    JSON-parse race window) and dispatches NOTHING when stale — the
    typed `AiProviderUnavailableError` still throws so the originating
    handler's scoped catch settles its own state;
  - wraps the retry: `() => { if (ownership.isCurrent()) retry(); }` — a
    retry from A refuses once B is active;
  - attaches `stillCurrent: () => ownership.isCurrent()` to the event
    detail for the listener-side re-check.
- The page listener (`onProviderFailure`) drops any event whose
  `stillCurrent?.() === false` before touching `lastAiRetryRef`,
  `aiProviderFailure`, or chat-open state.
- Abort is CANCELLATION, never provider failure: an aborted fetch throws
  before `throwAiResponseError` is ever reached, page handlers classify
  `AbortError` silently (B07.4), and `OwnedSimulationRunner` returns
  `aborted` without touching error state.
- Current-project quota/provider failures still dispatch, display, and
  provide a working scoped retry.
- No provider credentials or upstream diagnostic secrets are added to
  the event detail (provider id + wrapped callbacks only).

## Call sites (all ownership-explicit)

- `app/page.tsx` — chat, generation, theory generation
  (`lib/apply-netlist.ts` threads ownership), edit, topology edit,
  review, cross-verify, tidy: every `throwAiResponseError` call passes
  `{ isCurrent: () => <scope>.isCurrent() }`.
- `app/components/spice/SpiceStudio.tsx` (`askAi`) — page generation +
  component lifetime; response content (question/proposal/error) is also
  refused for a stale owner; busy stays component-lifetime.
- `app/components/pcb/AssistBox.tsx` (`submit`) — same; a stale owner
  surfaces no pending edit or notice.
- `app/components/pcb/hooks/useNetClass.ts` (`suggestBrief`) — same; a
  stale suggested delta is refused BEFORE `applyBrief`/`applyDelta`
  can mutate board rules.
- Ownership reaches the components through the `aiOwnership` prop
  (page → SpiceStudio, page → PcbEditor → AssistBox/useNetClass);
  without the prop they fall back to component-lifetime ownership
  (standalone mounts, tests).

## Tests (b07-5-async-ownership-closure.test.ts §7)

- T22 — stale scope: typed error thrown, NO event dispatched.
- T23 — current scope: event with provider, truthful `stillCurrent`,
  working retry.
- T24 — a dispatched retry turns inert after the transition; the
  listener would drop the event via `stillCurrent`.
- T25 — switching DURING body parsing prevents the dispatch.
- T23b — the page listener re-check drops a stale event that somehow
  arrived.
- T26a/T26b — abort classified as cancellation (runner behavioral +
  page source).
- T27 — every call site (page + three components) verified
  ownership-explicit; the lib's dispatch/retry/stillCurrent gates
  verified in source.
