# B16.0.13 §G — Autoroute process boundary proof

## The complete FreeRouting contract — unchanged

Board/netlist validation, positive-number option validation, net-id
validation, `sourceRevision` conflict behavior, runtime discovery, DSN
validation, bounded completion policy, protected-copper preservation,
candidate revision generation, SES parsing, fabrication-readiness evaluation,
debug-bundle behavior, and response evidence/diagnostics are all byte-preserved
route code, and the STANDING `autoroute/route.test.ts` (24 tests, fake runner +
fake runtime) passes unchanged post-migration —
[protected-copper-and-revision-parity.md](protected-copper-and-revision-parity.md).

## Security ordering (wrapper-enforced + pinned)

1. **No runtime lookup or process spawn before authorization and body
   validation** — the wrapper runs policy → identity/role → CSRF → media →
   bounded read BEFORE the callback; every §A refusal pin asserts
   `resolveFreeroutingRuntime` and `runFreerouting` were never called.
2. **A pre-aborted signal cannot spawn a process** — pinned: pre-aborted
   request → the bounded reader refuses 400 `AUTH_BODY_ABORTED`; zero
   runtime/runner calls.
3. **Abort during routing reaches `runFreerouting`** — the wrapper-projected
   `signal` (the request's lifecycle signal) is handed to the runner exactly as
   before; the standing suite's abort tests pass unchanged.
4. **Cancellation settles once; late completion/rejection contained** — the
   route's single-settlement construction is unchanged; the standing suite's
   late-completion tests pass.
5. **Timeout bounded** — `timeoutMs: Math.max(1, deadline - Date.now())`
   unchanged; the 60 s body deadline is the wrapper's declared contract
   (already the route's historical value).
6. **No live FreeRouting process in tests** — the runner/runtime are vi.mock
   fakes everywhere.

No routing algorithm or acceptance criterion changed.
