# B16.0.15 §J — Test & validation report

No provider credits, no live routing process, no live DB writes, no network —
every durable/expensive seam is a spy; the standing REAL qualification and
MFG01 suites (unchanged) cover the full expensive path.

## Complete suite — exit code 0

```
pnpm exec vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **375 passed**, 3 skipped (378) |
| Tests | **3800 passed**, 20 skipped (3820) |
| Failed | **0** |
| Process exit code | **0** |

No assertion failure occurred; no flake handling was required.

## Targeted batteries (this session's runs)

| Battery | Result |
|---|---|
| `b16-0-15-tranche-parity` PRE-migration (raw handlers) | **23 / 23** |
| `b16-0-15-tranche-parity` POST-migration | **23 / 23** (zero assertion changes) |
| `b16-0-15-manufacturing-boundary-gate` | **10 / 10** |
| ratchet (TRANCHE_8, 80/73) | 8 / 8 |
| B16.0.14 tranche + selector gate | green |
| b16-0-2 gates + b16-0-7 adoption + manufacturing-release-gate + identity-header gate | **104 passed** (combined) |
| PCB-sync + durable-workflow suites (shared `_scope` touched) | **75 passed**, 1 skipped |

## Static gates

| Gate | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| Scoped ESLint (2 routes, `_scope`, new/changed tests) | **0 problems** |
| `git diff --check` | clean (LF/CRLF advisories only) |

## Generators ×2 — byte-stable (sha1 identical both rounds)

| Output | sha1 |
|---|---|
| `route-wrapper-matrix.csv` (73/3/77) | `0ce7e97a…` |
| `_raw-route-baseline.json` (80) | `ed2c970c…` |
| `method-authorization-matrix.csv` | `3b50e1b5…` |
| `request-body-boundary-matrix.csv` | `11f15bf4…` |

## Preserved invariants

Exactly 12 agent-exposed tools; `sirkit.manufacturing.release` internal-only /
not-callable / not agent-exposed; authoritative hashes & replay pins
byte-identical; the real qualification + MFG01 suites unchanged and green — all
inside the passing 3800. No provider/network/DB-write side effects.
