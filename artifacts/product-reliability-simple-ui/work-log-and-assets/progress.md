# Section K — work log, persistent recovery, reusable parts, real 3D — progress ledger

The resumable record of runbook section K's increments (K.8). Read this first after a context reset.

- **Governing text:** `artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md:393-533` (K.8 at `:516-531`).
- **Owner defaults:** OD-260 (`artifacts/remaining-builder-program/OWNER_DECISIONS.md:3647-3667`).
- **Source map:** `k-map.md` (this directory).
- **Working copy:** `C:/Users/robsa/Desktop/sirkit-edit`, branch `codex/astra-foundation`, mapped at `7d8ef423`.

## Ground rules (owner's, binding)

- Every K claim is fixture- or fake-labelled at US$0 (OD-260 item 10). There are no paid API calls. The US$5 builder ledger
  `../live-spend.json` is unchanged: known 1.3628, LR-3 reservation 2.66 held, provable remainder 0.9772.
- Never touch `C:\Users\robsa\sirkit`. Never push to main. Commits are authored by Dandi Desta with no AI trailer.
- Do not weaken tests, policies, CSRF, bounded readers, role checks or the route-count ratchet. Never raise a timeout to pass a test.
  Kill every vitest/eslint/tsx/tsc/playwright process a run started. Never run two heavy jobs at once. Never edit source during a
  Playwright run.
- `app/page.tsx` keeps 9,156 lines; K's logic lives in components and hooks (OD-260 item 8).
- Reuse L and M: cite the proving suite (`k-map.md` section 3) instead of redoing it.

## Increments

| # | increment (K.8 order) | state | K.8 items closed | commits | evidence |
|---|---|---|---|---|---|
| K0 | source map and ledger | DONE (read-only) | — | `7a47d276` ([K1, 2026-11-04] was "— (uncommitted)") | `k-map.md`, this file |
| K1 | current behaviour and reproductions: the early stops found (acquisition 3-claim → `source_unavailable`, the single source pass, the identical status-read refusal, the 1 h Retry-After clamp, the unused 5 s clip, the acquisition start not typed, the allowance not shown, the `inspected` boolean, unlabelled placeholders) | DONE (2026-11-04) | none closed; enables 2, 3, 5, 6 | the K1 commit after `22db67c9` | `app/lib/qualification/__tests__/k1-early-stop-reproductions.test.ts` (9 cases, section "K1 record" below); `k-map.md` section 9 (corrections) |
| K2 | typed public progress: the Work log on the existing activity entry ("Show details"), `acquisition_task_ready`, row phases, dedupe / ownership / late-event guard, reload recovery, the remaining-allowance line, the missing-role library link | planned | 1, part of 7 | — | — |
| K3 | persisted recovery: the acquisition task's strategy ladder, rejected-evidence memory, honest worker-failure backoff, the real Retry-After deferral, Cancel / Resume, the draft offer when exhausted | planned | 2, 3 | — | — |
| K4 | durable acquisition and reuse: the reusable library view ("Use in project"), the reuse freshness / withdrawal / licence checks, the precise refusal matrix, zero-call reuse in a second project | planned | 4, 5, part of 7 | — | — |
| K5 | real VRML import: a bounded inspector, the model state vocabulary (no boolean `safe`), the fixture MIT VRML bytes, the model kind in the fixture CAD row (≤2 MiB), package / units / orientation validation, publication re-inspection, `modelVersionIds` | planned | 6 (import), 7 | — | — |
| K6 | real VRML render and reuse: one model read route (census 177 → 178), the lazy model cache keyed by immutable id, the `VRMLLoader` with every URL refused, top / bottom transforms, labelled placeholders, late-load retirement and disposal | planned | 6 (render / reuse), 7 | — | — |
| K7 | the full journey and failure-path browser proofs, CI admission (OD-254), the generators, `validation.md`, `final-verdict.md`, the screenshots | planned | 8 (+ residuals of 1-7) | — | — |

