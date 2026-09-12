# B18-C — Safe mutation tools: closing record

Status: **CONFIRMED** locally and in CI (commit hashes and CI runs per increment are in `artifacts/remaining-builder-program/EXECUTION_LEDGER.md`). The design and every amendment (A1–A25) are in `safe-mutation-contract.md`; this page is the short answer to "what can the assistant change, how, and what stops it".

## 1. What the assistant can EXECUTE (permission Tier 1, one-shot server grants)

Every execution is one server-minted, single-use grant, bound to the principal, the membership revision, the project, the branch, the board lineage and head, the exact operations and the exact preview. It ends as ONE canonical PCB transaction committed by the user's own editor session — one history entry, exactly undoable.

| Tool (version) | Family | Explicit execution (no card) | Otherwise |
|---|---|---|---|
| `sirkit.pcb.move-footprint` (1.1.0) | `pcb.move-footprint` | yes — "Move R3 2 mm to the right." (the whole message; one footprint; mm/µm/mil/cm) | confirmation card |
| `sirkit.pcb.rotate-side-footprint` (1.2.0) | `pcb.rotate-side-footprint` | yes — "Rotate R3 90 degrees clockwise", "Flip R3 to the bottom" (the editor's own Flip rule) | confirmation card |
| `sirkit.pcb.arrange` (1.1.0) | `pcb.arrange` | never (multi-target) | confirmation card |
| `sirkit.pcb.silkscreen-text` (1.0.1) | `pcb.silkscreen-text` (silk TEXT items) | never (free text the AI placed) | confirmation card |
| `sirkit.pcb.dimension` (1.2.0) | `pcb.dimension` (documentation layers only) | never (annotation geometry the human must see) | confirmation card |
| `sirkit.pcb.undo-redo-granted` (1.0.1) | `pcb.undo-redo-canonical` | yes — "Undo that." / "Redo." (optionally "it", "the last change / edit / operation") | confirmation card |

- **Modes.** `proposal_only` (the default): every Tier 1 execution shows the confirmation card and changes nothing until the human confirms. `execute_explicit_tier1`: a project administrator opts in (compare-and-set on the setting revision); only an instruction whose WHOLE message is proven by the grammar (`EXPLICIT_GRAMMAR_VERSION` 1.4.0) executes directly; anything else still shows the card. The cross-run retry guard sends a repeat of a recent execution back to the card.
- **Undo / redo.** Only the assistant's OWN latest change, and only while it is still the latest change on the board (the server resolves the reference from the principal's settled grants at the verified head; the tool takes only a direction). An AI undo or redo is a NEW history entry: after an AI undo the user's own Undo re-applies the change; after an AI redo it removes it again (prompt 1.2.1).
- **What the model is told.** System prompt 1.2.1; a result says `execution_preview_issued` (nothing changed), `executed` (with the transaction, the revision after, the DRC the editor ran and how to undo), or `execution_poisoned` (the board MAY have changed — never "nothing changed").

## 2. What the assistant can only PROPOSE (permission Tier 2, sealed proposals the human applies)

Via diameter/drill (`pcb.edit-via`; a padstack-bound via is refused truthfully), track segments (`pcb.edit-track`), copper and connectivity changes, and the schematic set-value / rename / delete proposal. These need `edit_copper` or `edit_components`, which the B18 grant model does not carry (OD-13, OD-15).

## 3. What the assistant can NEVER do

Qualify, release or order (Tier 3; the gateway's catch-all and the never-exposed patterns); approve or execute a manufacturing release; name its own grant, approval, confirmation, role or revision (execution tools take only their listed arguments; the page re-parses every grant and refuses any whose covered content disagrees).

## 4. The authority chain (each link re-checks; none trusts the one before)

Model tool call → gateway dispatch (the reviewed list, Tier 1 only) → seal (the SAME builder the editor uses; absolute plans) → minter (server: membership, autonomy, the explicit-request proof, the retry guard, the replay reference) → durable grant store → the page's SAFE receiver (exact parse + digest coherence) → the PCB editor's ritual (live drift, recompile and byte-match, journal, one-shot server consume, ONE canonical transaction through `CanonicalEditorSession`, postconditions, receipt) → server settle → the loop answers from the SETTLED record, never from its own belief.

## 5. Evidence

- Integration and adversarial suites (vitest; every one in the deterministic-manufacturing CI list): `b18-c-*` under `app/lib/engineering/__tests__`, `app/lib/agent/__tests__`, `app/api/chat/__tests__` and `app/components/pcb/__tests__`.
- Browser proof (Playwright, the fixture runtime and the SCRIPTED agent — never a model): `e2e/agent-execution.spec.ts` — 4 passed (39.6 s) in run 4 — the previewed move confirmed on the card, the admin opt-in with an explicit move and flip, the silkscreen add with an AI undo, a reload and an AI redo, and the grant altered in transit dropped. Screenshots: `evidence/granted-preview-card.png`, `evidence/explicit-executions-committed.png`, `evidence/ai-undo-committed.png`, `evidence/forged-grant-dropped.png`.
- Adversarial reviews: V0–V4 and U1–U3 (I1–I3), review 2 (I4–I6), review 3 (I8); every confirmed finding has a regression test (A8–A13, A19, A24).

## 6. Recorded limits and open decisions

- OD-11 — explicit grammars exist for move, rotate/flip and undo/redo only; arrange, silkscreen text and dimensions are confirmation-only (DECIDED default; the owner may ask for more grammars).
- OD-13 — via and track edits stay Tier 2 (a recorded divergence from the runbook's Tier 1 list); board `texts[]` is not covered (no editor command writes it).
- OD-14 — resolved (undo/redo under a grant).
- OD-15 — schematic execution is deferred: every schematic operation needs `edit_components`, which the AI actor is categorically refused.
- OD-16 — schematic wires and labels are neither executable nor proposable by the agent today.
- OD-7 — no live LLM turn: the browser proof uses the scripted agent; a real provider's tool calls are **UNKNOWN** until the owner provides credits.
- PROPOSED for B18-D (chat execution UX): the composer sends a message beginning with "add" to the SCHEMATIC editor (`inferComposerAction`), so "Add silkscreen text …" never reaches the assistant; gate the editor's own Undo/Redo while a grant executes (a UX choice — a concurrent Undo is already a separate, correct history step).
- A18/A23 — board-inspect's AI snapshot lists neither silk items nor dimensions and is not bounded below the loop's result budget on a synchronized board; the agent reads targets from the selection.
