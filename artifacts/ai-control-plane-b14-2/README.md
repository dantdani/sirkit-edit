# B14.2 — replacement total-settlement and approval-entry boundary closure

Corrective stage over B14.1 (whose structural-approval and exact-stale
closures are preserved intact). Four remaining boundary defects reproduced
and closed:

| # | Defect | Closure |
| --- | --- | --- |
| R1 | never-settling reauthorization (`HUNG_AFTER_250MS` … while the COMMIT LEASE was held; the 30 s TTL was never an execution deadline) | the hard settlement race: documented 10 s transport deadline, AbortSignal threaded through fetch + body read, one settlement, late results discarded/observed, pre-abort ⇒ no transport, timers cleared, one-shot preserved; timeout ⇒ zero journal entries/transactions and the lease/gateway/retirement stay usable — [total-settlement-boundary.md](total-settlement-boundary.md) |
| R2 | the authority-bearing controller wrapper was publicly importable (only the intent module was walker-gated) | internal composition-boundary module + safe event-discrimination split + permanent walkers for the controller, the channel module, and the test factory, with a synthetic-injection negative tripwire; honest trusted-composition documentation — [approval-controller-import-boundary.md](approval-controller-import-boundary.md) |
| R3 | `req.text()` / `response.text()` buffered before measuring | ONE shared streaming bounded reader (B10.1/B10.2 extracted) on BOTH HTTP directions; 413/refusal without buffering; never-settling cancellation cannot delay settlement; content-type/no-store/redirect discipline — [streaming-bounds.md](streaming-bounds.md) |
| R4 | the "nonce" was local-only — absent from the HTTP exchange | platform-random request nonce, endpoint-validated and ECHOED in an allowlisted binding (nonce + component + server-constructed scope), verified by the channel before accepting facts; documented as correlation/replay defence, not authentication — [request-correlation.md](request-correlation.md) |

Evidence: [pre-edit-counterexamples.md](pre-edit-counterexamples.md) ·
[regression-evidence.md](regression-evidence.md) ·
[changed-files.md](changed-files.md) ·
[final-verdict.md](final-verdict.md)

Supersession notes were added to four B14.1 documents (history preserved),
correcting the result-TTL-as-deadline and local-nonce-as-binding claims.
