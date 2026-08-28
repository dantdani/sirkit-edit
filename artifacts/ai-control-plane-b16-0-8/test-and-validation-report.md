# B16.0.8 §H — Test & validation report

All in `C:\Users\robsa\Desktop\sirkit-edit`. No provider credit; no live
database writes; no manufacturing-release exposure.

## Full test suite — exit code 0 (definitive post-migration run)

```
npx vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **365 passed**, 3 skipped (368) |
| Tests | **3428 passed**, 20 skipped (3448) |
| Failed | **0** |
| Process exit code | **0** |

Covers all B16.0–B16.0.8 security suites, every migrated route family, the
wrapper behavioral suites, and the exposure / replay-pin / authoritative-hash /
internal-only manufacturing-release gates.

## New B16.0.8 suites (subsets of the run)

| Suite | Tests |
|---|---|
| `b16-0-8-tranche-parity` (pre/post behavioral pins) | 24 — green pre-migration AND post-migration |
| `b16-0-8-wrapper-capabilities` (query/headers/params/signal/worker/kicad + secret-header structural unavailability) | 12 |
| `b16-0-8-migration-ratchet` (monotonic baseline + 5 tripwires) | 6 |
| `b16-0-7-wrapper-adoption-gate` (updated floor ≥15) | 5 |
| prior hardening (b16-0-4/5/6/7) + §A/§C gates | all green |

## Migration fallout — call conventions only, no behavior pin changed

- `kicad-http-route.test.ts`: `await` added (handlers now async).
- `api-persistence.test.ts`: capabilities GET passed a Request.
- One REAL protocol difference discovered and resolved truthfully (kicad
  trailing-slash tolerance → the narrow variant runs only the token boundary);
  see [behavioral-parity-results.md](behavioral-parity-results.md).

## Type check / lint / whitespace

```
npx tsc --noEmit                 → 0 errors
npx eslint <all changed files>   → 0 problems
git diff --check                 → clean (LF/CRLF advisories only)
```

## Generators — byte-stable ×2

| Output | sha1 (run 1 = run 2) |
|---|---|
| `exact-route-authorization-policy.csv` | `41e9fccf…` (unchanged) |
| `route-data-and-resource-classification.csv` | `e22ec3a3…` (unchanged) |
| `method-authorization-matrix.csv` | `78836731…` — 121 load-bearing (111 guard-first + **7 wrapper** + 3 factory) / 32 public / **0 rejects** |
| `request-body-boundary-matrix.csv` | `1f44afb2…` — **0 UNBOUNDED**; wrapper JSON routes report their declared `canonical-wrapper:*` bounds |
| `route-wrapper-matrix.csv` | `fd30f760…` — **15 adopted / 3 factories / 135 raw** |
| raw-route baseline generator | freeze 138 → update no-op (0 added), refusal path test-pinned |

## Preserved invariants

415/no-store/zero-pull behavior, B16.0.5 §D wrapper-input pins (unchanged
without opt-ins), exactly 12 exposed tools, replay pins, authoritative hashes,
internal-only manufacturing release, provider configuration — all green in the
full run. `C:\Users\robsa\sirkit` untouched.
