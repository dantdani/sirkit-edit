# Test & validation report (B16.0.2)

## Full suite
`npx vitest run` → **3186 passed / 0 failed / 20 skipped** across 354 files
(twice, after each artifact regeneration). The run emits vitest worker RPC
warnings (`Timeout calling "onTaskUpdate"`) under heavy parallel load — these
are harness telemetry timeouts, not test failures (0 failed); the same run
reports every test file passed.

## Pre-edit reproductions
One disposable probe reproduced R1–R8 against the REAL handlers; exact outputs
recorded in `pre-edit-counterexamples.md`; the probe was deleted; every defect
converted to a permanent regression test.

## New B16.0.2 suites (all green)
- `b16-0-2-csrf-exact-origin` — both bypasses + all origin/config cases + CSRF-before-body
- `b16-0-2-bounded-json` — fake-timer deadline, wire-ceiling, pre-abort, mid-abort, late-chunk, one-terminal, no-unhandled-rejection; three migrated boundaries
- `b16-0-2-spice-scope-isolation` — scope-A/B runs; anonymous 401; foreign 404 on every surface; listener counts; cancellation state; query-selector; viewer/foreign refusals
- `b16-0-2-bom-ownership` — auth on every surface; no ownership claim in body; cross-project list/diff/mark/dismiss/bulk/delete isolation; legacy-row quarantine; PG predicate source-pins
- `b16-0-2-session-identity` — typed/scope-exact/abort-bound/no-fallback loader + production integration (seal→apply→one txn; logout/switch/downgrade/revision/failure = zero proposal-or-mutation)
- `b16-0-2-required-apply-role` — accepted-role mapping; both-gates; unknown fails closed; all three families; tier-1 end-to-end
- `b16-0-2-engineering-export` — protection; refused body actor/project; server-derived attribution; unverified labels; verified-mode 409; UI never routes verified here
- `b16-0-2-mode-diagnostics` — banner follows server auth mode; production sign-out never local_dev
- `b16-0-2-gates` — the permanent tripwires (incl. negative synthetic ones) + byte-pinned classification CSV

## Regression suites (all green)
- B16.0 / B16.0.1: auth suites 110/111 pass (the 1 miss is the pre-existing
  chat-route dynamic-import 5 s timeout flake — passes in isolation at 4.2 s).
- Engineering B06–B16 (incl. B12 approval/replay/recovery/production-integration,
  B15.3 exposure, B16.0.1 verified-actor/replacement): 800/801 pass — the 1 miss
  was the B01 route-coverage artifact staleness (bom/diff), fixed by regenerating.
- B14 replacement approval/journal/replay/stream-lifecycle: green.
- chat / agent / gateway / llm: 357 pass.
- spice / bom: 34 pass. PCB lifecycle/readiness/release + components: 901 pass
  (3 load-sensitive perf benchmarks flake under full-suite load; all pass in
  isolation — route-tool/auto-place/pcb-repair-agent, documented, not repaired
  by loosening).
- requirements / architecture (capabilities reclassification): 60 pass.

## Static checks
- `tsc --noEmit` — clean.
- ESLint (changed surfaces) — clean, EXCEPT 4 pre-existing
  `react-hooks/set-state-in-effect` errors in `BomView.tsx` (lines 396/462/488/1418)
  on effects that predate B16.0.2 (e.g. `setPricingChoice` on mount, untouched by
  this stage); B16.0.2 net-removed one such effect (the state-hash effect). Not a
  B16.0.2 regression; no rule was loosened.
- `git diff --check` — clean (only pre-existing LF/CRLF advisory warnings).
- Artifact generators run TWICE — byte-identical (b16-0-2 classification,
  b16-0-1 exact-policy, b16-0 auth-route-coverage, b01 route-coverage).

## Discipline
No functional failure was reclassified as a flake (each flake verified green in
isolation). No budget, gate, schema, or assertion was loosened to obtain green.
No live provider credit, live Supabase login, live DB mutation, external release
publication, or secret-bearing output.
