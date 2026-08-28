# B16.0.17.1 §H — Test & validation report

No provider credits, network, or DB — `llmRouter.generate` spied; the
validation path (structural validator + normalize) is REAL.

## Complete suite — exit code 0

```
pnpm exec vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **380 passed**, 3 skipped (383) |
| Tests | **3991 passed**, 20 skipped (4011) |
| Failed | **0** |
| Process exit code | **0** |

3972 (B16.0.17) + 19 new adversarial tests = 3991. No flake handling required.

## Targeted batteries (this session's runs)

| Battery | Result |
|---|---|
| `b16-0-17-1-proposal-validation` (NEW, real validator + real normalize) | **19 / 19** |
| corrected `b16-0-17-tranche-parity` | **82 / 82** |
| `b16-0-17-schematic-compiler-confinement-gate` + standing `routes.test.ts` | green |
| ratchet + adoption + b16-0-2 gates + schematic-compiler domain | **73 passed** (6 files) |

## Static gates

| Gate | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| Scoped ESLint (agent-tools, propose route, both test files) | **0 problems** |
| `git diff --check` | clean |

## Generators ×2 + §G invariants (byte-stable AND unchanged)

| Output | sha1 | vs B16.0.17 |
|---|---|---|
| `route-wrapper-matrix.csv` (91/3/59) | `cd4aaee0…` | **IDENTICAL** |
| `_raw-route-baseline.json` (62) | `72cf7733…` | **IDENTICAL** |

Inventory re-measured: 91 canonical / 3 factories / 59 raw; baseline 62; tools
exactly 12; prompt/schema/provider config/maxTokens/temperature unchanged;
graph semantics, transaction authority, KiCad quarantine, layout view-only,
export chain, manufacturing-release internality, hashes and replay pins all
inside the passing 3991.
