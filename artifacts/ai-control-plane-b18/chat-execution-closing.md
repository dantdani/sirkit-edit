# B18-D — Chat execution UX: closing record

Status: **CONFIRMED** locally and in CI (every increment's commit and CI runs are in `artifacts/remaining-builder-program/EXECUTION_LEDGER.md`; B18-D runs from `2a80dff` to `6ae2c73`, CI green at 6ae2c73 (deterministic-manufacturing 34647251395 incl. page-browser-e2e, benchmark-quality 34647251465)). The design, its rules and every as-built amendment (D-A1–D-A16) are in `chat-execution-ux.md`; this page is the short answer to "what does the chat show, and why can it be trusted?".

## 1. The runbook's ten items — where the user sees each

| Item | Where |
|---|---|
| What Sirkit understood | The execution entry ("Sirkit understood: …"), the card's preview, and the composer's route chip before sending ("Sirkit will: …", with its reason). |
| Resolved objects / nets | The entry's "Targets" row and the card's targets, as references (R3), never raw ids. |
| Tier 0/1/2/3 | A tier tag on every tool line, the entry and the card; the static Tier 3 line in the chat header. |
| Exact proposed operations | The card's operations list and the entry's "Operation n" rows — every field an update can change. |
| Whether a confirmation is required | The entry's "Confirmation" row (required, or not required because the whole message was exactly one proven request under `execute_explicit_tier1`), and the card. |
| Progress and cancellation | The entry's state (awaiting confirmation → issued → executing → committed / not made / landed, unverified / outcome unknown / cancelled / superseded), the card's Cancel, Stop for the chat run, and how long the assistant waits for the editor. |
| Committed transaction / revision | The entry's "Transaction … · revision … → … · history #n · server record" row. |
| Validations run | The committed line's design-rule-check result, as the editor ran it ("errors only"; "did not run — no design-rule claim" otherwise). |
| Failures and recovery | The entry's refusal sentence and next step (the live pre-check's own reason included), "landed, unverified" whenever the editor and the server disagree, a cut stream shown as a failure, and recovery results that settle the entry. |
| Undo action | "Undo this change" on a live committed entry while it is the timeline's newest operation (one-shot), the undo hint (conditional; direction-aware for an AI undo or redo), the editor's Undo, "Undo that.", and the revision history. |

## 2. The two rules

- **No button may apply an altered proposal.** There is exactly one Confirm surface, the card's Confirm (`b18-d-ui-gates` scans for it); the card shows only digest-covered content as "what changes" and stays inert; every chat action carries identifiers only; nothing under `app/components/chat` can reach the execution machinery; a grant altered in transit is dropped by the page's receiver — no entry, no card, and its tool line says it was dropped.
- **No model text may claim success before the transactional result exists.** Text written beside a side-effecting call is interim and appears only as a labelled note after the run ends ("Assistant note (written before the result): …"), never in the answer or the history the next run receives; an answer written while a change's outcome is unconfirmed carries "Written before the outcome of this change was confirmed — the entry above is authoritative." (or, when this page dropped the run's only grants, "Written without knowing that this page dropped the change — nothing was changed; the run log above says why."); tool lines say what really happened; the same rule covers the schematic edit route (OD-18). The browser proves it across every flow (S5).

## 3. What the chat's own controls carry

| Control | Carries | What decides |
|---|---|---|
| Undo this change | the entry's grant id (the page looks up its transaction) | the project timeline undoes its newest operation only if it is exactly that transaction (`NOT_LATEST` otherwise; `STORE_BUSY` while an AI change is being made); the PCB store's own Undo |
| Stop | nothing | the route aborts the run; the loop retires its still-issued explicit grants (`run_cancelled`) |
| The route override | nothing (flips the suggested route) | the chosen route's own server checks |
| Agent autonomy (Change) | `{ mode, expectedRevision }` | the admin-only policy row, same-origin CSRF, the human-actor rule and the compare-and-set |

While an AI change is being made the editor holds undo and redo at the one point every undo path shares; the toolbar and Ctrl+Z say why.

