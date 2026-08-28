# B09.1 — Run Deadline and Cancellation Contract

- The loop owns ONE `AbortController` per run. Its signal composes:
  - the caller's cancellation signal (`request.signal` — client
    disconnect / project switch), and
  - a run-deadline timer (`budget.runDeadlineMs`, production 120 s).
- The composed signal is passed to EVERY await: provider `start`,
  provider `continueWith`, and `gateway.invoke` (which also keeps the
  existing per-tool timeout — the tighter of per-tool and descriptor
  timeouts still applies inside the read service).
- A provider or tool call that never resolves on its own is therefore
  terminated at the deadline — the deadline covers the ENTIRE run.
- Deterministic classification: a `deadlineExpired` flag set by the timer
  distinguishes `run_failed deadline` from `run_failed cancelled`
  (external abort). Cancellation before the deadline is `cancelled`;
  expiry during a pending await is `deadline`.
- Cleanup on EVERY exit path (`finally`): the deadline timer is cleared
  and the external-abort listener removed — a completed run can never
  receive a late deadline abort or leak a listener.

Proof (b09-1-boundary §5, all sub-second, far from the 120 s production
value): hung provider start → deadline; hung continuation → deadline;
external cancel before deadline → cancelled; hung gateway tool → deadline
via the same composed signal; normal completion → no late events after
the deadline would have fired.
