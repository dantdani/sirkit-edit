# B14.1 — regression evidence

## New permanent suites (15 tests)

**`b14-1-approval-and-reauthorization.test.ts` (10)** — §A: no approval /
boolean / string / structural / serialized tenders refuse `approval-required`
BEFORE any journal or canonical work; wrong-proposal, wrong-scope,
stale-head, expired intents grant nothing; an intent is ONE-SHOT (replay
after success AND after a refusal both refuse; one transaction total);
consumption classification precision + inert serialization. §B: a
structural adapter carrying an EXACT stale byte copy refuses BEFORE
`journal.prepare` (zero entries) and before canonical execution (zero
transactions); JSON round-trips/clones of a real channel authenticate
nothing; channels are one-shot; the production factory takes zero injection
parameters. Boundaries: permanent walkers for the approval-intent module's
approved importer set, the barrel non-export, and the test-only channel
factory; the provider registry still exposes read/propose only.

**`b14-1-production-integration.test.tsx` (3)** — the §D chain (see
[production-ui-integration.md](production-ui-integration.md)): the full
production path commits exactly once with exact adoption/undo; cancel /
dismissal / timeout mutate nothing and double/concurrent activation commits
once; forged intents, forged exact-match fresh facts, project switch, and
retirement never produce a second transaction.

## Updated suites (strengthened, never weakened)

- `b14-replacement-apply.test.ts` — the harness now mirrors the production
  controller: one fresh one-shot intent per activation (bound to the
  effective apply scope) plus one branded test channel per attempt; all 17
  cases keep their assertions.
- `b14-route-replacement.test.ts` — the endpoint tests moved to the honest
  LOCAL scope; NEW cases: foreign tenant/branch → 403 with the loader never
  invoked, and UTF-8 byte-bound proof (multi-byte payloads).
- `b14-replacement-review.test.tsx` — the supplementary tripwire now
  targets the production controller wiring
  (`approveAndApplyReplacement`/`receiveReplacementProposalEvent`).
- `b06-1` authority-import boundary, B03/B04/B06/B12/B13 suites — green
  unchanged.

## Results

| battery | result |
| --- | --- |
| B14.1 suites | 15/15 |
| all B14 suites (proposal/apply/route/review) | 45/45 |
| B03.2/B04/B06/B06.1/B12 boundary + B13.2 | green |
| **FULL SUITE** | **2699 passed / 20 skipped / 0 failures (2719)** |

`tsc --noEmit` clean; scoped ESLint clean on every new/changed file;
page.tsx at its exact 14-problem baseline. No provider credits spent; no
dependency or provider-configuration changes.
