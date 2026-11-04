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
| K0 | source map and ledger | DONE (read-only) | — | — (uncommitted) | `k-map.md`, this file |
| K1 | current behaviour and reproductions: the early stops found (acquisition 3-claim → `source_unavailable`, the single source pass, the identical status-read refusal, the 1 h Retry-After clamp, the unused 5 s clip, the acquisition start not typed, the allowance not shown, the `inspected` boolean, unlabelled placeholders) | planned | enables 2, 3, 5, 6 | — | — |
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

## Exact next step

K1: the permanent reproduction suite (offline, no network, no provider), then K2.
