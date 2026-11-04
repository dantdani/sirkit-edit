# Section K map — work log, persistent recovery, reusable parts, real 3D (2026-11-04)

Read-only source map for runbook section K (`artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md:393-533`) under
OD-260 (`artifacts/remaining-builder-program/OWNER_DECISIONS.md:3647-3667`). Tree: `codex/astra-foundation` at `7d8ef423` (J5
integration). No source, test or configuration was changed; nothing was run beyond `grep`/`sed`/`wc`; no paid call. Every claim is
CONFIRMED (read at `file:line`), INFERRED (deduced from code) or PROPOSED (a K increment). Everything K will prove is fixture- or
fake-labelled at US$0 (OD-260 item 10).

L and M already delivered most of K's machinery (sections 1-6 say exactly what). K's real gaps are: (a) no Work log; (b) acquisition
events are missing from the chat; (c) the acquisition task has no strategy ladder and stops after one pass; (d) no reusable library
view; (e) no 3D model path at all; (f) the remaining allowance is not shown.

## 0. OD-260 defaults that shape this map

| item | default | consequence here |
|---|---|---|
| 1 | VRML 2.0 through three's bundled `VRMLLoader`; STEP is metadata, labelled unsupported | section 6; no new dependency |
| 2 | original MIT VRML fixture models, authored offline; no `packages3D` fetch | K5's fixture bytes |
| 3 | one new canonical wrapped GET read route (census 177 -> 178), unless an existing route can carry the bytes | section 6.4 |
| 4 | a generation block's missing role keeps waiting for a library action and Retry; K only adds a Build Library search link | K2, K3 scope |
| 5 | spend stays per task (OD-252 item 1); the remaining allowance is shown in the work log | section 4 |
| 6 | acquisition events join the conversation's activity entry, collapsed under "Show details" | section 1.3 |
| 7 | VRML/STEP text goes to the append-only durable store, KiCad CC-BY-SA, indefinite retention, 2 MiB per model | sections 5-6 |
| 8 | `app/page.tsx` keeps 9,156 lines; logic goes in components and hooks | pins at `b24-d3-accessible-names.test.ts:100,316`, `j3-page-carriage.test.ts:36`, `l6-post-apply-admission.test.ts:306`, `j5-open-sheet-wiring.test.tsx:91`; markup counts `b21-e2-run-view.test.ts:108-109` (`onClick=` 87, `<button` 42) |
| 9-10 | evidence lives here; cite L and M instead of redoing them; US$0 | — |

## 1. K.2 — the typed event path and where a Work log renders

### 1.1 The event sources that exist

