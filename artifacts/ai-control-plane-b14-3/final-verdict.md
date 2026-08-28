# B14.3 — final verdict

**Stop condition:** "B14.3 is complete only when stalled request and
response streams both settle within explicit hard bounds, active readers
are best-effort canceled without making cancellation load-bearing, late
stream results are inert, capability import gates cannot be bypassed by
equivalent import syntax, the production replacement click still commits
exactly once, and the full suite remains green."

**Verdict: MET.**

1. **Stalled streams settle within explicit hard bounds.** The endpoint
   reads the request under `req.signal` + the documented 10 s
   `REQUEST_READ_DEADLINE_MS` (never-first-chunk ⇒ 408; abort ⇒ prompt
   408; oversized ⇒ 413; the pre-edit `HUNG_REQUEST_AFTER_250MS …
   STILL_HUNG` is impossible), and the response body reads under the
   channel's internal signal inside the 10 s transport deadline. No
   durable authority loader or pin-fact reader runs after any incomplete
   request (counting factories: zero).
2. **Active readers are canceled without cancellation being
   load-bearing.** Abandonment now initiates best-effort, never-awaited
   reader cancellation (the pre-edit `{"result":null,"canceled":false}`
   is now `canceled === 1` at the PRODUCTION channel); a `cancel()` that
   throws, rejects, or never settles delays nothing.
3. **Late stream results are inert.** Late read resolutions are discarded
   by the settle latch — including a fully valid, correctly nonce-bound
   JSON body delivered after the timeout by a reader that IGNORES
   cancellation — and late rejections are observed, never unhandled. Zero
   facts accepted after timeout; one-shot consumption and the zero-journal
   /zero-transaction timeout guarantee preserved.
4. **The import gates cannot be bypassed by equivalent syntax.** Every
   capability target is gated by specifier EXTRACTION + RESOLUTION
   (static, side-effect, re-export, dynamic, require; relative and alias
   normalization) with the exact approved importer sets preserved;
   same-directory, parent-relative, alias, dynamic, re-export, and
   mixed-spelling tripwires all detect; non-import occurrences of module
   names are correctly ignored (sound AND complete). The engineering
   barrel remains incapable of exporting the capabilities.
5. **The production replacement click still commits exactly once** —
   the b14-1 rendered-dialog integration and the full B14/B14.1/B14.2
   batteries are green with unmodified behavior (60 + 15 tests; the R5
   count corrected in evidence only).
6. **The full suite is green:** **2733 passed / 20 skipped / 0 failures**
   (2753; 316 files passed / 3 skipped); tsc clean; scoped ESLint clean;
   page baseline unchanged (14); `git diff --check` clean; all
   deterministic pins byte-identical; the protected original at its
   6-entry baseline.

Classification: **CONFIRMED** — R1–R5 reproductions (R1/R2 behaviorally,
R3/R4 by source citation, R5 by execution) and closures A–F above.
**INFERRED** — the production channel's browser-realm behavior is proven
over a stubbed platform fetch in §C 16 (node realm); in a real browser the
fetch-abort ALSO cancels a conforming response body natively, so the
explicit reader cancellation is belt-and-braces for non-conforming
streams. The one flaked full-suite invocation (a worker-RPC timeout on an
unrelated perf test, green in isolation and in the clean rerun) is
recorded in regression-evidence.md. **PROPOSED** — none required.
**UNKNOWN** — none material.

**B15, PCB mutation exposure, manufacturing release, MCP, external
component APIs, provider expansion, and multi-agent work are NOT started.
Stopped; awaiting independent verification.**

---

> **SUPERSESSION NOTE (B14.4).** Verdict point 4 ("the import gates cannot
> be bypassed by equivalent syntax") was OVERSTATED: the regex extraction
> behind it missed comment-interleaved imports, escaped module literals,
> and statically concatenated dynamic imports — all valid TypeScript — and
> the scan covered only `.ts`/`.tsx`. B14.4 reproduces those
> counterexamples and closes them with TypeScript-AST extraction, bounded
> static evaluation, fail-closed opaque module loads, hardened canonical
> resolution, and an 8-extension scan surface; approved importer sets are
> unchanged. The RUNTIME verdicts of this stage (points 1–3, 5–6) are
> independently verified and untouched by B14.4. See
> `../ai-control-plane-b14-4/final-verdict.md`.
