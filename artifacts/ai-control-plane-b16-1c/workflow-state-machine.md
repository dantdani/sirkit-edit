# B16.1C — The prompt-to-Gerber workflow state machine (§C)

Module: `app/lib/workflow/prompt-to-gerber/{types.ts, machine.ts}` — CONFIRMED by `app/lib/workflow/prompt-to-gerber/__tests__/machine.test.ts` (7 tests).

## States (exactly the 18 mandated, in `PROMPT_TO_GERBER_STATES`)

`idle`, `hydrating_project`, `proposing_schematic`, `awaiting_schematic_review`, `applying_schematic`, `resolving_component_authority`, `syncing_pcb`, `proposing_pcb`, `awaiting_pcb_review`, `applying_pcb`, `awaiting_qualification`, `qualifying`, `qualification_failed`, `qualified`, `awaiting_release_authorization`, `releasing`, `release_failed`, `released`.

## Contract (CONFIRMED)

- `transition(snapshot, event, at)` is pure; the legal `(state, event)` table (`LEGAL` in `machine.ts`) is closed. Any other event is **refused** — the unchanged snapshot is returned with `refused: { event, state, reason }` — never coerced and never a silent legacy fallback.
- Review states leave only through the explicit human events `APPROVE_SCHEMATIC`, `APPROVE_PCB`, `AUTHORIZE_RELEASE`; `APPROVE_PCB` must name the exact `planId`/`planDigest` under review and `AUTHORIZE_RELEASE` the exact `authorityRevision`/`authorityDigest` presented — anything else is refused (no hidden auto-approval).
- Every transition carries identity: `WorkflowScope` (tenant/project/branch/design/board) plus `WorkflowIdentity` facts (schematic base digest, durable snapshot revision, schematic revision, plan id/digest, board revision/digest, authority revision/digest, component-authority digest, release id/sha/filename) and an appended `history` entry `{at, event, from, to, note}`.
- Pending operations (`PENDING_STATES`) carry `pendingOperationKey`; `stepKey(step, scope, facts)` yields the same deterministic idempotent key for the same durable inputs, so an explicit `RETRY` replays instead of repeating a committed mutation (server side: durable-workflow idempotency by scope/key; release ledger idempotent by release id; qualification short-circuits when the board/authority are unchanged).
- `PCB_APPLIED` and `AUTHORITY_INVALIDATED` clear authority and release identity (a board change makes both non-current); `REQUEST_RELEASE` is refused without a current authority.
- `reconstruct(scope, durableTruth, local, at)` rebuilds truthful progress from durable records alone: no board → `idle`; board without a current authority → `awaiting_qualification`; current authority → `qualified`; current authority + current ledgered release → `released`. A stale authority/release (board moved on) is never reported as qualified/released, and a pending review never survives a refresh (it is browser-local by design).

## Coordination with the existing authorities (INFERRED from wiring, CONFIRMED by tests)

| Machine step | Existing authority it coordinates (never replaces) | Where |
|---|---|---|
| `PROPOSE_SCHEMATIC` → `awaiting_schematic_review` | `POST /api/schematic/build-multi` (fake provider adapter in CI) → the page's pending-proposal dialog (`pendingReplace`, now for EVERY generation, with `describeSchematicProposal`) | `app/page.tsx`, `review-summary.ts`; acceptance step 1–2 |
| `APPROVE_SCHEMATIC` → `applying_schematic` → `idle` | `applySchematic` through the canonical schematic session (unchanged) | `app/page.tsx` |
| `RESOLVE_COMPONENT_AUTHORITY` | `POST /api/physical-bindings` `bind_atomic_selection` (human reviewer/admin; server-owned records) | acceptance step 4, recovery H.13 (rebind refused) |
| `SNAPSHOT_PUBLISHED` → `PCB_PLAN_READY` → `APPROVE_PCB` → `PCB_APPLIED` | `POST /api/pcb-sync` publish (against the server snapshot head) → preflight (inert plan) → apply (explicit opt-in header, exact plan id/digest) | acceptance step 5–6, recovery H.4/H.5 |
| `QUALIFY` → `QUALIFIED` / `QUALIFICATION_FAILED` | `POST /api/pcb/qualify` (server-owned authority; CAS on the aggregate revision; in-flight guard) via the editor's owned `qualification` slot | acceptance 7–8, recovery H.6/H.11 |
| `REQUEST_RELEASE` → `awaiting_release_authorization` → `AUTHORIZE_RELEASE` → `RELEASED` | `useManufacturingWorkflow` + `ManufacturingWorkflowPanel` (separate administrator dialog naming the authority) → owned `release` slot → `POST /api/pcb/release` with `expectedAuthorityRevision/Digest` | panel tests; recovery H.13 (`MFG_AUTHORITY_CONFIRMATION_MISMATCH`) |
| `HYDRATED` | `GET /api/pcb-sync?boardId=…&include=manufacturing` (`manufacturing-summary.ts`) | acceptance 3/6/7/10, panel tests H.8–H.10 |

## Browser wiring (CONFIRMED by `manufacturing-workflow-panel.test.tsx`, RECORDED for PcbEditor)

- `useManufacturingWorkflow` hydrates on mount and on every `refreshToken` bump (PcbEditor bumps after sync-apply and qualification adoption), reconstructs the snapshot, exposes `canRequestRelease` (authority current AND equal to the loaded board revision AND not releasing), the confirmation payload, `authorizeRelease`, `retry`, `refresh`.
- The panel disables Qualify/Request-release while any of hydration/qualification/release is pending, shows hydration status, workflow state, identity facts, bounded errors with correlation ids, and the release result (filename, archive sha256, release id, authority revision/digest, ledger disposition, download).
- Manual editor workflows are unchanged (sync button, apply plan, qualify, fab dialog); the fab dialog's verified-release entry now opens the same administrator authorization instead of releasing directly.
