# B16.0.14 §L — Test & validation report

No live provider, embedding, database, or network — `llmRouter.generate`,
`searchFootprints`/`getDb`/`embedQuery`, identity and membership are all
faked/mocked/injected.

## Complete suite — exit code 0

```
pnpm exec vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **373 passed**, 3 skipped (376) |
| Tests | **3767 passed**, 20 skipped (3787) |
| Failed | **0** |
| Process exit code | **0** |

No assertion failure occurred; nothing was classified as flakiness. (An earlier
run surfaced ONE failure — the `b16-0-2-gates` §C recognized-authority regex not
yet listing the new wrapper — which was fixed by adding
`selectorEnvelopeJsonRoute` to that list; the re-run is the 3767/0 above.)

## Targeted batteries (this session's runs)

| Battery | Result |
|---|---|
| `b16-0-14-tranche-parity` PRE-migration (raw handlers) | **13 / 13** |
| `b16-0-14-tranche-parity` POST-migration | **14 / 14** (added the search-limit-3 pin; SSRF pin converted to closure — disclosed seam change fetch→service) |
| `b16-0-14-selector-envelope-gate` | **13 / 13** |
| ratchet (TRANCHE_7, 82/71) | 8 / 8 |
| B16.0.12 footprint-search parity (unchanged after extraction) | **24 / 24** |
| apply-reauthorization + required-apply-role + session-identity + bounded-json + adoption gate | **58 passed** |
| b16-0-2-gates + b16-0-8 capabilities | **30 passed** |

## Static gates

| Gate | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| Scoped ESLint (wrapper, service, 3 routes, new/changed tests, analyzer) | **0 problems** |
| `git diff --check` | clean (LF/CRLF advisories only) |

## Generators ×2 — byte-stable (sha1 identical both rounds)

| Output | sha1 |
|---|---|
| `route-wrapper-matrix.csv` (71/3/79) | `ae3f6311…` |
| `_raw-route-baseline.json` (82) | `027bccf9…` |
| `method-authorization-matrix.csv` | `8dcf41b5…` |
| `request-body-boundary-matrix.csv` | `ff1ea338…` |

## Preserved invariants (§M)

Exactly 12 agent-exposed tools, replay pins, authoritative hashes, verified
manufacturing release internal-only — all inside the passing 3767. No agent
mutation/tool-exposure changes, no prompt/provider configuration changes, no
provider/embedding credits, no live DB, protected original untouched.