## Owner decisions that bound K (OD-260; the default applies unless the owner says otherwise)

| item | default |
|---|---|
| 1 | VRML 2.0 only; STEP is metadata and labelled unsupported |
| 2 | MIT fixture models only; no `packages3D` fetch |
| 3 | one new GET read route (the lead records which) |
| 4 | a generation block's missing role keeps waiting for a library action; K only links the Build Library search |
| 5 | spend per task; the remaining allowance is shown |
| 6 | acquisition events collapsed under "Show details" in the activity entry |
| 7 | the append-only store, KiCad CC-BY-SA indefinite retention, 2 MiB per model; PDFs still refused |
| 8 | `page.tsx` line count kept |
| 9 | evidence lives here |
| 10 | US$0 |

## Open questions recorded for the lead (not blocking K1)

1. Footprints reference `.step` models; K5 must state the `.wrl` stem-sibling lookup as a convention (k-map 6.3 item 4).
2. Which route carries the model bytes: the recommended new route vs `GET /api/parts/acquisitions` (k-map 6.4).
3. `inspectionState: "safe"` stays unset by K, so the mechanical profile stays blocked (no mechanical qualification exists).

## K1 record (2026-11-04)

**Suite:** `app/lib/qualification/__tests__/k1-early-stop-reproductions.test.ts`, 9 cases, offline at US$0 (no paid call, no provider,
no database; the global `fetch` is a recording stub every case leaves uncalled; the only CAD transport is the committed fixture one).
It drives the production modules: the acquisition service, store and slice runner over the fixture runtime's catalog and durable
repository, the CAD egress path, the chat loop with its real gateway and registry (a scripted provider plays the model), the
generation snapshot and the browser's reader, the atomic asset and approval code, and the 3D scene builder.

**Convention (one for the file):** every case is an ordinary `it` that asserts the CURRENT behaviour, cites file:line in its title
and names the increment that changes it. That increment rewrites the case to its new contract in the same commit (the case goes red
the moment the behaviour changes). `it.fails` is not used: it also passes on an unrelated error, so it cannot prove a reproduction.

| case | pins (current behaviour) | code | flipped by |
|---|---|---|---|
| K1 1 | 3 claimed attempts of one slice lapse; the 4th claim is refused before any re-check and parks the whole task `waiting-for-resource`, blocker `source_unavailable`, no pending slice, nothing claimable a week later; `attempts` is empty (no source was asked) | `component-resolution/task/store.ts:215-229`, `task/contracts.ts:33` | K3 |
| K1 2 | one pass: the only admitted source (`fixture-kicad`) lacks the symbol, one request; `kicad-bundled` / `kicad-gitlab` are recorded skips; blocked `no_matching_asset`, `waiting-for-resource`, no pending slice, no strategy recorded | `component-resolution/acquisition/pipeline.ts:102-130`, `task/slices.ts:154-162` | K3 |
| K1 3 | the chat run's 3rd identical `sirkit.parts.acquisition-status` read is refused `repeated_call` "its result has not changed" while a worker had claimed the task (stored state `queued` → `running`) | `agent/loop.ts:445-450`, `agent/contracts.ts:186` | K2 / K3 (the follow-up goes to the durable task; the guard stays) |
| K1 4 | a 429 with a real 2 h Retry-After (delta-seconds and HTTP date) schedules the retry 1 h out | `acquisition/cad-egress.ts:60-61`, `:80-87` | K3 |
| K1 5 | the chat start answers a plain read: `tool_started` + `tool_finished succeeded` only, no typed event (the union names none), no progress line, the activity line "— done", the task id in no event | `agent/cad-acquisition-reads.ts:135`, `agent/loop.ts:512-514`, `agent/contracts.ts:398-447` | K2 |
| K1 6 | the server snapshot carries `allowance.remaining`; `readGenerationTaskSnapshot` drops it; the counts line is "… elapsed · 0 model calls · 0 catalog searches" | `generation-task/snapshot.ts:75`, `:170`; `project/generation-task-client.ts:32-61`, `:87-121`, `:435-438` | K2 |
| K1 7 | `createModelAsset({ inspected: true })` over bytes that are not a model gives `safe` (the boolean is the only difference from `not_inspected`), which removes the mechanical profile's model blocker; no production caller | `atomic/kicad-assets.ts:286-310` (`:306`), `atomic/validation.ts:140-145` | K5 |
| K1 8 | every 3D footprint is one `BoxGeometry` mesh in a group `footprint:<ref>`, no name or `userData` says placeholder; the viewer's toggle calls them "Parts" | `pcb/3d/geom/footprint-mesh.ts:101-120`, `pcb/3d/build-scene.ts:239-251`, `components/pcb/PcbPreview3D.tsx:43` | K6 |
| K1 9 | tripwire: `collectAdapterPages` retries twice and waits min(5 s, Retry-After) (120 s → 5 s), then gives up; no production caller | `atomic/ingestion.ts:157-207` (`:177`, `:186`) | none (K adopts nothing from it) |