| source | identity, order, dedup | the events | file:line |
|---|---|---|---|
| chat loop `AgentRunEvent` | `runId`; `callId` per tool call; `emitOnce` allows exactly one terminal event and nothing after it | `run_started`, `text_delta{phase: interim\|final}`, `tool_started`, `tool_finished{ok,status,reason?}`, `tool_refused`, the typed artifacts (`generation_task_ready`, `component_resolution_ready`, `draft_request_ready`, `sheet_organization_ready`, …), `run_failed`, `run_completed` | `app/lib/agent/contracts.ts:398-447`; `app/lib/agent/loop.ts:285-298` (emitOnce), `:302`, `:409`, `:469`, `:514`, `:728` |
| interim-text guard (keep) | a step that calls a propose or mutate tool emits its text only after the calls resolve | `holdText` | `loop.ts:375-385`, `:755` |
| orchestration | closed key sets, bounded text, the redactor | `plan`, `specialist_started`, `specialist_finished`, `partial_result`, `degraded` | `contracts.ts:475-494`; `app/lib/agent/orchestration/run-events.ts:25-50` (bounds, keys), `:60` (`boundedRunEventText`) |
| trace recorder | identity frozen at construction; one terminal record; **in-memory only** (durable retention is an open owner decision) | normalized mirror of the run | `app/lib/agent/trace-recorder.ts:1-46`, `:95` |
| generation task milestones (durable) | `seq`, cursor paging, a 48-event ring (`gap: true` past it); a ≤240-char redacted line; closed data shapes | 19 types: `plan_ready`, `block_started`, `block_saved`, `slice_yielded`, `waiting_provider`, `waiting_resource`, `strategy_changed`, `validation_result`, `result_ready`, `paused`, `resumed`, `cancel_requested`, `cancelled`, `failed`, … | `app/lib/generation-task/events.ts:1-13`, `:23-33`, `:42-62`, `:101-141` |
| generation live activity | the current attempt's last 8 lines (display only, not ordered) | — | `events.ts:143-173` |
| acquisition task events (durable on the cr-task head) | `seq`/`nextSeq`, a 64-event ring | 22 kinds: `local_search`, `source_selected`, `source_skipped`, `retrieved`, `stored`, `validated`, `validation_failed`, `awaiting_handoff`, `published`, `proposal_ready`, `waiting_resource`, `blocked`, … | `app/lib/acquisition/cad-acquisition-contract.ts:51-58`; `app/lib/component-resolution/task/contracts.ts:36`, `:81-84` |
| public progress lines for resolution tools | `tool_started` mapped to a sentence | "Searching the local library for eligible published revisions" | `app/lib/project/component-resolution-events.ts:40-41`, `:57-60`; used at `app/page.tsx:4701` |

### 1.2 The reducers and the UI

| piece | what it does | file:line |
|---|---|---|
| `reduceRunView` / `projectRunView` | folds run events into counters, the answer and notes; interim text becomes labelled notes when the run ends | `app/lib/project/chat-run-view.ts:98-150`, `:158-187` |
| tool-line wording | `toolLineLabel`, `refusedLineLabel`, `TOOL_STATUS_LABELS` (separate wording for proposal sealed, task started, control requested) | `chat-run-view.ts:34-75` |
| the activity entry ("log" message) | `EntryLogRow {id, text, status: running\|done\|error}`: no phase, source or attempt field | `chat-run-view.ts:447-448`; `app/page.tsx:153` |
| saved with the project | the last 200 messages; log rows map only `id/text/status` | `app/page.tsx:3007-3020` |
| chat intake | `applyAgentEvent`; scope guard `if (!scope.isCurrent()) return` | `app/page.tsx:4690-4711`; `generation_task_ready` at `:4759`; `component_resolution_ready` at `:4856`; orchestration lines at `:4926` |
| following a generation task | milestones become activity steps; the status card; reattach on reload or project open | `app/page.tsx:5457-5469`, `:5472-5493`, `:5592-5596`; card `app/components/chat/GenerationTaskStatus.tsx` (97 lines) |
| the activity-entry renderer | `MessageBubble`; the ONLY "Show details" toggle is for module-contract notes | `app/page.tsx:9029-9095` (toggle `:9073`; status card `:9091`) |
| the acquisition view | polled every `POLL_MS` from the Missing parts list (PCB tab); shows the **last 4 events**; no scope check on a late poll answer (INFERRED risk) | `app/components/parts/CadAcquisitionPanel.tsx:94-110`, `:148-150`, `:169`; mounted at `app/components/pcb/MissingPartsList.tsx:50` |

### 1.3 Gaps (CONFIRMED unless marked)

1. **No Work log.** No "Work log" string exists in `app/`. Activity rows carry only text and status, so intent, dispatch, received,
   validated, stored, proposed and committed are not separate typed phases (K.2 bullet 4).
