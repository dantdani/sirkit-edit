# B16.0.22 §J — Test & validation report

Zero providers, processes, devices, network, or DB writes.

## Complete suite — exit code 0

```
pnpm exec vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **396 passed**, 3 skipped (399) |
| Tests | **4400 passed**, 20 skipped (4420) |
| Failed | **0** |
| Process exit code | **0** |

4332 (B16.0.21) + 59 §A pins + 9 gates = 4400 — exact.

## Targeted batteries

| battery | result |
|---|---|
| `b16-0-22-tranche-parity` PRE-migration (raw handlers) | 56/59 first run → **59/59** after 3 expectation corrections to observed reality (no production edits) |
| `b16-0-22-tranche-parity` POST-migration | **59/59** — 57 pins byte-unchanged, 2 documented supersessions |
| `b16-0-22-tranche15-confinement-gate` | **9/9** |
| ratchet (TRANCHE_15, 21/132) | **8/8** |
| standing: b14-route-replacement + b16-0-3-route-auth + b14-3-stream-lifecycle + pcb-sync + assignment-queue + b16-0-5 media/wrapper | **91 passed**, 1 pre-existing skip — UNCHANGED |
| b16-0-2 gates + b16-0-3 boundary gate (after the two supersession updates) | **31/31** |

## One disclosed intermediate failure

The FIRST full run failed 2/4400: the B16.0.2/3 route-specific pins that
asserted replacement-authority's RAW guard-first form. Both were updated to
assert the canonical-wrapper classification (strictly stronger,
provenance-checked; supersession notes in-file) — see
[unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md) decision 4.
Second full run: **0 failures**.

## Static gates

`tsc --noEmit` **0 errors** · scoped ESLint **0 errors** (4 pre-existing
warnings in an untouched passive-policy test file) · `git diff --check`
clean (exit 0; CRLF advisories only).

## Generators ×2 — byte-stable

`route-wrapper-matrix.csv` `de1a2905…` (132/3/18) ·
`_raw-route-baseline.json` `fc3203a5…` (21 rows).

## Preserved invariants

Exactly 12 agent-exposed tools; no tranche-15 route agent-exposed; the
B14.2/B14.3 replacement-authority envelopes byte-identical; replay pins &
hashes intact — all inside the passing 4400.