Each claimed behaviour was verified against the code before it was pinned; all nine are real (k-map section 9 records the line
corrections and refinements). Planted changes, each reverted: `maxAttemptsPerSlice` 3 → 4 turns K1 1 red, `CAD_RETRY_AFTER_MAX_MS`
1 h → 2 h turns K1 4 red, a constant `not_inspected` in `createModelAsset` turns K1 7 red; the other six stay green each time.

**CI (OD-254):** the suite rides prompt-to-gerber's existing `app/lib/qualification/__tests__` directory filter (OD-254's default
puts an admitted suite in prompt-to-gerber; no workflow line changed, so no citation moved). It joined that selection after PR-J7's
measurement, so `b24-d0-ci-split` sets it aside like the J4/J5 suites were, until K7's one re-measurement: `K1_SET_ASIDE` on `:75`
(in place, no line added), case 1's filter, case 7's count 644 → 645 (prompt-to-gerber 412 files), each with a dated `[K1, 2026-11-04]`
note.

**Gates (local, sequential, provider keys unset, `--maxWorkers=4`):**

| gate | result | exit |
|---|---|---|
| `vitest run app/lib/qualification/__tests__/k1-early-stop-reproductions.test.ts` | 1 file, 9 passed | 0 |
| `vitest run` `b24-b2-ci-admission`, `b24-d0-ci-split`, `b24-d4-browser-split`, `b24-d1-threshold-census`, `b24-b1-catalog`, `b19-e-ci-job-scope` | 6 files, 62 passed (before the set-aside: `b24-d0-ci-split` 1 and 7 red, 643 vs 644 files and 412 vs 411) | 0 |
| `vitest run app/lib/qualification/__tests__ app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` (every reader in the directory) | 58 files (55 passed, 3 skipped), 583 passed, 15 skipped | 0 |
| `vitest run app/lib/auth/__tests__/b16-0-2-gates.test.ts` | 1 file, 21 passed | 0 |
| `vitest run app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts` | 1 file, 7 passed | 0 |
| `vitest run` `b21-closeout-statements`, `b22-closeout-statements`, `b23-closeout-statements`, `b19-e-no-purchase-tripwire`, `b16-1c-invariant-tripwires`, `b16-a-review-corrections-tripwires` (the suites that scan test and page text) | 6 files, 53 passed | 0 |
| `tsc --noEmit` (4 GB heap, as CI) | clean (one cast added in K1 5 after the first run's TS2345) | 0 |
| `eslint` on the two touched test files | clean | 0 |
| `tsx scripts/scan-secrets.ts` (tree) | 4763 entries, 11 allowlisted lines | 0 |

## Exact next step

K2: the typed Work log on the existing activity entry (`acquisition_task_ready`, row phases, the remaining-allowance line, the
missing-role library link), rewriting K1 5 and K1 6 (and K1 3, if K2 routes the chat's follow-up to the durable task) to their new
contracts in the same commit.
