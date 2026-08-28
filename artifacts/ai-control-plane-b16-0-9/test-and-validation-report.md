# B16.0.9 §G — Test & validation report

All in `C:\Users\robsa\Desktop\sirkit-edit`. Zero provider credits (fake
adapter only); no DB migrations or writes; no provider-configuration changes.

## Complete suite — exit code 0 (mandated command)

```
pnpm exec vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **366 passed**, 3 skipped (369) |
| Tests | **3539 passed**, 20 skipped (3559) |
| Failed | **0** |
| Process exit code | **0** |

No assertion failure was classified as flakiness — there were none.

## Targeted suites

| Suite | Result |
|---|---|
| `b16-0-9-tranche-parity` (111 pins: §A matrix ×17 + per-route refusals + §D provider) | green PRE-migration (calibration run) AND POST-migration |
| architecture + power + interfaces families (api + lib) | 141 / 141, zero edits |
| `b16-0-8-migration-ratchet` + adoption gate (updated pins) | green |
| `b16-0-8-wrapper-capabilities`, `b16-0-5-media-type-and-wrapper` | green |
| B16.0.4–B16.0.7 analyzer/gate suites | green (within the full run) |

## Static checks

```
npx tsc --noEmit                 → 0 errors
npx eslint <changed files>       → 0 problems
git diff --check                 → clean (LF/CRLF advisories only)
```

## Generators ×2 — byte-stable

All five sanctioned outputs identical across two runs
([ratchet-and-inventory-results.md](ratchet-and-inventory-results.md) has the
sha1s): wrapper matrix `1c801589…` (32/3/118), auth matrix `6113b450…`
(121 load-bearing / 0 rejects), body matrix `b54064a4…` (0 UNBOUNDED),
b16-0-1 `41e9fccf…`, b16-0-2 `e22ec3a3…`; baseline generator 138 → 121
(removals only, re-run is a no-op).

## Preserved invariants (§H)

Exactly 12 agent-exposed tools, replay pins, authoritative hashes,
internal-only manufacturing release — the enforcing gates all pass inside the
3539. No mutation/tool-exposure change; `C:\Users\robsa\sirkit` untouched
(pre-existing mtimes).
