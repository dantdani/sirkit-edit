# B22-C - simulation authority: evidence, never authority; the 501 kept

Labels: **CONFIRMED** (executed at a fake seam and measured, or read at the cited file:line), **INFERRED** (code reading),
**RECORDED** (written down without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Base: `chapter/b22-sandboxed-computation` at `b4c7be7` (B22-B committed). Runbook B22-C `:922-934`; discovery D22-6, D22-7, D22-10,
D22-12, D22-13, D22-14 (the UI half), D22-19 (in part), D22-21, with section 9.5 items 17, 18, 21, 23, 24, 25, 29, 31 applied; owner
decisions OD-138, OD-141..OD-144 and OD-150's evidence half as applied. Nothing ran a process: every simulator, runner, worker and
model in the suites below is an in-process fake. Production simulation authority stays BLOCKED: the CD-10 501 text and its pins never
moved, `executeAuthoritativeSimulation` still throws `CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX`, no runtime profile or
provider the server holds is `validated` or authoritative-eligible, and no capability `unsupportedDomains` entry became reachable.

[B22-C review, 2026-10-02] An adversarial review CONFIRMED 25 findings against the first delivery; every one is fixed test-first and
recorded in section 12. Where a fix changed a statement below, the statement is corrected in place and marked `[B22-C review]`.

## 0. What B22-C is

Seven changes, each test-first (section 9):

1. The CD-10 execute and readiness evaluations read the provider and the environment from the server, never the body (D22-6, OD-138).
2. The SPICE Studio job store attaches a run's result before it publishes the terminal status (D22-7).
3. One output validator over CD-10's `createWaveformArtifact`; both live ngspice raw parsers route through it (D22-10).
4. An independent deck validator for CD-10's lowered netlists, with model libraries pinned by content digest (D22-19, in part).
5. One silent durable evidence aggregate, `computation.evidence.v1`, digest-bound over an explicit encoding (D22-12, D22-13).
6. Diagnostic wording with one fixed disclosure sentence; `/api/spice/reports` stays public and discloses caller-supplied records (D22-14).
7. SPICE AI evidence references labelled caller-supplied wherever they appear (D22-21, OD-150's evidence half).

## 1. The runbook's B22-C clauses (`:924-934`)

| clause | state | evidence |
|---|---|---|
| `:926` exact simulator and model libraries are pinned | **met for diagnostic only** | The simulator: the B22-A2 profile `ngspice-local-diagnostic`, pinned by install digest (B22-A3). Model libraries: `validateLoweredDeck` (`deck-validator.ts`) requires a CD-10 lowering's includes to be `artifact://sha256/<64 hex>`, to agree with `sha256:<hex>` and, when the server holds the text, with its SHA-256; decks lowered for both CD-10 provider paths pass it. [B22-C review] It is a library function: no CD-10 path calls `validateLoweredDeck` yet, and CD-10's own lowering (`lowering.ts:14`) checks only the `artifact://sha256/` prefix, so for CD-10 this is the check the authoritative path will need, not an enforced pin (coverage-2; section 11). The Studio run manifest's model checksums now hash the text the deck carries (`emittedModelText`, `server/manifest.ts:35`) and the run's evidence names each library by `artifact://sha256/<hex>` (pinned by `b22-c-evidence-store` case 8 since the review). No profile is qualified (BLOCKED-LIVE-QUALIFICATION, LB-10). |
| `:927` lowering deterministic and independently validated | **met in part** | `validateLoweredDeck` re-parses the emitted CD-10 deck and checks nodes, components, models, parameters, test elements, the reference node and includes against the IR (`b22-c-deck-validator`); [B22-C review] it reads every comment line (a `*#` command line and an `*ng_script` title are refused), refuses any line break but LF and NUL, holds a test-element card to exactly its kind, nodes and value, and an analysis line to the lowering's closed shape (security-1, security-2). No CD-10 path calls it yet (section 5). The Studio's coordinate-derived decks are not CD-10 decks and have no IR-to-deck validator beyond SEC-1's safety screen (recorded, section 11). |
| `:928` input project/model digests are current | **bound, recorded** | Execute and readiness resolve the provider and environment by id and digest from the server (section 2). The problem, registries, denominator, coverage, applicability and campaign stay body-taken: no server-held CD-10 state exists (OD-142's premise). A Studio run's evidence is bound to the server's SHA-256 of the submitted, validated snapshot - "bound to a submitted snapshot", never a server-held revision. |
| `:929` supported analyses and convergence policies explicit | **unchanged** | CD-10's provider `supportedAnalyses`, lowering's four analyses and the bounded retry ladder stand; nothing here widens them. |
| `:930` output units and numerical tolerances validated | **met for units and finiteness** | The output validator refuses non-finite values, short, over-long or empty output, misaligned points, a non-increasing time or frequency axis and a unit neither the vector's name nor ngspice's closed type list names, whole (section 4; [B22-C review] ngspice's own types - a TEMP or resistor sweep, device-parameter saves, decibel, phase, noise, pole-zero - are read with ngspice's unit). Numerical tolerances stay the CD-10 assertion bands; no tolerance study runs (recorded). |
| `:931` cancellation and timeout produce no fabricated results | **met** | A late worker completion never overwrites a cancelled record, and the worker's held `completed` event is never published over it (`b22-c-job-store-terminal` case 5); a refused output fails the run with no waveform, [B22-C review] its logs, manifest and netlist kept (`b22-c-output-validator` case 8); a completion whose evidence document the closed rules refuse fails the run itself with a closed reason, before any terminal event (`b22-c-job-store-terminal` cases 3 and 8). |
| `:932` reproducible or honestly marked environment dependent | **met (marked)** | Every evidence document carries `diagnostic_only` and `environment_dependent`; the seed and install digest are in it; reproducibility is by re-running the pinned profile (OD-141). |
| `:933` results are evidence, not automatic authority | **met** | `authority: "evidence_only"`; the aggregate is silent (no outbox effect); the SPICE AI cannot apply a design patch; its references are caller-supplied. |
| `:934` safety-critical claims out of scope | **met** | `functional_safety_certification`, `regulatory_certification` and `high_energy_fault_signoff` stay `unsupportedDomains`; no catalog kind or server provider names one (`b22-c-authority` case 7). |

Unblocking model-simulation execution needs every clause met by a qualified profile: it is not, so the 501 stands (OD-134).

## 2. The server's provider and environment (D22-6, OD-138)

- **Before** (CONFIRMED, `b22-c-authority` case 1 red on `b4c7be7`): a body provider and environment that declared themselves validated,
  digest-bearing and network-deny reached `authorized: true, mode: "authoritative"` and the 501; a consistent forged readiness set
  (case 4) reached `simulation_verified_for_supported_scope` with `approve_for_CD11` and `run_authoritative_campaign`.
- **Now**: `app/lib/computation/simulation-authority.ts` holds the server's providers (the diagnostic ngspice provider and the
  *unreviewed* analytical reference provider - a reviewer's approval is a body claim the server does not hold) and binds the
  environments against the B22-A2 runtime-profile registry. [B22-C review] regressions-1: the binding module is pure and
  browser-safe - `readiness.ts` and `safe-execution.ts`, which call it, are in the editor's client bundle (through `lib/persistence`
  and the CD-11 consumer), and the registry reads the file system. The registry is read by `simulation-authority-server.ts` in the
  two routes alone and passed in (`serverEnvironments`); a caller that passes none holds no environment, and every body environment
  is refused (fail-closed). `b22-c-authority` case 8 walks every `"use client"` graph and finds no Node built-in but the standing
  `node:crypto` (on the reviewed tree it found four node-only imports in the client graph - `node:fs`, `node:fs/promises` and
  `node:path` in `runtime-profile.ts`, `node:fs/promises` in `output-bounds.ts` - first reached as `lib/persistence.ts` <-
  `app/architecture/page.tsx` through `firmware-bringup/problem.ts` and `readiness.ts`; `lib/persistence.ts` is also what `app/page.tsx`
  imports). No `next build` was run: the gate is static. `bindSimulationAuthority` resolves each body copy by id and digest and
  requires it equal to the server's copy field for field; otherwise a closed code: `CD10_PROVIDER_NOT_SERVER_REGISTERED`,
  `CD10_PROVIDER_BODY_MISMATCH`, `CD10_ENVIRONMENT_NOT_SERVER_REGISTERED`, `CD10_ENVIRONMENT_BODY_MISMATCH`.
  - `authorizeSimulationExecution` (`safe-execution.ts:10`; [B22-C review] was :9) refuses on any binding code and evaluates only the server's copies; the
    execute route answers 409 "authoritative execution denied" with `code` (the first binding code); its 501 and 409 statements are
    byte-for-byte unchanged and the binding lives inside the authorization, so B16.0.20's mocked-authorization 501 pin still holds.
  - `evaluateSimulationReadiness` (`readiness.ts:16`; [B22-C review] was :15) adds the binding codes as gaps and checks authority on the server's copies; the
    readiness route answers 409 with the code.
  - **Recorded, not bound**: readiness's problem, model and testbench registries, denominator, coverage, applicability results and
    campaign (9.5 item 17), execute's lowering manifest and content digests, and the denominator route's body providers and
    environments. With no server-held authoritative pair none of them can reach `approve_for_CD11` or `run_authoritative_campaign`
    (case 5, every registry pair). [B22-C review] tests-3, coverage-9: each half of the binding is pinned alone at both routes - the
    server's provider with a forged or an unknown environment, and a forged copy of the server's provider - each refused 409 with its
    own code (cases 1 and 4); tests-8: past the binding, the request's network, resource bounds and includes are still checked
    against the server's copies (case 7). `foundation.test.ts`'s "does not authorize diagnostic environments" case now stops at the
    binding (its reviewed provider is a body claim); case 7 covers the checks its title names.
  - **The CD-11 consumer** (`firmware-bringup/problem.ts`) re-derives readiness through the same bound function and requires the
    recomputed digest to equal the persisted one, so a forged persisted verified report no longer recomputes to itself (case 6;
    pre-edit it did). Covered through the function; no CD-11 route test added. [B22-C review] It is browser-reachable, so it passes
    no registry: its recomputation refuses every environment and a CD-11 handoff stays blocked - the outcome every legitimate input
    already had, since no server-held pair can reach `approve_for_CD11` (stated choice, OD-138 as applied).

## 3. The dropped results (D22-7)

- **The counterexample** (CONFIRMED at the fake seam, `b22-c-job-store-terminal` cases 1-4 red on `b4c7be7`): a fake worker that emits
  `completed` through `onEvent` before it returns, exactly as `worker.ts` does, left the record with `waveforms: []`, no manifest and
  no `finishedAt`; the first terminal record a subscriber or the SSE stream received carried no data; the batch counted it completed;
  a worker that emitted `completed` and then threw left the run `completed`.
- **A second counterexample found here** (case 5, red on `b4c7be7`): after a cancel, the late worker's own `completed` EVENT reopened the
  cancelled record as `completed` - `addEvent` admits a terminal-to-terminal event, so the B16.0.23 guard protected the result but not
  the status. The held event closes it.
- **Now**: the job store holds the worker's terminal event, attaches the result (`Object.assign`, `finishedAt`) and the server-built
  evidence document, and only then publishes that event - never over a record a cancel already made terminal. The two
  `if (TERMINAL.has(job.record.status)) return;` guards stand (B16.0.23 §E/§F). A run counts completed in its batch only with its
  result and evidence; a completion without them counts failed.
- **The studio consequence, pinned**: the events route closes its stream at the first terminal record (`events/route.ts`) and the
  studio closes its EventSource there (`SpiceStudio.tsx`), so that record must already hold the data (case 2).
- [B22-C review] **One truth for a run and its batch** (regressions-4, security-4, coverage-5, tests-2). On the reviewed tree a
  completed run whose evidence document did not validate kept `completed` and published its completed event while its batch counted
  it failed, and `stopOnFailure` never fired; a measurement the studio lets a user rename to `""` was enough. Now a scalar's empty
  name is evidence like any other (case 7), and a document the closed rules still refuse (a name over 4096 characters, a NUL, no
  manifest) fails the run itself with `EVIDENCE_DOCUMENT_REFUSED: ... at <JSON paths>` before any terminal event; its own failed
  event replaces the worker's held completed one; the batch, the stream and `stopOnFailure` agree (cases 3 and 8). Its validated
  waveforms, scalars, logs, manifest and netlist stay on the record for inspection - what failed is the evidence, not the output -
  but it is no completion (stated choice: B16.0.23's evidence-reader parity fixture, a completed result with no manifest, keeps its
  waveforms readable; a SPICE report built from the studio's runs still lists such a run's scalars, as it lists every run's).
- [B22-C review] **Staged, then settled** (coverage-6, tests-1). On the reviewed tree the record turned `completed` before a bound
  store's append, so `getRun`, a subscriber joining in the window (the events route closes there) and the batch saw a terminal record
  whose evidence was `EVIDENCE_APPEND_PENDING`. Now the result is staged without touching the record, the append runs while the record
  stays non-terminal, and the result, its terminal status and the held event land together (case 9). The two B16.0.23 guards stand,
  unchanged in count and place (`job-store.ts:164`, B22-A1's C47 holds). A cancel that lands while an append is pending leaves the run
  cancelled and the appended document in the aggregate (stated choice, OD-141 as applied). The store's failure branches - a store
  that throws, a stale revision, a refused document - each leave the run completed with its closed durable reason (case 10).

## 4. One output validator (D22-10)

- **Before** (CONFIRMED, `b22-c-output-validator` red on `b4c7be7`): the worker's parser dropped `Infinity`, `1e999`, `nan`, `inf`,
  `1.#INF00e+000` and shifted every later value; `/api/simulate`'s kept `Infinity` and `1e999` (the 9.5 item 21 divergence) and dropped
  textual non-finite tokens alike; a short file was a warning (worker) or a short table (route); neither checked the axis or units.
- **Now**: `app/lib/computation/output-validator.ts` (`validateNgspiceAsciiOutput`, validator id `cd10-waveform-artifact/1`) refuses the
  whole output with one of `OUTPUT_HEADER_INVALID`, `OUTPUT_MALFORMED`, `OUTPUT_NON_FINITE`, `OUTPUT_SHORT`, `OUTPUT_EMPTY`,
  `OUTPUT_OVER_LIMIT`, `OUTPUT_AXIS_NOT_INCREASING`, `OUTPUT_UNIT_UNKNOWN`; the message names the rule, never the token. Every accepted
  output satisfies CD-10's `createWaveformArtifact` `valid` rule by construction, and `waveformArtifactOf` builds the
  `sirkit.waveform.v1` artifact (`valid`, `lossless_normalized`, never `authoritative_raw`) where one is wanted. Both parsers route
  through it (`waveforms.ts:28`, `simulate/route.ts:118`); their response shapes are unchanged for good files; `/api/simulate` answers a
  refusal 500 with the code. The ngspice profiles bind the wired validator (`ngspice-local-diagnostic` revision 3, `ngspice-oci`
  revision 2).
- [B22-C review] **Corrected by the review**: regressions-3 - the parse path built and discarded a full CD-10 artifact for every output
  (about sixteen FNV passes and several deep copies over every value, synchronously on the server) and joined the whole values section
  into one string; it now builds none (`b22-c-output-validator` case 7 counts zero `createWaveformArtifact` calls on the parse path) and
  reads the values line by line, once. regressions-5 - an output with no data point has its own code, `OUTPUT_EMPTY` ("it declares or
  holds no data point"), and `/api/simulate` keeps its B16.0.24 guidance "Simulation produced no data points. Check the netlist and
  analysis settings." for it (the former empty-table check could no longer fire and is gone). coverage-10 - the worker no longer throws
  past a refused output: the run fails with the closed message and keeps its logs, its manifest (the raw file's SHA-256) and its netlist,
  like every other failure (case 8). tests-7 - the header refusals and the route's own bounds are pinned (case 10).
- **Stated choices (recorded with OD-143 as applied, section 10)**: a raw without `No. Points:` is read only when every point is complete (B16.0.24's
  fixtures declare none); the point index must count 0, 1, 2...; a time or frequency axis must strictly increase, while a DC sweep's
  swept value - declared order, repeated by a nested sweep - is a signal on a point-index axis; [B22-C review] regressions-2: a unit
  comes from the vector name or from ngspice's declared type, read from one closed list of ngspice's type names
  (`NGSPICE_VECTOR_TYPE_UNITS`): time `s`, frequency `Hz`, voltage `V`, current `A`, the noise densities and integrals with ngspice's
  units, `temp-sweep` `°C`, `res-sweep` and impedance `Ω`, admittance `S`, capacitance `F`, charge `C`, power `W`, phase `°`, decibel
  `dB`; the six types ngspice itself declares without a unit (`notype`, `pole`, `zero`, `s-param`, `output-noise`, `input-noise`) keep
  the empty unit and are read; only a type outside the list is unknown and refused. The first delivery refused every type but the
  four, which refused a Studio DC sweep over TEMP or a resistor, every device-parameter save SEC-1's output allowlist admits, `vdb`/`vp`
  outputs and the noise and pole-zero outputs whole.
- **Recorded consequences**: the type list is INFERRED from ngspice's source (its front end's type table and `guess_type`), not from a
  live run: a type ngspice-46 writes that is not on it is refused, fail-closed, UNKNOWN until a live run; a transient that repeats a
  time point is refused (whether ngspice-46 ever writes one is UNKNOWN until a live run); B22-B's strict circuit-analysis reader stays
  its own (B22-D item 16). [B22-D, 2026-10-02] No longer: the strict reader is read by this validator under its own bounds; the
  validator also refuses a repeated `Flags:`, `No. Variables:` or `No. Points:` header and a complex value whose magnitude overflows,
  and `/api/simulate` derives a complex magnitude with the worker's formula (`adversarial-matrix.md` G4; `b22-d-adversarial` case 8).
  [B22-D review] The MSVC indeterminate `-1.#IND00e+000` is refused `OUTPUT_NON_FINITE` as a NaN (it was `OUTPUT_MALFORMED`;
  `adversarial-matrix.md` G5).

## 5. The independent deck validator (D22-19, in part)

- **Before** (CONFIRMED, `b22-c-deck-validator` case 1): a lowered deck whose element card named its nodes in swapped order passed
  `auditNetlistLowering` once its FNV digests were recomputed.
- **Now**: `app/lib/computation/deck-validator.ts` re-parses the emitted text on its own (it imports nothing from the lowering) and
  returns closed codes: the IR pin, unexpected lines, `.end`, exactly one analysis, every include mapped and sandbox-relative, every
  model library pinned by content digest, each IR instance's card with its nets, model and parameters, no unmapped card, every test
  element on its nets, no node collapse and node `0` exactly the explicit primary reference. Both CD-10 provider paths (diagnostic
  ngspice, analytical reference) lower to decks it accepts (case 2).
- It is built beside SEC-1's final deck screen, which stays the safety screen over executed Studio decks.
- [B22-C review] security-1: the first delivery skipped every `*` line unread, so a tampered deck carrying `*# shell ...` (SEC-1 probe
  p3: ngspice runs the rest as a command) or an `*ng_script` first line (p4: the deck runs as a script) passed, and it split on LF only.
  Now both comment forms are refused on any line, and NUL, VT, FF, CR, NEL, LS and PS anywhere (the set SEC-1's final screen refuses);
  the analysis line must have the one shape the lowering emits for its analysis. security-2: a test-element card was checked on its
  two nodes only; it must now be exactly its kind's letter, its two nodes and the IR's value. All `DECK_LINE_UNEXPECTED`,
  `DECK_TEST_ELEMENT_MISMATCH` or `DECK_ANALYSIS_INVALID` (case 6, seventeen rows red on the reviewed tree).
- [B22-C review] coverage-2: **no CD-10 path calls `validateLoweredDeck`** (nor `pinnedContentSha256`) yet - `lowerNetlistIr` itself has
  no production caller and execute stays 409/501 - and CD-10's own lowering (`lowering.ts:14`) checks only the `artifact://sha256/`
  prefix (case 3's `unpinned` asset lowers). The validator is the check the authoritative path will need; `b22-c-deck-validator` case 8
  pins that it has no caller, so wiring it moves that pin with this page.

## 6. Durable, digest-bound evidence (D22-12, D22-13; OD-141, OD-142, OD-143)

- **The aggregate**: `computation.evidence.v1` (`app/lib/computation/evidence-store.ts`) on the durable-workflow substrate, scoped by
  tenant/project/branch, one aggregate per evidence id. A document is closed: `labels` exactly `diagnostic_only`,
  `environment_dependent`; `authority: "evidence_only"`; `input: { binding: "bound to a submitted snapshot", snapshotSha256 }`; the
  profile id, its SHA-256 digest, the install digest and the seed; each model library's `artifact://sha256/<hex>`; the SHA-256 of the
  executed netlist and the raw file; the typed summary (scalars with encoded values; each waveform's points and the SHA-256 of its
  values). [B22-C review] regressions-4: a scalar's name may be empty (the studio lets a user clear a measurement's or a
  specification's name); every text stays bounded (4096 characters, no NUL).
- **The explicit encoding**: a value is `finite` with its number, `nan`, `positive_infinity`, `negative_infinity` or `absent`; the
  record and document digests are `durableWorkflowDigest` (SHA-256) and never meet a raw non-finite number (CD-10 writes a NaN band as
  `null`; the substrate refuses one). The snapshot digest is the SHA-256 of a canonical text with sorted keys and closed non-finite
  markers. [B22-C review] coverage-7: the snapshot hashed is `{ scope, project, runPlanId, parts }` - the server-derived
  tenant/project/branch scope with the submitted, validated snapshot, as OD-142's default reads - so two tenants submitting the same
  project JSON get different digests (`b22-c-job-store-terminal` case 6).
- **The store**: append is a compare-and-set on the revision (`stale_revision`) under the idempotency key of the evidence id and the
  document digest; load and history re-verify both digests and the document, refusing any disagreement with
  `EVIDENCE_DIGEST_MISMATCH`; no outbox effect, ever. The repository is injected (in-memory in tests).
- **Wiring, a stated deviation**: the job store builds the document for every completed run and keeps it on the record
  (`evidence.durable: not_recorded / EVIDENCE_STORE_UNBOUND`); `startRunPlan` takes an optional `evidenceStore` and, when bound, appends
  before the terminal status (case 6 of the job-store suite) - [B22-C review] with the record non-terminal throughout (case 9). No route binds a durable repository in B22-C: the SPICE routes' suites
  would reach the PostgreSQL runtime. The B21-A precedent (an unbound store) applies; binding it is the lead's.
- **The CD-10 tables** (9.5 item 23): not reused - their unique indexes key on FNV digests and nothing reads or writes them (case 7 of
  the evidence suite); they stay in the schema unwired; dropping them is a migration left to the owner. No migration was added.
- **Not changed**: the route classification still calls the in-process SPICE runs `project-durable` and the action registry "durable
  run records"; relabelling moves the byte-pinned B16.0.2 CSV and is left with the binding (section 11).

## 7. Wording (D22-14, the UI half; OD-144)

- The fixed sentence (`DIAGNOSTIC_SIMULATION_DISCLOSURE`, `app/lib/spice/types.ts:7`): "Diagnostic simulation only: these results come
  from a local ngspice process with no isolation boundary, so they are environment-dependent evidence and never verification,
  qualification or engineering approval."
- The report's default title is "<project> diagnostic simulation report", its HTML heading "Diagnostic specification summary", and its
  JSON and HTML carry `disclosures`. The studio's Reports & regression eyebrow label reads "Diagnostic regression" and the panel shows
  the sentence. `/api/spice/reports` stays public and adds "caller-supplied records, not verified by Sirkit" whatever title the caller
  sends.
- Pinned beside them: `/api/simulate`'s truthfulness sentence, the CD-10 page's "Validated sandbox unavailable" and "Current verdict:
  BLOCKED", and the SPICE AI's run note (discovery section 5 found them unpinned). The dated notes beside the B16.0.24 records and the
  `/api/simulate` header remain the closeout's.

## 8. SPICE AI evidence (D22-21; OD-150's evidence half)

Every `EvidenceRef` the route builds from `body.runs` carries `provenance: "caller-supplied"` (`ai/route.ts:233-243`), and so do the
tool results the model reads; the design-patch operation and the proposal carry the same references. `applyAiProposal` writes every
reference to `aiAuditLog` labelled caller-supplied whatever a browser-held proposal claims (`project.ts:330`); a design patch never
enters the change set. The studio's drawer reads "Typed tools · caller-supplied evidence · reviewable" and "N caller-supplied evidence
reference(s) attached - caller-supplied records, not verified by Sirkit." No reference resolves to a server-held record in B22-C: the
aggregate is not bound to the route (section 6), so none is labelled `server-held`.

## 9. Test-first record, pin moves and gates

- **Red first** on `b4c7be7` with the seven suites written before any code: 44 failed, 1 passed of 45 (`b22-c-wording` case 5 pins
  standing sentences). One red was a test error, not a counterexample (`b22-c-ai-evidence` case 2 applied a design patch, which throws);
  corrected and re-run red, 4 of 4, the counterexample being the audit log keeping `server-held`.
- **Green**: 45 of 45 after the change. Suites (`app/lib/computation/__tests__`), as delivered: `b22-c-authority` (7),
  `b22-c-job-store-terminal` (6), `b22-c-output-validator` (9), `b22-c-deck-validator` (7), `b22-c-evidence-store` (7), `b22-c-wording`
  (5), `b22-c-ai-evidence` (4). They ride the existing `app/lib/computation/__tests__` CI filter (no workflow line, no PGlite suite).
- [B22-C review] **After the review**: `b22-c-authority` (8), `b22-c-job-store-terminal` (10), `b22-c-output-validator` (10),
  `b22-c-deck-validator` (8), `b22-c-evidence-store` (8), `b22-c-wording` (5), `b22-c-ai-evidence` (4): 53 cases, section 12.
- [B22-C review] The suite headers now state the red sets the logs show: `b22-c-job-store-terminal` 1-6 (case 5 is the second
  counterexample), `b22-c-output-validator` 1-9, `b22-c-ai-evidence` 1-4 (coverage-8).
- **Reviewed pin moves**: `b22-a2-blocked-runner` case 4 (a self-declared body now ends 409 with a closed code, was the 501 - D22-6
  closed; the 501 statement and its other pins unchanged); `b22-a2-runtime-profile` case 13 (`ngspice-local-diagnostic` revision 3, was
  2); the B22-A1 page's citations C45-C47 (job-store lines moved; C47's guard now drops only a settlement over a cancelled record) and
  C44's note. No other pin moved.
- **Gates** (all through the lock, 2 workers): `app/lib/computation/__tests__`, `app/lib/model-simulation`, `app/api/model-simulation`,
  `app/lib/spice/__tests__`, `app/api/simulate/__tests__`, `app/api/__tests__`, `app/lib/firmware-bringup`, `app/api/firmware-bringup`,
  `app/lib/auth/__tests__`, the CI job-scope guard, `app/lib/engineering/__tests__` (the B17-A control inventory and the studio's
  source-reading suites), `app/lib/mcp`, `app/lib/agent/__tests__`, `app/lib/agent/orchestration/__tests__`, the B14.4 AST import gates;
  `tsc --noEmit`; eslint over every changed file; the B17 control-inventory, B16.0, B16.0.1, B16.0.2, B16.0.4 and B16.0.7 generators
  with no drift. The route census is unchanged (no route added).

## 10. Owner decisions as applied

- **OD-138**: applied as its default - the server's frozen provider set and runtime-profile registry, by id and digest, a differing
  body copy refused 409 with a closed code; execute still ends 409/501. Stated choices: the server holds the analytical reference
  provider only unreviewed; the binding lives inside `authorizeSimulationExecution` and `evaluateSimulationReadiness`, so every caller,
  the CD-11 consumer included, is bound. [B22-C review] The registry is the caller's argument (`serverEnvironments`), read server-side
  by the two routes; the pure evaluators import nothing node-only, and a caller without the registry - the browser-reachable CD-11
  consumer - refuses every environment (fail-closed; a CD-11 handoff stays blocked, as for every legitimate input before).
- **OD-141**: the silent aggregate `computation.evidence.v1` as described; stated deviation: no route binds it in B22-C (section 6).
  [B22-C review] Stated choices: a completion whose document the closed rules refuse fails the run itself with
  `EVIDENCE_DOCUMENT_REFUSED`, keeping its validated output, logs and manifest on the record for inspection, never as a completion;
  the record stays non-terminal while a bound store appends; a cancel that lands during the append leaves the run cancelled and the
  appended document in the aggregate.
- **OD-142**: the server SHA-256 of the submitted, validated snapshot plus the server-derived scope (`{ scope, project, runPlanId, parts }`
  after the run-plan screens; [B22-C review] coverage-7: the first delivery hashed no scope), labelled "bound to a submitted snapshot";
  no durable `SchematicState` store.
- **OD-143**: CD-10's FNV digests stay identity keys; evidence carries SHA-256 over the explicit encoding. As applied, the output
  validator's stated choices (section 4) are recorded here: a non-finite value is refused, never encoded into a waveform; [B22-C review]
  a unit comes from the vector's name or from ngspice's closed type list (INFERRED from its source), the six types ngspice declares
  without a unit keep the empty unit, any other type is refused; an output with no data point is `OUTPUT_EMPTY`; the parse path builds
  no CD-10 artifact (`waveformArtifactOf` builds one on demand).
- **OD-144**: the UI half applied as its default; the B16.0.24 notes and the `/api/simulate` header are the closeout's.
- **OD-150**: the evidence half applied as "labelled caller-supplied everywhere"; resolving to server-held records waits for the
  aggregate's binding.

## 11. What stays open (recorded, not closed here)

- Production simulation authority: BLOCKED (OD-134, LB-10); no qualified profile; the corpus is still manifest-only (D22-19's
  authoritative half).
- The aggregate's binding to a route or composition root, and with it server-held SPICE AI evidence and the classification relabel
  of the SPICE runs (`project-durable`, "durable run records", the byte-pinned B16.0.2 CSV).
- The Studio's coordinate-derived decks have no IR-to-deck validator (they are not CD-10 decks); `/api/simulate` and the Studio keep
  their own deck screens.
- The Studio record's cancel-at-request ordering (`cancelInternal`, pinned by B16.0.23 §E/§F) is unchanged.
- Readiness's and execute's other body-taken inputs and the denominator route's body providers (section 2).
- The vector types the validator refuses as unknown units, and whether ngspice repeats a time point (section 4): UNKNOWN until a live
  run; B22-B's strict reader and the validator are not yet run over one corpus (B22-D item 16). [B22-D, 2026-10-02] They are: one
  corpus of 39 raw files ([B22-D review] 37 before the review) through all four parsers (`b22-d-adversarial` case 8); the vector types and repeated time points stay UNKNOWN
  until the lead's live run (`b22-d-adversarial-live` case 16).
- The unwired CD-10 tables (section 6).
- [B22-C review] No CD-10 path calls `validateLoweredDeck`; CD-10's own lowering (`lowering.ts:14`) checks only the
  `artifact://sha256/` prefix of a model's storage reference (section 5).
- [B22-C review] The client-graph gate is static (a value-import walk); no `next build` ran here, so whether the production bundle
  builds is the lead's to confirm.
- [B22-C review] `foundation.test.ts`'s "does not authorize diagnostic environments as authoritative" now stops at the binding (its
  reviewed analytical provider is a body claim); `b22-c-authority` case 7 covers the checks its title names.

## 12. The adversarial review (2026-10-02)

25 findings CONFIRMED against the first delivery (one high after verification, three medium, the rest low). Each was fixed
test-first: the suites were extended first and run on the reviewed tree - 15 cases failed, 33 passed of 48 (`cr-red-2`). The
assertions that were already green there (a test-strength finding) were each proved by a deliberate breakage of the source, caught,
and the source restored byte for byte (verified by SHA-256).

| finding | what was wrong | fix | pinned by |
|---|---|---|---|
| regressions-1 | `readiness.ts` and `safe-execution.ts` imported the binding, which imported the runtime-profile registry (`node:fs`, `node:fs/promises`, `node:path`): the editor's client bundle reached them | the binding is pure; the registry is read by `simulation-authority-server.ts` in the two routes and passed in; none is fail-closed | `b22-c-authority` cases 2 and 8 (red) |
| regressions-2 | every vector type but time, frequency, voltage and current was refused whole | one closed list of ngspice's type names with ngspice's units (section 4) | `b22-c-output-validator` case 6 (red) |
| regressions-3 | every accepted output built and discarded a CD-10 artifact on the parse path | no artifact on the parse path; `waveformArtifactOf` on demand; values read line by line | `b22-c-output-validator` case 7 (red) |
| regressions-4, security-4, coverage-5, tests-2 | a completed run whose document did not validate stayed `completed` while its batch said failed | empty names admitted; a refused document fails the run itself before any terminal event | `b22-c-job-store-terminal` cases 3, 7, 8 (red) |
| regressions-5 | an empty output answered `OUTPUT_SHORT` with a false rule; the route's guidance was dead | `OUTPUT_EMPTY`; the route keeps its guidance | `b22-c-output-validator` case 4 (red) |
| regressions-6, coverage-4 | the A2/A3 pages and the threat model's T11/T12 rows stated pre-B22-C facts | dated `[B22-C review]` corrections in place | `b22-c-output-validator` case 9, `b22-c-authority` case 3 (red) |
| security-1 | `*` lines skipped unread; LF-only split | `*#` and `*ng_script` refused; non-LF breaks and NUL refused; analysis shape closed | `b22-c-deck-validator` case 6 (red) |
| security-2 | a test-element card checked on its nodes only | exactly letter, nodes and value | `b22-c-deck-validator` case 6 (red) |
| coverage-2 | the page recorded the deck validator's model pin as enforced | page corrected; the absence of a caller pinned | `b22-c-deck-validator` case 8 (red) |
| coverage-6, tests-1 | the record turned terminal before a bound store's append | staged result, settled together | `b22-c-job-store-terminal` case 9 (red) |
| coverage-7 | the snapshot digest named no scope | scope hashed with the snapshot | `b22-c-job-store-terminal` case 6 (red) |
| coverage-8 | three suite headers misstated their red sets | headers corrected from the logs | the logs `c-red-pre-edit`, `c-red-pre-edit-ai2` |
| coverage-9, tests-3 | the environment half of the binding never tested alone | each half alone at both routes | `b22-c-authority` cases 1 and 4 (breakage proved) |
| coverage-10 | a refused output threw past the run's logs and manifest | the worker returns a failed result keeping them | `b22-c-output-validator` case 8 (red) |
| tests-4 | the model-checksum change had no test | manifest and evidence references pinned | `b22-c-evidence-store` case 8, `b22-c-job-store-terminal` case 6 (breakage proved) |
| tests-5 | the document-digest re-check was never reached alone | four alterations each only one check catches | `b22-c-evidence-store` case 3 (breakage proved) |
| tests-6 | the append's failure branches never ran | a throwing, a stale and a refusing store | `b22-c-job-store-terminal` case 10 (breakage proved) |
| tests-7 | `OUTPUT_HEADER_INVALID` and the route's bounds untested | seven header rows; the route's point bound | `b22-c-output-validator` case 10 (breakage proved) |
| tests-8 | the checks past the binding untested | network, resource and include checks with the server's copies | `b22-c-authority` case 7 (breakage proved) |
