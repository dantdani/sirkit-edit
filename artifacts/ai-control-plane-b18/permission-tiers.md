# B18-A — Permission tiers and autonomy settings

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

## 1. Reproduced starting point (CONFIRMED)

- No autonomy setting, execution grant or `app/api/agent` route existed on `804a08d`; the only `AutonomyTier` was an unenforced CD-13 draft field (`app/lib/full-flow/*`).
- A project administrator's agent run had no mutation tool: `sirkit.pcb.move-footprint` is excluded from discovery (`not_agent_exposed`), absent from the run toolset, and the gateway refuses it `not_callable` (probe kept as the B18 counterexample baseline; `discovery.md`).

## 2. The enforced tier vocabulary (CONFIRMED — `app/lib/engineering/permission-tiers.ts`, `b18-a-permission-tiers.test.ts` 6/6)

The tiers are a **mapping onto the registry's existing approval vocabulary** (`ApprovalTier` none / reversible / topology-or-geometry / destructive / release + operation class), never a second classification:

| tier | derived from | examples (registry / action records) | agent execution |
|---|---|---|---|
| 0 | class `read` / `view-session`, approval `none`; every `area: view` action record | all 12 exposed reads, the 6 view-session tools, `view.*` records | direct for any authorized project reader |
| 1 | approval `reversible`; approval `none` on a mutation (the exact undo/redo family) | `pcb.move-footprint`, `pcb.rotate-side-footprint`, `pcb.arrange`, `pcb.undo-redo-canonical`, `schematic.set-property`, `schematic.move-rotate`, `pcb.silkscreen-text`, `project.undo-redo`, `pcb.dimension` (Tier 1 since A17: confirmation-only, OD-11) | preview + confirmation by default; `execute_explicit_tier1` for an exact user-requested operation, always under a server-minted grant (B18-B); never for viewer / commenter / reviewer |
| 2 | approval `topology-or-geometry` / `destructive`; class `destructive`; every `propose` tool (its artifact IS the Tier-2 path) | `pcb.edit-track`, `pcb.delete-item`, `pcb.create-via`, `pcb.zone-edit`, `schematic.connect`, `schematic.delete-component`, `schematic.replace-component`, `pcb.route-copper`, the three sealed proposals and both layout candidates | inert sealed proposal + exact human approval, whatever the mode |
| 3 | approval `release`; class `release`; any id in the release/publish/upload/order/purchase/qualify/ship/deliver families (a defensive floor) | `manufacturing.release`, `manufacturing.export-engineering`, `cd.release-engineering.*` | never |

[B18-E E0] Corrected: `pcb.dimension` is Tier 1 since A17, as `b18-a-permission-tiers` pins; this table listed it under Tier 2.

`decideAgentExecution({ tier, setting, actorRole, explicitUserRequest })` is pure and fail-closed: Tier 3 → `never`; Tier 2 → `proposal_only` (human approval); Tier 1 → `execute_explicit` only when the project opted in AND the loop proved the operation is the exact user-requested one (a model claim never sets it), else `preview_then_confirm` — both require a grant; Tier 0 → `execute_direct`. Tested over every registered tool and action record (the mapping is total).

## 3. The project autonomy setting (CONFIRMED)

- Record `sirkit.agent-autonomy-setting.v1` `{ tenantId, projectId, mode, revision, updatedAt, updatedBy }`; modes `proposal_only` (default, revision 0, no author) | `execute_explicit_tier1`; change record `sirkit.agent-autonomy-change.v1` (from, to, revision, at, actor = principal + membership revision + role).
- **Server-owned** — `app/lib/agent/autonomy-store.ts`: a durable-workflow aggregate `agent.autonomy-settings.v1` (the same substrate as the manufacturing authority and the release ledger): the aggregate revision is the setting revision; every write is compare-and-set (`expectedRevision`); each accepted write appends one immutable digest-bound record carrying the change and emits one outbox event `agent.autonomy-changed`; `changes()` is the append-only history; a stored record whose digest/revision/scope disagree is refused (`AGENT_AUTONOMY_RECORD_MISMATCH`), never trusted; the same mode again is a no-op. **Decision D18-1**: no new table/migration — the durable aggregate already provides revision, CAS, history, audit, the fixture/in-memory variant and PostgreSQL; the B16-B migration and RLS parity gates stay untouched.
- **Project-scoped** (branch-independent: one sentinel branch in the durable scope), tenant-isolated.
- **Membership-authorized** — `GET /api/agent/autonomy` (every member; no CSRF) and `POST /api/agent/autonomy` (project_admin only; same-origin CSRF; body exactly `{ mode, expectedRevision }`; authority-shaped keys `actor|role|principalId|membershipRevision|capability|authority|approval|revision|scope|…` and any undeclared key refused BY NAME; human actors only). The actor bound into the record is the trusted context's principal + membership revision + role. Both are canonical wrappers with exact policy rows (`authenticated-read` / `authenticated-mutation` ADMIN_ONLY, never a release row); the route-count ratchet moved 153 → 155 methods (152 canonical + 3 factories + **0 raw**) deliberately in the two literal pins.
- **Revisioned / auditable** — 409 `AGENT_AUTONOMY_STALE_REVISION` returns the current setting; GET returns the last 20 changes; the outbox event carries who/from/to/revision.
- **Fail-closed availability** — without a database the store is unavailable: the route answers 503 `AGENT_AUTONOMY_UNAVAILABLE`, the chat run warns and behaves as `proposal_only`. Unavailability never widens.
- **Never a tool** — the setting is not agent-exposed; nothing in a request body, tool argument or model output can assert a mode (the chat route reads it server-side and threads it into `AgentRunContext.autonomy`; the gateway's integrity check refuses a setting that does not belong to the run's project).

## 4. Tests and gates (CONFIRMED)

`b18-a-permission-tiers` (6), `b18-a-autonomy-settings` (4, the repository contract), `b18-a-autonomy-store` (4, durable aggregate), `b18-a-autonomy-route` (6); pinned suites green after regeneration: `b16-1c-invariant-tripwires`, `b16-1b-auth-composition` (155 = 152 + 3 + 0), `b16-0-1-ci-gates`, `b16-0-2-gates`, `b16-0-3-effective-classification`, `b16-0-8-migration-ratchet` (baseline untouched: additions refused by design), `b16-0-auth-route-coverage`, `action-registry` (97 records, 143 routes), `b17-a-control-inventory` (573 / 58 unchanged), the agent and chat suites, `b04`, `b17-f`. tsc 0; eslint 0 new.

## 5. Not yet (RECORDED)

- The human control that changes the mode in the product UI is B18-D (chat execution UX); until then a project administrator changes it through the route (the B18-E browser scenarios exercise it).
- `explicitUserRequest` is a decision INPUT here; how the loop PROVES it (binding the user's literal instruction into the grant) is B18-B/C.