2. **Acquisition never reaches the chat as a typed event.** `sirkit.parts.acquisition-start` returns `kind: "read"`
   (`app/lib/agent/cad-acquisition-reads.ts:135`), so the loop emits only `tool_finished … succeeded` ("— done",
   `chat-run-view.ts:64`). The page has no acquisition case (no `acquisition` match in `page.tsx`'s intake). OD-260 item 6 asks for those
   events in the activity entry.
3. **Events are truncated.** The panel shows 4 events; the head keeps 64 (`task/contracts.ts:36`); the generation ring keeps 48. A work
   log must say "earlier steps not kept" when `gap: true`.
4. **The remaining allowance is not shown.** The server snapshot carries `allowance.remaining` (`app/lib/generation-task/snapshot.ts:75`);
   the client view drops it (`app/lib/project/generation-task-client.ts:32-61`, `:110`). The counts line shows calls and searches only
   (`:435-438`).
5. **A missing role has no library link.** The card prints "Needs a part: …" (`GenerationTaskStatus.tsx:37`, `:55-56`) with no Build
   Library search action (OD-260 item 4).
6. **Late poll answers (INFERRED).** A late poll answer in `CadAcquisitionPanel` is applied by `partId` with no scope re-check
   (`:100-107`). This is a K.2 "late event from a retired run" risk to test.

What is already right and must stay: the interim-text hold (`loop.ts:375-385`); the one-terminal rule (`:285-289`); no
reasoning/prompt/tool output in milestones (`events.ts:8-10`); the redactor (`run-events.ts:60`); stop-reason vocabulary
(`contracts.ts:465`); and reattach without replay (`page.tsx:5457-5469`, proven by `e2e/l4-generation-task.spec.ts` case 1).

## 2. K.3 — where the "three or four attempts" abandonment really happens

### 2.1 Every bounded counter on the missing-part path

| layer | counter | value | file:line | at the limit | ends the logical task? | K verdict |
|---|---|---|---|---|---|---|
| chat run | model steps | 6 | `agent/contracts.ts:182`; `loop.ts:392-393` | `run_failed max_steps` | the TURN only | keep (finite worker) |
| chat run | tool calls | 10 | `contracts.ts:183`; `loop.ts:422-424` | the next call is refused `budget_exhausted` | turn | keep |
| chat run | identical calls (tool@version + args digest) | 2 | `contracts.ts:186`; `loop.ts:445-450` | the **3rd** identical call is refused: "This exact call already ran in this run; its result has not changed." | turn | keep the guard. **INFERRED likely source of the report**: polling `sirkit.parts.acquisition-status {taskId}` a 3rd time in one turn is refused, and the message is false for a live durable task. K2/K3 route the follow-up to the durable task instead |
| chat run | deadline | 120 s | `contracts.ts:185`; `loop.ts:315` | `run_failed deadline` | turn | keep |
| chat run | one side-effecting artifact | 1 | `loop.ts:459-466` | `proposal_exists` | turn | keep |
| orchestration | attempts per specialist | 2 | `orchestration/scheduler.ts:66` | `escalated` | specialist | keep |
| generation task | stagnant slices per strategy | 3 | `generation-task/contracts.ts:134`; `worker/progress.ts:67-75` | the **strategy changes** (S1→…→S5) | no | already the K.3 design (L) |
| generation task | the strategy ladder | S1..S6 | `generation-task/vocabulary.ts:37`; `worker/progress.ts:10-17`, `:29-40`; `worker/slices.ts:417-454`, `:520-548` | S6: block `blocked missing_part` ("Add or approve the part, then retry the block") or `no_progress` | block waits (resumable) | keep (OD-260 item 4); add the library link |
| generation task | attempts per slice | 5 | `contracts.ts:133`; `generation-task/store.ts:738` | `platform_failure` blocker | waits for Resume | honest; keep |
| generation planner | plan attempts | 2 | `app/lib/schematic/build-multi-generation.ts:140`, `:187` | the single-block fallback | no | keep |
| generation provider | backoff | 5 s → 300 s, ≥ Retry-After | `worker/accounting.ts:87-94` | `waiting-for-provider` | no | correct (honours the real Retry-After) |
| **acquisition task** | **attempts per slice** | **3** | `component-resolution/task/contracts.ts:34`; `task/store.ts:215-229` | after 3 failed claims: `waiting-for-resource` with blocker **`source_unavailable`** ("the slice failed repeatedly … waits for Resume"), **no schedule** | **yes, until a human Resume** | **CHANGE (K3)**: "three failures means stop" with a misleading code. Report a worker failure honestly, schedule bounded backoff, then fall into the recovery policy |
| **acquisition pipeline** | **sources tried** | one pass over the admitted adapters (fixture + bundled; GitLab blocked) | `component-resolution/acquisition/pipeline.ts:102-130` | `blocked no_matching_asset` / `source_unavailable` / `source_terms` → `waiting-for-resource`, **no next strategy, no schedule** | **yes** | **CHANGE (K3)**: there is no strategy ladder (K.3 items 2, 3, 5, 8) |
| acquisition | review re-checks | 12, backoff 15 s → 15 min | `task/contracts.ts:35-38`; `task/slices.ts:196-210` | "use Check again after the review" | waits for a human (correct) | keep |
| acquisition | attempt log | 16 | `task/contracts.ts:39`; `slices.ts:148`, `:156`, `:166` | the oldest attempts drop | — | K3: keep rejected evidence separately |
| CAD egress | Retry-After clamp | 1 h | `app/lib/acquisition/cad-egress.ts:59-60`, `:80-87` | a longer real wait is **clipped** to 1 h | no (a scheduled wait) | **CHANGE (K3)**: defer to the real time (K.3 item 4) |
| CAD registry | in-call retries | 0 (invariant) | `cad-source-registry.ts:166`, `:194`, `:228`, `:317` | — | — | keep |
| distributor registry | in-call retries | 0 | `app/lib/acquisition/source-registry.ts:249`, `:322`, `:418`, `:498` | a 429 degrades to a missing price | — | keep |
| agent vendor share | quota share | 0.25 | `admission-control.ts:37`, `:257-275` | `paused` with a retry time | — | keep |
| ingestion helper | page retries | 2 (clamped 0..5); the wait is `min(5 s, Retry-After)` | `app/lib/atomic/ingestion.ts:157-207` (`:177`, `:186`) | throws | — | **no production caller** (grep: only its definition). It clips Retry-After. K1 pins it as unused (tripwire); do not adopt it for K |

**Conclusion (INFERRED from code; the owner's exact trace was not retained).** No path abandons a whole durable task after 3-4 tries
except the acquisition task:

- its 3-claim limit, which then misreports `source_unavailable`;
- its single source pass.

The chat-side "gives up" is the turn's finite budget and its identical-call guard (6 steps / 10 calls / the 3rd identical call). That is
correct for a worker turn, but nothing hands the remaining work to a durable task the chat then follows. The generation task already
does not give up (L).

### 2.2 The durable task record K.3 asks for vs what exists

| K.3 field | generation task (L) | acquisition task `cr-task` (M) | missing |
|---|---|---|---|
| requirement / target identity | prompt, plan, base digest (`generation-task/contracts.ts:217`ff) | `request` + `requirementDigest`, `target`, `instances`, `base` (`task/contracts.ts:48-55`) | requirement-only targets (OD-260 item 4: not in K) |
| current strategy | `block.strategy`, `strategyHistory` (`contracts.ts:195-200`) | **none** (only `stage`) | K3 |
| candidates and rejection reasons | facts checkpoint (`generation-task/checkpoint.ts`) | `candidate` / `candidateId` (the LATEST only); `blocker` | the list of rejected candidates with reason codes and report digests (K3) |
| attempted sources / queries | missing roles + empty searches (`worker/progress.ts:79`ff) | `attempts[]` {sourceId, outcome, code, detail, at}, ≤16 | the locator / variant tried and why it changed (K3) |
| evidence references | artifact refs | `candidate.objects[].sha256`, `reportDigest`, stage evidence (`cad-acquisition-contract.ts:85-96`) | — |
| pending work, next eligible retry | `pending[].notBefore`, liveness `retryAt` | `pending {sliceId, notBefore, owner}` (`task/contracts.ts:65`) | a schedule for blocked states (K3) |
| cancellation | `control` | `control.cancel` (`:69`); fenced at the claim (`task/store.ts:205-213`) | — |
| budget reservations | `reservations[]`, `allowance` (`contracts.ts:210-211`) | none (a US$0 source; in-process quota meter) | a quota-wait record only; no money (K3) |
| checkpoint version / CAS | fence, `eventSeq`, slice counters | `sliceCounter`, `fenceCounter`, `nextSeq`, CAS `commitHead` | an explicit `checkpointVersion` (optional) |

## 3. Reuse of L and M (cite; do not redo)

| K need | already proven by |
|---|---|
| durable task, finite slices, checkpoint, continuation | `l3-continuation`, `l3-long-task`, `l3-worker-process` (`app/lib/generation-task/__tests__/`) |
| strategy ladder; identical no-progress stops; a real blocker keeps progress | `l3-strategies` cases 1-5, `l6-repeat-turns`, `l6-missing-role`, `l6-unfilled-role-same-turn` |
| crash/resume, uncertain spend, no repeated paid work | `l3-crash-resume`, `l3-input-allowance`, `l6-plan-reservation`, `l6-input-concurrency` |
| fencing, lease expiry, late completion | `l3-fencing`, `l2-generation-task-pglite` (a fence mutant is killed) |
| ordered events, cursor, reconnect, reload reattach | `app/api/generation-tasks/__tests__/l4-routes.test.ts` cases 2, 4-6; `l4-task-client`; `e2e/l4-generation-task.spec.ts` |
| acquisition: fixture source → bytes → parse → durable candidate → two-human publication → exact binding | `m2-3-acquisition-pipeline-pglite`, `m2-3-cad-validation`, `m2-3-object-store`, `m2-5-resolution-after-acquisition-pglite`, `e2e/m2-acquire-missing-part.spec.ts` (`app/lib/component-resolution/__tests__/`) |
| reuse with zero transport; foreign tenant reads nothing; withdrawn never newly selected; byte change = new object | `m2-6-reuse-isolation-pglite` |
| refusals: rejected review, AI actor, governance unset, `source_terms`, a 429 at the real Retry-After, hostile symbol, cancel fence, revoked requester, closed input | `m2-6-acquisition-refusals-pglite` (cases at `:57`, `:75`, `:93`, `:109`, `:122`, `:141`, `:152`, `:166`, `:178`) |
| registry / egress bounds | `m2-2-cad-source-registry`, `m2-2-cad-egress` |
| missing-facts checklist, draft request (unverified, human-filed) | `pr-f-missing-facts`, `pr-f-missing-parts-parity`, `e2e/pr-f-missing-parts.spec.ts` |
| hostile KiCad input; model-path policy | `app/lib/atomic/__tests__/b19-d-kicad-hostile.test.ts`, `app/lib/kicad/__tests__/b19-d-sexp-hostile.test.ts`, `governance-security.test.ts` |
| one 3D renderer and its view session | `app/components/pcb/__tests__/pcb3d-view-session.test.tsx`, `app/lib/pcb/__tests__/3d-build-scene.test.ts` |

## 4. K.4 — spend and admission controls to reuse

| control | where | K use |
|---|---|---|
| per-task allowance unit (60 calls / 480k output / 300 searches / 72 h); operator may only lower it; +4 extensions | `generation-task/contracts.ts:148-179` | show `allowance.remaining` in the work log (gap 1.3-4) |
| pre-call reservation, uncertain spend kept, `admitCall` | `worker/accounting.ts:184`ff, `:231`ff; `contracts.ts:208-210` | unchanged |
| no USD price table in the product | `contracts.ts:148-149` ("F18") | the work log shows units, not dollars; the US$5 builder ledger stays `../live-spend.json` (known 1.3628, reserved open 2.66, provable 0.9772) |
| vendor / CAD meters: quota, breaker, agent share | `admission-control.ts:37`, `:257-275`; `cad-egress.ts:113-116` | acquisition is US$0 (KiCad / fixture); the meters are the only "budget" |
| provider failures without Retry; Switch | `run-consumer.ts:19-44`, `:73-75` | unchanged (no silent provider route) |
| live-test authority | OD-260 item 10; `../remaining-blockers.md` section 2 | no live call in K |

## 5. K.5 — acquisition: search → obtain → validate → store → use

| link | exists (file:line) | missing for K |
|---|---|---|
| search the local library first | `task/slices.ts:116-133` (a reused published revision: "nothing downloaded"); `component-resolution/acquisition/catalog-recall.ts`; M1 `candidate-search.ts` | — |
| sourcing observations (never CAD) | `external-search.ts`, `agent-read-port.ts`; `source-registry.ts` authority class `sourcing_observation` only | — (keep read-only) |
| identity | the target comes from the sheet's catalog part (`library:name`, footprint hint) (`task/service.ts:50-67`; `acquisition/candidate.ts:30-41`) | requirement-only identity resolution (OD-260 item 4: not in K) |
| obtain (bounded transport) | `cad-egress.ts` over `net/outbound-fetch.ts` (exact hosts, deadline, byte ceiling, no redirects, 4xx body never read `:125-146`); adapters `cad-adapters/{bundled,network}.ts`; registry rows: `kicad-bundled` enabled `:154`, `kicad-gitlab` blocked `:182` (OD-M2-3/5/12/13), `fixture-kicad` fixture `:215` | the **model** kind: refused at `cad-source-registry.ts:141`, invariant `:326-327`; `pipeline.ts:88` ("3D model: not retrieved in M2") |
| validate | `acquisition/cad-validation.ts` (`validateAcquiredAssets`: pin 1 / pad 1, pins to pads, pin table, verdict validated / conflicting / unsupported); production parsers `parseSymbolAssets` / `parseFootprintAsset` (`atomic/kicad-assets.ts`) under `assertBoundedSExpression` | a model ↔ package check (K5) |
| store | `cad-object-store.ts:1-17` (`atomic.acquired-object.v1`, scoped, re-hashed on every read, `indefinite` + redistributable only); `DurableAcquisitionCandidateStore` (`acquisition/candidate.ts`) | a model object kind with a 2 MiB ceiling (OD-260 item 7; `CAD_TEXT_MAX_BYTES` is 1 MiB, `cad-source-registry.ts:46`) |
| review / publish | `acquisition/handoff.ts` → `atomic/publication-review.ts` (two humans, governance scope); `atomic/server-repository.ts:167-175` re-parses symbol and footprint against their bytes, **but never a model** | model re-inspection at publication; `modelVersionIds` filled (K5) |
| use | M1 sealed batch → `schematic.resolve-components`; a pinned exact revision (`atomic/types.ts:600-618`, `:637-645`) | — |
| reuse / freshness | `m2-6-reuse-isolation-pglite`; revision status (`atomic/server-catalog.ts`) | a reuse check of licence freshness + an upgrade/withdrawal path shown (K4) |
| reusable library view | Build Library: catalog search, "Use published exact revision", "Request evidence review" (`app/components/editor/BuildLibraryPanel.tsx:14-18`, `:596`, `:643`); the per-instance acquisition panel; the governance-only `ComponentReviewInbox` | **one library view**: acquired candidates + published revisions with source/evidence, asset availability (symbol / footprint / 3D), validation / review status and "Use in project" (K4) |
| draft when unobtainable | missing-facts action 4 + `sirkit.parts.draft-request` (unverified, human-filed); `blocker.draftOffered` (`cad-acquisition-contract.ts:35-49`) | the acquisition panel does not link the draft path when `draftOffered` (K3/K4) |

Schema (`app/lib/db/schema.ts`):

- **Already present:** `atomic_raw_objects` (`:589-599`, utf8/base64); `atomic_cad_assets.kind` includes `"model"` (`:608-620`); part
  revisions (`:654-669`); `pcb_footprints.models` (`:488`).
- **No migration is needed for K:** VRML is text, and the acquired-object store is a durable-workflow aggregate.

## 6. K.6 — real 3D models

### 6.1 What exists

| piece | state | file:line |
|---|---|---|
| `createModelAsset` | hash and metadata; `inspected: boolean` → `inspectionState "safe"`: **not an inspection**; **zero callers** (grep: definition only, no test) | `app/lib/atomic/kicad-assets.ts:286-310` |
| the model type | `inspectionState: not_inspected\|safe\|unsupported\|rejected`; optional bbox | `app/lib/atomic/types.ts:291-304` |
| the mechanical profile | requires `inspectionState === "safe"` (`validation.ts:141-147`), so a boolean could satisfy it today | `app/lib/atomic/validation.ts:141-147` |
| footprint model references | parsed with offset / rotation / scale, state `missing\|blocked`; path policy `${KICADn_3DMODEL_DIR}/…` | `kicad-assets.ts:233-267`; `atomic/security.ts:122-150`; `pcb/types.ts:52-57`, `:74` |
| ingest limit | `maxModelBytes` 100 MiB (OD-260 item 7 sets the K ceiling at 2 MiB) | `security.ts:5-7` |
| scene | pure three.js; **placeholder boxes**, courtyard-sized, NOT labelled as placeholders (group name only) | `app/lib/pcb/3d/geom/footprint-mesh.ts:1-9`, `:101-120`; `app/lib/pcb/3d/build-scene.ts:239-251`; `disposeScene` `:281` |
| viewer glue | `buildScene` in `useMemo`, dispose on change; synchronous (no async model layer) | `app/components/pcb/hooks/usePcb3d.ts:87-88` |
| view session | one `pcb3d` bus per editor; toolbar / palette / agent issue the same commands | `app/components/pcb/hooks/usePcb3dViewSession.ts:1-13`; `action-registry.ts:116` |
| fixture footprints | **every** fixture footprint references a **`.step`** model (e.g. `Diode_THT.3dshapes/D_DO-35_SOD27_P7.62mm_Horizontal.step`) | `app/lib/fixture-runtime/cad-source/kicad-footprints/**`, `generation-kicad/*.kicad_mod`, `blinker/kicad/**` |

### 6.2 three's `VRMLLoader`

- **Available:** `node_modules/three/examples/jsm/loaders/VRMLLoader.js` (3,646 lines, three 0.185.1, `package.json` `"three": "^0.185.1"`),
  with types `@types/three/.../VRMLLoader.d.ts`. Its parser is `chevrotain`, bundled at `examples/jsm/libs/chevrotain.module.min.js`
  (`VRMLLoader.js:40`). No app code imports it yet.
- **Requires a V2.0 header:** `#VRML V2.0` (`:3345`).
- **Ignores** `Inline`, `Script`, sensors and `Text` (no build, `:747-770`).
- **External fetch risk:** `ImageTexture.url` calls `textureLoader.load(url)` (`:1464-1482`; loader path `:3340-3341`), which is a
  network fetch. K must refuse `url` / `ImageTexture` / `MovieTexture` / `PROTO` / `EXTERNPROTO` server-side, AND render under a
  `LoadingManager` whose URL modifier refuses every URL.

### 6.3 K.6 gaps

1. Nothing retrieves, stores or inspects model bytes (sections 5 and 6.1).
2. There is no state vocabulary `missing / downloaded / parsed / package-matched / renderable / approximate / unsupported`. `safe` can
   come from a boolean.
3. There is no units/scale/orientation check. KiCad's VRML convention is 1 unit = 0.1 in = 2.54 mm (INFERRED from KiCad convention; K5
   pins it with the fixture).
4. Footprints name `.step`. The `.wrl` sibling of the same stem is a convention K must state, not assume silently.
5. No async model layer, no cache by immutable id, no late-load retirement across projects.
6. Placeholders are unlabelled.

### 6.4 Model bytes to the browser: existing routes vs a new route (OD-260 item 3)

| option | can carry project-scope candidate bytes? | can carry published cross-project reuse? | auth | verdict |
|---|---|---|---|---|
| `GET /api/parts/acquisitions?…` (`app/api/parts/acquisitions/route.ts:28`, `authenticatedRoute({query:true})`) | yes (the object store is scope-keyed) | **no** (scope-only by design) | member | insufficient alone |
| `GET /api/components/atomic` (`route.ts:13-45`, `publicRoute`) | no | metadata only (cad bundles); unauthenticated | public | do not widen a public catalog route to serve bytes |
| `GET /api/pcb/footprints/[id]` (`publicRoute`, returns the `models` references `:53`) | no | no bytes | public | no |
| **new** `GET /api/components/atomic/models/[versionId]` (canonical `authenticatedRoute`, immutable id, ≤2 MiB, `model/vrml`, licence attribution, `Cache-Control: immutable`; a published never-withdrawn revision's model, or the caller's own scope candidate; unknown = foreign = withdrawn = 404) | yes | yes | member | **recommended**; census 177 → 178, canonical 174 → 175 |

Census pins to move with dated notes:

- `app/api/__tests__/b16-1c-invariant-tripwires.test.ts:48`
- `app/lib/auth/__tests__/b16-1b-auth-composition.test.ts:255`
- `app/lib/computation/__tests__/b22-a2-process-census.test.ts:317`
- `app/lib/manufacturing-providers/__tests__/b23-a-route-vocabulary.test.ts:618`, `:658`
- `b23-a-no-order-structural.test.ts:183`
- `b23-b-exchange-route.test.ts:116`
- `app/lib/qualification/__tests__/b24-a1-readiness.test.ts:305`
- `b24-f-maps.test.ts:166` (D9)
- the generated `artifacts/ai-control-plane-b24/current-system-map.md:9`

## 7. Registry / ratchet surfaces K will touch

| surface | where | move |
|---|---|---|
| CAD registry invariants (model refused, 1 MiB, no VRML media) | `cad-source-registry.ts:141`, `:322-327`; CSV `../component-resolution/cad-source-registry.csv` | K5: admit `model/vrml` ≤2 MiB for `fixture-kicad` only (dated OD-260 note); STEP stays refused / metadata |
| agent event union | `agent/contracts.ts:398-447` (append at the END, the file's convention) | K2: `acquisition_task_ready` |
| acquisition tool outcome | `cad-acquisition-reads.ts:135` | K2: `kind: "acquisition-task"` (single-flight as `generation-task`) — tool version bump → registry artifacts, manuals, coverage matrix, MCP exposure pins |
| control inventory / accessible names | `engineering/control-registry.ts`, B17-A inventory, B24-D3 census | K2/K4/K6 new controls (Show details, Cancel, Resume, Use in project) |
| page pins | section 0 item 8 | kept: controls live in new components |
| chat closure imports | `app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts` FORBIDDEN | K2: only contract modules enter the closure |
| CI admission | OD-254 mechanism; `b24-d0-ci-split` | K7 |

## 8. Proposed increments (K.8 order)

The ledger is `progress.md`; the increment list is returned to the lead. In summary:

- **K1:** reproductions.
- **K2:** the Work log (typed, on the activity entry).
- **K3:** the persisted acquisition recovery controller.
- **K4:** durable reuse + the library view + the allowance line.
- **K5:** VRML import / inspection / storage.
- **K6:** VRML render / reuse in the existing viewer + the model read route.
- **K7:** the full journey, failure paths, CI, the verdict.