## 4. Review

An adversarial review of I0–I10 (`wf_ebe145ea-ffc`: six read-only finders, a skeptic per dimension, a completeness critic) raised 36 findings — about 15 distinct defects — of which 26 were confirmed and 10 refuted, and the critic added 7 gaps. Every confirmed finding and every gap is fixed or recorded (D-A13–D-A15). Two recorded designs were kept after verification: the Stop text in the answer (D-A9) and the one-shot chat Undo (D-A8). A second review of I11–I12 (`wf_a9af930e-505`: four read-only finders, one skeptic per dimension, a completeness critic) raised 17 findings — 15 confirmed (two medium), one plausible, one refuted — and six gaps; every one but the refuted finding is fixed (D-A16), together with a B17-E timeline-recording defect the new real-history test found.

## 5. Evidence

- Unit, jsdom and route tests: 23 `b18-d-*` files / 100 tests, plus the B18-B and B18-C suites they touch; the broad run at `6ae2c73`: 253 files / 3329 tests passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test).
- Browser (`e2e/agent-execution.spec.ts`, serial): 16/16 passed within the full suite (3.5 min). The full Playwright suite: 22/22 passed (3.5 min): agent-execution 16, semantic-editor 5, prompt-to-gerber 1.
- Screenshots in `evidence/` (10 files): the preview card, explicit executions, AI undo, the dropped forged grant, Undo in chat, Stop, the autonomy control, the cancelled card, undo paused during an AI change, and a Confirm refused for a transient reason.
- Generated artifacts at `6ae2c73`: `artifacts/ai-control-plane-b01/ui-control-fingerprint.json` sha256 `18b0fcfa9844cf15…`; `artifacts/ai-control-plane-b17/ui-control-inventory-summary.json` sha256 `ea846e545e55d398…`; `artifacts/ai-control-plane-b17/ui-control-inventory.csv` sha256 `a768ba4b9c4f1852…`.
- Security invariants: one production route changed in B18-D, and no authentication file: `/api/agent/execution-grant`'s cancel accepts two further retirement labels (`superseded_by_new_grant`, `refused_before_execution`; D-A16 item 13) — a cancel still retires only an issued grant; the auth wrapper, same-origin CSRF, the role rows and the bounded reader are unchanged, the route ratchet is unchanged (158 = 155 + 3 + 0), and their gates pass in the broad run.

## 6. Recorded limits and open decisions

- **Live/fake.** Every B18-D proof drives the real loop, gateway, minter, ritual and page with the scripted fixture agent under the fixture runtime; a real model's chat execution is BLOCKED-LIVE-QUALIFICATION (LB-7).
- **OD-17 D2** — the history hold covers granted executions only, not human commits or Smart Route.
- **OD-18** — Rule 2 covers the schematic edit route (a default the owner may reverse).
- Entries never crossing projects has no automated test (the page cannot be component-tested; the browser harness has one project).
- A Stop in the middle of a stream is not browser-tested (the scripted agent answers at once); a Stop before the response and the server chain are.
- S5 checks that every interim note appeared while an execution entry existed, not per-run timestamps.
- The autonomy control reads the setting when the chat opens; it is not live-updated (each run applies the current setting, and each entry names the mode it ran under).
- The repair panel's Undo on a bound canonical session (the executor replaced the repair's transaction id, so the Undo was always refused) was fixed on a side branch the owner started from the review's flag and merged into this chapter. Still open outside B18-D: re-applying the same repair preview after its Undo reports success, but the executor replays the idempotent `repair:<preview id>` and nothing changes.
- A refused attempt's row keeps the ritual's own message (bounded to 300 characters), which can include an exception's text.
- Found after this review by B18-E's scenario discovery, and fixed in B18-E (E1): an AI redo's undo hint still offers “Undo that.”, which the minter refuses for an AI replay; and a reloaded entry's hint names the editor's one-step Undo, which a reload does not keep.
- The fixture runtime has no provider credentials, so the automatic schematic review answers 503 in the browser harness; it predates B18-D.
