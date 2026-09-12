# B18 — final verdict

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised),
**RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

## Verdict

**B18 PASSES its deterministic gate.** Every runbook pass criterion is met by executed evidence, and the three claims a
closing adversarial pass managed to refute were fixed with regressions that fail on the pre-fix code rather than argued
away. The checks no local resource can exercise are recorded as UNKNOWN / BLOCKED-LIVE-QUALIFICATION (U18-1 … U18-3) and
do not block completed deterministic work, as the runbook's final-gate rule provides.

## Pass criteria (runbook "B18 pass criteria")

| criterion | evidence | state |
|---|---|---|
| chat can truly execute authorized Tier 0 and permitted Tier 1 operations through the canonical executor | six reviewed granted executions (move, rotate/flip, arrange, silkscreen text, dimension, undo/redo replay), each a server-minted one-shot grant the user's own editor session commits as ONE canonical transaction; proven in unit, integration and the browser (29 cases), with the settled record — never the model — reporting the outcome | CONFIRMED |
| Tier 2 remains human-approved proposal/apply | bounded PCB proposals, sealed component replacements and layout candidates are digest-sealed, revision-bound artifacts that only a human action applies; an adversarial verifier could find no auto-apply, default, page effect, recovery path or tool that applies one | CONFIRMED |
| Tier 3 remains inaccessible | nine independent attack routes tried and each dead-ended on a separately enforced mechanism (`test-and-validation-report.md` §3); in the browser a forged Tier 3 name and a nested delegation are both refused with nothing changed | CONFIRMED |
| every scenario revision-bound | every grant pins the revision it was minted against and burns on drift; every sealed artifact carries its base revision and refuses to apply off it; the ritual recompiles and byte-matches before committing | CONFIRMED |
| every scenario recoverable | the durable journal, the hydration sweep, the one-shot consume and the idempotent ritual; the closing pass found one hole — a landed execution could be reported as not committed after a lineage rebase — and it is fixed and pinned (`b18-e-lost-settlement.test.ts`) | CONFIRMED |
| every scenario truthfully reported | the chat's derived tool lines, one entry per grant, the labels the page owns, notes that never become the answer; the closing pass found the label's trigger both too narrow and too broad, and both are fixed and pinned (`b18-e-claimed-nothing.test.ts`) | CONFIRMED |
| `artifacts/ai-control-plane-b18/` created, all gates complete | 14 artifacts including `scenarios.md` (E0–E19), `evidence/` (20 screenshots) and this validation set; broad run 268 files / 3439 passed, browser 29/29, tsc 0, eslint clean, seven generators idempotent with zero drift, the 158-route ratchet and the exposure ratchet intact | CONFIRMED |
| CI green | every increment pushed and watched; the one red commit on this branch (`bd4aaf5`, a stale copy of a reworded label inside the browser spec) was fixed by the very next commit, which imports the constant instead | CONFIRMED |

## What B18 delivered (CONFIRMED, by checkpoint)

- **B18-A** — permission tiers mapped onto the existing approval vocabulary with a pure fail-closed decision, and the
  project autonomy setting as a server-owned durable aggregate (revisioned compare-and-set, audit record, outbox event)
  with its own canonical route pair.
- **B18-B** — the server-minted execution grant: a durable record binding principal, session, membership, scope, family,
  tier, capability, exact targets, the expected revision after, the operation and preview digests and the explicit-request
  proof; one minter (a `/api/chat` closure), one-shot consumption with ordered checks and exact burn reasons, and a
  browser-attested settlement the loop awaits from the durable record.
- **B18-C** — six reviewed granted executions bound to the canonical executor, the never-granted lists, the
  never-execution sweep over the whole registry, the browser ritual with its journal and recovery, and the scripted
  fixture agent that drives all of it with no provider.
- **B18-D** — the chat's execution UX: composer routing, interim text that can never become the answer, honest tool
  lines, one entry per grant, the history hold, Undo in chat, Stop, refusals shown, and the autonomy control.
- **B18-E** — the eight mandatory scenarios proven in unit, integration and the browser (§7 of `scenarios.md`), the two
  bounded reads the real board forced into existence, the fixture component-authority seams, and five product defects
  found by proving them.
- **Validation** — the adversarial pass (six verifiers, three refutations, all acted on), this artifact set, and the
  carried findings F18-1 … F18-5 recorded with evidence rather than closed by assertion.

## What is not claimed

- A live model has never driven this (U18-1, LB-7). Every proof uses the scripted agent through the real machinery.
- The browser journey has no routed board (U18-2, LB-8), so scenario 2's padstack refusal and scenario 5's routing are
  proven in integration, not in the browser.
- Manufacturing qualification and release are proven only as refusals from the agent's side (U18-3, LB-5).
- F18-1 … F18-5 are open observations, not fixes: each is recorded with its file:line and the reason it is not a live
  path today.

## Next

B18 merges normally into `main` (PR #8) once CI is green on the final commit, and the program continues to B19 —
external component and evidence acquisition.
