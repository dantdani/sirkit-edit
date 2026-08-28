# B16.0.23 §L — Test & validation report

Zero provider credits, zero live simulators, zero real processes (scripted
fake child + fake worker seams), zero network/DB.

## Complete suite — exit code 0

```
pnpm exec vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **399 passed**, 3 skipped (402) |
| Tests | **4457 passed**, 20 skipped (4477) |
| Failed | **0** |
| Process exit code | **0** |

4400 (B16.0.22) + 44 §A pins + 10 confinement gates + 3 adapter-parity = 4457,
exact.

## Targeted batteries

| battery | result |
|---|---|
| `b16-0-23-tranche-parity` PRE-migration (raw handlers) | 42/44 first run → **44/44** after 2 expectation corrections (no production edits) |
| `b16-0-23-tranche-parity` POST-migration | **44/44** — 42 pins byte-unchanged, 2 documented supersessions (§E/§F terminal guard, §G error split) |
| `b16-0-23-tranche16-confinement-gate` | **10/10** |
| `b16-0-23-adapter-schema-parity` | **3/3** |
| ratchet (TRANCHE_16, 8/145) | green |
| standing SPICE: `b16-0-2-spice-scope-isolation` + `worker-integration` | green UNCHANGED through the migrated wrappers |
| standing gates: `b16-0-2-gates` + `b16-0-3-boundary-gate` + `b16-0-4-bounded-body-behavior` + `b16-0-5-media-type-and-wrapper` + `b14-route-replacement` | **130 passed** |

## Static gates

`tsc --noEmit` **0 errors** (after fixing one test-only field name:
`ToolDescriptor.toolId`) · scoped ESLint **0 problems** · `git diff --check`
clean.

## Generators ×2 — byte-stable

`route-wrapper-matrix.csv` `4a8d6980…` (145/3/5) ·
`_raw-route-baseline.json` `494229f5…` (8 rows).

## No functional failure misclassified as flake

The two initial §A failures were an expectation miscount (20 tools, not 19)
and a volatile `checkedAt` timestamp — both corrected in the test, not
waved off. The provider-failure pin emits an expected `[llm:openai] request
failed` stderr line (the friendly-message logger) — not a test failure.

## Preserved invariants

Exactly 12 agent-exposed tools; no spice route agent-exposed; the standing
SPICE scope-isolation no-existence-oracle property intact; live-worker
integration pins intact — all inside the passing 4457.
