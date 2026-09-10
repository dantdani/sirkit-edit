# B17 — unknowns and owner decisions

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Program-level registers stay authoritative: `artifacts/remaining-builder-program/OWNER_DECISIONS.md` (OD-1 … OD-10) and `LIVE_BLOCKERS.md` (LB-1 … LB-6). This file lists what B17 adds or re-confirms; nothing below blocks the deterministic B17 gate.

## Unknowns (UNKNOWN / BLOCKED-LIVE-QUALIFICATION)

| id | item | state | what IS proven instead | owner input needed |
|---|---|---|---|---|
| U17-1 | A real LLM provider turn that calls the B17-F tools (`sirkit.view.*`, `sirkit.selection.control`, `sirkit.placement.propose`, `sirkit.routing.propose`, `sirkit.project.history-inspect`) end to end through `/api/chat` | UNKNOWN (LB-2 / OD-7: no credits; no fixture agent provider exists) | the server half through the SAME gateway/loop the route uses with a scripted adapter (`b17-f-view-tools.test.ts` §B–§D), the browser half through the SAME bridge capture/execute the page's event handler uses (`e2e/semantic-editor.spec.ts` scenario 5); the route's `viewContext` key and event dispatch are INFERRED from the code path | provider credits, or a decision to build a scripted agent-provider fixture for the browser journey |
| U17-2 | Live FreeRouting passes for the agent's routing proposal in CI | local-only (LB-3); CI replays committed recordings for the editor's autoroute, the agent path is proven with an injected pass executor over the SAME `completeAutoroute` service | the pass executor is one module used by both callers (`freerouting-pass-executor.ts`) | none (by design) |
| U17-3 | Production Supabase-authenticated browser journeys for the B17 surfaces | BLOCKED-LIVE-QUALIFICATION (LB-1 / OD-6) | fixture-runtime roles (`sirkit-fixture-role` cookie) exercise the same wrappers | isolated Supabase project |
| U17-4 | Database-backed tests (`DATABASE_URL` dead) | LB-4 unchanged; opt-in | — | a reachable database |

## Recorded observations carried into later chapters (RECORDED)

| id | observation | disposition |
|---|---|---|
| R17-1 | Project undo's refusal code for the never-undoable board-load entry reads `DIVERGED_PCB` rather than `NOT_UNDOABLE` (the hydrate entry's head fingerprint is taken when the history is bound, before the canonical session confirms its head; commits are recorded after confirmation). The refusal itself is correct; nothing is guessed. | cosmetic ordering of two refusal checks; fix when the timeline is next touched (B18 executes operations through the same timeline) |
| R17-2 | The pcb3d surface exists for the agent whenever a real board is loaded (the 3D sheet being closed is a state; `open` is a command) — so "no 3D tools without a 3D surface" means "without a board", not "without the sheet open". | by design; documented in `tool-exposure.md` §8 |
| R17-3 | `sirkit.view.read-state` and `sirkit.project.history-inspect` ride the canonical read boundary and therefore need a verified board even though the timeline is project-level; schematic-only sessions keep the schematic/workspace navigation and selection tools but not the two reads. | acceptable for B17; a schematic-scoped read boundary would be a B18+ design change |
| R17-4 | `selectedKinds` in discovery still derive from the B10 editor-context selection (verified against the board), not from the captured view snapshot; no tool currently requires a selection kind. | none needed now |
| R17-5 | One layout candidate per run (the B09 proposal single-flight): the agent cannot chain placement then routing in one turn. | by design (never two artifacts per run); revisit under B18's execution tiers |
| R17-6 | The fixture-only `window.__sirkitViewBridge` hook exists only when the server rendered the fixture-runtime banner (impossible in production). | recorded; the bridge grants nothing — the bus rules decide |
| R17-7 | Run 1 of the B17-C proof logged an uncaught `Error: aborted (ECONNRESET)` in the dev server around a client navigation; never seen again in nine later runs. | watch list only |
| R17-8 | Whole-tree scanning suites (`b16-1b-auth-composition` §G, the B14.x AST/lexical gates, `b12`) can exceed vitest's 5 s per-test timeout when a broad parallel run saturates the machine; each passes alone (e.g. §G 1.9 s). | recorded; CI runs bounded lists |
| R17-9 | Pre-existing on the branch, found by the B17-F broad run, NOT caused by B17: `b16-0-8-migration-ratchet` (raw-route baseline sha1 for `POST /api/pcb-sync` stale since B16-C.1 `f6b9390`; neither test is in a CI list) and `b16-0-22-tranche-parity` (pcb-sync GET with an unknown board answers 422 where the test pins 404, two cases). | resolved in B17 validation — see `test-and-validation-report.md` |

## Owner decisions taken by the runbook's standing authorization (OD-8) during B17

| id | decision | basis |
|---|---|---|
| D17-1 | Merge chapter PR #7 normally after green CI; no force-push, no history rewrite, no access/billing/live-resource change. | runbook §2.4 / OD-8 |
| D17-2 | Exposure gates derive from ONE reviewed list (`INTENTIONAL_AGENT_EXPOSED_TOOL_IDS`, 22 ids, each with a reason) instead of literal counts; adding a tool to the model's reach is a reviewed change to that list. | runbook B17-F ("never hard-code a desired count without deriving and reviewing the changed tool list") |
| D17-3 | The agent may DRIVE the user's view (fit/zoom/pan/focus/select/highlight/layers/3D/measure/reveal) for every role including viewer, because view commands never touch engineering state and run on the user's own bus under its stale-revision and role rules; proposals stay role-gated (viewer/commenter never; layout candidates pcb_editor/project_admin only). | runbook B17-F contextual discovery |
| D17-4 | Placement/routing proposals produce the shared revision-bound layout candidate that ONLY the human applies (B17-E apply path); the agent never applies, discards or undoes. | runbook B17-E/F |
| D17-5 | The raw-route baseline (`_raw-route-baseline.json`) is regenerated for the B16-C.1 change to `POST /api/pcb-sync` (3 → 3 legacy methods, 0 migrated, 0 added; only that route's sha1 changed) — the documented remedy, not a ratchet change (153 route methods = 150 canonical + 3 factories + 0 raw unchanged). | the test's own instruction |

## Decisions that still need the owner (open)

- OD-6 (isolated Supabase project) and OD-7 (provider credits) remain open; B17 records U17-1 and U17-3 against them.
- OD-9 (`schema.ts` integrity constraints) and OD-10 (unconnected-pin RC03 rule) are untouched by B17.
