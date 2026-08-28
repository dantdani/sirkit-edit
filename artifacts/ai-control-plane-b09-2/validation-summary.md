# B09.2 validation summary

Date: 2026-08-09. Workspace: `C:\Users\robsa\Desktop\sirkit-edit` (uncommitted
working tree; `C:\Users\robsa\sirkit` untouched).

## New permanent regression suites

| Suite | Tests | Covers |
| --- | --- | --- |
| `app/lib/agent/__tests__/b09-2-closure.test.ts` | 18 | R1–R6, sections A–F (authority, integrity, deadline, schemas, scope/capability, evidence-path gate) |
| `app/lib/agent/__tests__/b09-2-recovery.test.tsx` | 5 | R7-adjacent §G production recovery (jsdom, production `run-consumer.ts` imports only) |

All 23 pass.

## Test batteries (exact counts)

| Battery | Result |
| --- | --- |
| Regression gate `npx vitest run b07 b04-tool-registry b08 b06` | **316 passed** (18 files) — baseline preserved |
| `npx vitest run b05 app/lib/agent` (B05/B05.1 + B09/B09.1/B09.2) | **128 passed** (9 files) |
| `npx vitest run app/lib/engineering/__tests__` | **450 passed** (26 files) |
| `npx vitest run app/lib/pcb/lifecycle/__tests__` | **20 passed** (2 files) |
| Full suite `npx vitest run` | **2130 passed, 5 failed, 20 skipped** (2155 total; 262/270 files passed, 3 skipped) |

The 5 full-suite failures are the DOCUMENTED timing-budget family (perf
assertions under parallel suite load): `run-drc` elapsed-ms budget
(289.9 ms vs 200 ms), `route-tool` 500-track live-preview budget,
`auto-place`, `compute-fill`, `pcb-repair-agent`. Every one passes isolated:

| File (isolated rerun) | Result |
| --- | --- |
| `app/lib/pcb/__tests__/run-drc.test.ts` | 5 passed |
| `app/lib/pcb/__tests__/route-tool.test.ts` | 25 passed |
| `app/lib/pcb/__tests__/auto-place.test.ts` | 8 passed |
| `app/lib/pcb/__tests__/compute-fill.test.ts` | 7 passed |
| `app/lib/pcb/__tests__/pcb-repair-agent.test.ts` | 8 passed |

Zero functional failures.

## Static gates

- `npx tsc --noEmit`: clean.
- Scoped ESLint over every changed production file (`app/lib/agent/**`,
  `resource-envelopes.ts`, `tool-invocation.ts`, `schematic-proposals.ts`,
  `tool-catalog.ts`): zero findings. `app/page.tsx` remains at its accepted
  14-error react-hooks baseline (untouched by B09.2 beyond the delegation
  edits, which introduced no new findings).
- Artifact byte-match gates: pass against regenerated fixtures (all four
  generators re-run: tool-registry, read-invocation, agent, b06-schematic).
- Evidence-path gate: 27/27 descriptors, zero missing `sourceEvidence` paths.
- Agent-exposed static registry: exactly 8 tools (asserted).
- Transient reproduction script `scripts/_tmp-b092-repro.ts`: deleted.

## CONFIRMED / INFERRED / UNKNOWN

**CONFIRMED**
- All seven pre-edit counterexamples reproduced before any edit and now fail
  closed (each a permanent regression test).
- No code path constructs `CanonicalProjectState` from substituted
  constituents; no manufactured revision digest exists.
- authorityStatus is digest- and manifest-pinned; only verified resources are
  consumable; v1 replays refuse explicitly.
- The run deadline discards late resolutions, never leaks late rejections,
  never calls a pre-aborted provider, and emits exactly one terminal event —
  proven with deterministic fake-timer adversaries.
- Structural schema validation rejects all hostile shapes pre- and
  post-normalization without mutating the source.
- Proposal scope uses the single canonical mark validator; the gateway
  enforces effective-actor capability and full actor/discovery integrity;
  apply/seal use the captured scope branch.
- Catalog claims match the code; every evidence path exists (CI-gated).
- Recovery semantics (Retry = new run, Switch selects first, stale/cancelled/
  deadline inert) hold in the PRODUCTION module page.tsx executes.

**INFERRED**
- The 5 full-suite failures are load-induced timing budgets only — inferred
  from isolated-green reruns and their history across B07.4→B09.1; no
  functional assertion failed.

**UNKNOWN**
- Live provider model turns (both OpenAI and Anthropic accounts remain out of
  credits). All provider-boundary behavior is proven against real adapters
  with fake SDK clients and real event dispatch; live end-to-end chat turns
  stay UNKNOWN, unchanged since B09.

## B10 readiness

> **SUPERSEDED BY B09.3.** The readiness verdict below was PREMATURE.
> Independent verification found four further gaps after this stage:
> lineage was absent from context integrity; schema validation was
> container-shape only; the schematic-snapshot resource was fictitious (an
> unregistered gateway bypass); and catalog/manifest claims overstated
> pre-B10 runtime availability. The authoritative readiness statement is in
> `artifacts/ai-control-plane-b09-3/validation-summary.md`.

~~B09 is structurally READY for B10 (context bridge)~~ — see the B09.3
supersession note above. The live-credit caveat carries forward unchanged.
B10 was NOT started — awaiting explicit owner authorization.
