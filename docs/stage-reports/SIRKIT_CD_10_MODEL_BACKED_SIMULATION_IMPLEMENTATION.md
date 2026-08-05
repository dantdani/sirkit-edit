# Sirkit CD-10 Model-Backed Simulation, Testbench, and Behavioral Verification

Date: 2026-07-18  
Branch: `codex/cd-10-model-backed-simulation`  
Specification SHA-256: `7B60B08DDEAE2DBBCA640221CBBD19918AE5005F24EB2FDEFE7FB430E4471F0A`  
Protected working copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`  
Protected original: `C:\Users\robsa\sirkit` (unchanged)

## Outcome

Sirkit now has a separate, fail-closed CD-10 foundation. The legacy SPICE subsystem remains available for diagnostic compatibility, but it cannot create CD-10 readiness evidence. The CD-10 path requires a current CD-9 `READY` report, exact immutable models and licenses, human-certified terminal maps, reviewed requirement-linked testbenches, an explicit variant/scenario/corner/provider denominator, CD-8 semantic graph lowering, a pinned network-denied provider environment, credible convergence, authoritative waveform data, uncertainty-aware measurements, typed assertions, complete coverage, and reproducibility evidence.

The current project cannot enter CD-10. CD-9 is not ready and is itself blocked upstream. No validated simulator sandbox/image/executable, production model registry, production testbench registry, licensed golden corpus, cross-provider evidence, sample authoritative campaign, or qualified simulation-engineering approval exists. The implementation therefore makes no simulation-verification claim.

## Baseline trust audit

| Existing path | Finding | CD-10 disposition |
|---|---|---|
| `app/lib/spice/ir.ts` | Reconstructs nets from coordinates/labels, merges ground sites, and can install a generic diode model. | Quarantined from CD-10 authority. CD-10 consumes CD-8 semantic net/endpoint IDs only. |
| `app/lib/spice/models.ts` | Allows inferred positional pin maps and stores raw mutable model text. | Replaced for CD-10 by content-addressed model identities and human-approved exact terminal certificates. |
| `app/lib/spice/netlist.ts` | Emits provider text and model content without a simulator-neutral semantic audit boundary. | Diagnostic only. CD-10 lowers typed IR and records every component/net/include/reference mapping. |
| `app/lib/spice/server/worker.ts` | Selects ngspice from mutable environment/PATH and lacks a validated OS/container sandbox and binary digest. | Diagnostic only. CD-10 execution fails closed until a pinned sandbox is independently validated. |
| `app/lib/spice/measurements.ts` | Useful math, but fuzzy signal lookup, implicit windows, and limited numerical uncertainty can overstate evidence. | CD-10 uses exact semantic selectors, explicit windows, raw/lossless artifacts, declared uncertainty, and boundary indeterminacy. |
| `app/lib/spice/persistence.ts` | Can truncate/replace older authoritative waveforms with metadata because of browser storage limits. | Not accepted by CD-10. Authoritative artifacts remain immutable; display derivations cannot be measured. |
| `app/api/simulate/route.ts` | Logs netlists and treats successful process/data production as success without CD-10 coverage authority. | Legacy diagnostic endpoint only; not referenced by CD-10 readiness. |

## Architecture and state semantics

Data flow is one-way and digest pinned:

`CD-8 semantic graph -> CD-9 READY gate -> exact model/testbench registries -> obligation denominator -> simulator-neutral IR -> audited provider lowering -> sandbox authorization -> process -> convergence -> waveform -> measurement -> assertion -> coverage -> readiness`

The following are deliberately distinct:

- process: queued, started, zero/nonzero exit, timeout, resource kill, license denial, malformed output, or provider error;
- convergence: credible, warning-limited, DC/transient nonconvergence, timestep failure, singular topology, model error, unsupported, not run, or unknown;
- measurement: valid, numerically indeterminate, invalid data, unsupported, or not evaluated;
- assertion: pass, fail, indeterminate, unknown, unsupported, stale, invalid testbench/model, nonconverged, not applicable, or not evaluated;
- coverage: every required denominator instance is partitioned exactly once;
- readiness: verified only for supported scope, verified with explicit limitations, or a typed blocking/external-review state.

An exit code, a converged plot, a nominal point, a black-box model, an ideal test double, or an unsupported instance cannot independently become a pass.

## Numerical and execution policy

- Exact waveform/branch selectors only; no suffix or display-name matching.
- Measurement windows, edge direction/ordinal, interpolation, units, uncertainty, and resolution-study requirements are versioned assets.
- Assertion decisions use the whole uncertainty interval. Boundary overlap is `indeterminate_numeric`.
- Display downsampling is a child artifact marked `authoritativeForMeasurement: false`.
- Retries are bounded and disclosed. Model, terminal, topology, or hidden-initial-condition edits are forbidden.
- Cache keys pin graph, projection, models, bindings, testbench, scenario, corner/sample, provider, environment, lowering, numerical, convergence, assertion, seed, license, and access state.
- Includes must be content addressed and sandbox relative. Authoritative execution requires a binary/image digest, validated environment, resource limits, and network denial.
- No CD-10 production process is spawned because that sandbox evidence does not yet exist.

## Threat model

Controls cover model substitution, filename/subcircuit-name identity confusion, positional terminal guesses, license bypass, path traversal, uncontrolled includes, mutable PATH/binary selection, environment leakage, secret-bearing logs, unbounded output, resource exhaustion, false convergence, display-waveform measurement, stale cache replay, partial denominator reporting, AI self-approval, and upstream digest changes. AI tools create proposals only; they cannot bind/approve models, modify the graph, execute campaigns, resolve evidence, or approve readiness.

## Implemented production surfaces

| Files | Purpose, invariant, test, compatibility, remaining limitation |
|---|---|
| `app/lib/model-simulation/types.ts`, `stable.ts`, `capability.ts` | Canonical contracts/digests and low-voltage profile; covered by TypeScript and deterministic tests; additive; full schema/expert qualification remains. |
| `provider.ts`, `safe-execution.ts` | Provider/environment authority and deny-by-default execution; security tests show diagnostic paths cannot authorize; legacy ngspice preserved; no validated production sandbox yet. |
| `model.ts` | Immutable model/license registry, exact applicability, terminal certificate, and binding gate; exact-binding tests pass; no automatic legacy import; production licensed models absent. |
| `testbench.ts`, `denominator.ts` | Human-reviewed testbench assets, explicit scenarios, and complete required-instance denominator; coverage tests pass; production requirement recipes/corners absent. |
| `ir.ts`, `lowering.ts` | CD-8 graph-only IR, distinct references, controlled test elements, content-addressed lowering, semantic audit; two-net microcase passes; specialized noise/distortion/statistical adapters remain blocked. |
| `convergence.ts`, `waveform.ts`, `measurement.ts`, `assertion.ts` | Typed convergence, immutable waveforms, non-authoritative display derivation, exact measurements, uncertainty-aware assertions; focused tests pass; advanced stability/noise/distortion operators need validated fixtures. |
| `coverage.ts`, `readiness.ts`, `cache.ts` | Exact partition, no-false-green aggregation, complete cache/replay manifests; missing-run/security tests pass; authoritative campaigns cannot yet be produced. |
| `project.ts`, `agent-tools.ts`, `index.ts` | Tamper-checked lifecycle/invalidation and proposal-only AI; TypeScript/focused tests pass; qualified approval workflow remains incomplete. |
| `app/api/model-simulation/*` | Scoped problem, denominator, measure/assert, readiness, execute-authorization, and proposal APIs; route/type checks pass; execute endpoint deliberately returns blocked/unsupported without a validated runner. |
| `app/model-simulation/page.tsx`, `app/components/model-simulation/ModelSimulationWorkspace.tsx` | Visible prerequisite/provider gates and review tables; production build/type checks cover them; no waveform plot is presented as proof. |
| `lib/persistence.ts` | CD-10 state/history validation and automatic archival on CD-8/CD-9 change; additive compatibility; large artifact bytes must remain in backend storage. |
| `app/lib/db/schema.ts`, `drizzle/0018_cd10_model_backed_simulation.sql`, journal | Immutable problem/registry/denominator/run/waveform/coverage/campaign/readiness/project metadata; schema/type checks pass; deployment migration not executed here. |
| `app/lib/model-simulation/corpus.ts`, `benchmark.ts`, benchmark registry/executor/types | 102 required corpus manifests plus three governed packages; manifest validates at 54 packages; all 102 cases honestly remain `manifest_only`. |

## Deliverable status (1-42)

- Implemented foundation: 2-8, 10-14, 21-23, 26, 28-32, 34-36, 39-40.
- Partial/diagnostic only: 1, 9, 15-20, 24-25, 27, 33, 37.
- Missing and blocking: qualified review/closure (38), authoritative sample `SimulationCampaign` (41), and acceptance-complete release evidence.
- This document is deliverable 42 and records the only formal verdict below.

## Verification corpus and benchmark evidence

- The required corpus manifest contains 102 cases: 12 model/binding, 11 lowering, 9 DC, 12 transient, 9 AC/stability, 9 noise/distortion, 11 corner/statistical, 10 measurement/assertion, 11 convergence/security, and 8 full embedded campaigns.
- Every entry includes expected applicability/result/limitations and is visibly `manifest_only`; this is registration, not golden evidence.
- Three benchmark packages cover manifest integrity, authority boundaries, and scale limits. The governed benchmark manifest validates at 54 packages with zero diagnostics.
- Focused deterministic tests cover prerequisite rejection, exact binding/applicability, graph-only lowering/reference preservation, display-waveform isolation, uncertainty boundaries, coverage partitioning, convergence classification, cache completeness, and execution denial.
- Focused CD-10/API suite: 13 tests passed. Complete serial Sirkit suite: 176 files passed, 1,198 tests passed, 9 skipped, zero failed.
- TypeScript and focused ESLint passed. The production build passed and emitted `/model-simulation` plus the scoped CD-10 APIs. Five pre-existing Turbopack executable/file-tracing warnings remain in legacy FreeRouting/ngspice paths.

## Blocker record

| Field | Evidence |
|---|---|
| Affected scope | Every production graph component, model, testbench, variant, scenario, corner, provider, measurement, and assertion. |
| Primary prerequisite | CD-9 has no current complete `READY` report permitting `approve_for_CD10`; CD-9 remains blocked upstream. |
| Model/license/terminal/parameter state | Production registry absent; therefore model applicability, terminal/parameter certificates, and license eligibility are `not_evaluated`. |
| Process/convergence/measurement/assertion | `not_run` / `not_run` / `not_evaluated` / `not_evaluated`. |
| Waveform/log/numerical witness | None exists; absence is a blocking coverage fact, not a pass. |
| Provider state | Local ngspice diagnostic only; mutable PATH/no validated sandbox or binary/image digest. |
| Root cause | Missing prerequisite and external/model/provider evidence; confidence 1.0. |
| Owner and next action | CD-9 owner first: obtain current full-oracle `READY`. CD-10/external next: approve exact registries, validate sandbox/provider corpus and licenses, then run the full denominator and qualified review. |
| Safe work retained | Contracts, gates, exact binding, IR/lowering, numerical/result separation, coverage/readiness, cache, persistence, APIs, UI, migration, corpus, and tests. |

## Runbooks

For nonconvergence: preserve raw logs/artifacts, classify process separately, follow the bounded retry ladder, disclose every aid, require a convergence study for aid-dependent results, and never edit models/topology during retry. For security: cancel, preserve redacted digests, quarantine provider/model artifacts, invalidate dependent cache/campaigns, and require independent review before reactivation. For provider updates: create a new provider/environment revision, rerun golden/cross-provider validation, invalidate prior eligibility, and never silently reuse old evidence.

## Formal verdict

### `BLOCKED`

Primary blocker: `BLOCKED BY CD-9`. Even after that closes, exact production models/testbenches, a validated sandboxed provider environment, licensed golden/cross-provider corpus, complete authoritative campaigns, and qualified simulation-engineering approval remain mandatory. No behavioral, hardware, PCB, manufacturing, or release claim is made.
