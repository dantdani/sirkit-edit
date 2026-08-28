# B16.0.9 §E — Behavioral parity results

## Method

1. The 111-pin suite was written FIRST and calibrated to GREEN against the
   PRE-migration handlers (every expectation matches actual pre-edit behavior).
2. All 17 routes were then migrated by a single uniform, scripted
   transformation: the handwritten `authorizeRequest → kind-guard →
   readBoundedJsonObject(8 MB/30 s)` boilerplate became the
   `authenticatedJsonRoute` wrapper, `read.body` became the callback's parsed
   body, and the business logic moved VERBATIM (validation order, status codes,
   JSON shapes, diagnostics arrays, `no-store` and `X-Sirkit-AI-Provider`
   headers, `new Date().toISOString()` timestamps, actor construction,
   candidate compilation and digests all untouched).
3. The same 111 pins re-ran GREEN post-migration, and the family suites
   (`app/api/{architecture,power,interfaces}` + their lib suites — 141 tests,
   including success-path compilations, candidate ordering, digest
   determinism, proposal schema/tool choice) stayed green unchanged.

## Result

- **111 / 111 pins green pre-edit AND post-edit** — zero assertion changes
  between the two runs.
- **141 / 141 family tests green** with no edits at all.
- Full bounded-fork suite green (see
  [test-and-validation-report.md](test-and-validation-report.md)).

## Not silently normalized

- `interfaces/allocate` performs NO body-scope check (it ignores projectId) —
  a pre-existing looseness. It is documented here and in
  [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md), NOT
  silently "fixed" (that would be a contract change) and NOT hidden.
- The throwing validators on shapeless problems (arch/interfaces) are
  pre-existing; preserved and documented.
- The unreachable legacy `kind !== "authenticated"` 401 branch is replaced by
  the wrapper's equally unreachable 403 branch — not observable.
