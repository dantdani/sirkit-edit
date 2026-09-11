# B18 — Safe agent execution of reversible engineering operations (`chapter/b18-agent-execution`, PR #8)

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Base: `804a08d` (B17 merged normally in PR #7, 2026-09-10 03:20 UTC). Mission: chat can truly execute authorized Tier 0 and permitted Tier 1 operations through the canonical executor; Tier 2 stays human-approved proposal/apply; Tier 3 stays inaccessible; every scenario revision-bound, recoverable, truthfully reported.

| checkpoint | artifact | state |
|---|---|---|
| discovery | `discovery.md` (read-only sweep of registries, executors, approval machinery, agent runtime, chat UX, tests that pin the current boundary) | INFERRED — to be confirmed by reproduction in B18-A |
| B18-A permission tiers and autonomy settings | `permission-tiers.md` | CONFIRMED — tiers mapped onto the existing approval vocabulary with a pure fail-closed decision; the project autonomy setting as a server-owned durable-workflow aggregate (revisioned CAS, audit record + outbox event), canonical `GET/POST /api/agent/autonomy` (all-members read; project_admin mutation), the chat run reads it server-side (unavailable = proposal_only); route ratchet 155 = 152 + 3 + 0 |
| B18-B server-minted intent and approval grants | `execution-grant-contract.md` | CONFIRMED — the durable grant record (binding of principal/session/membership, scope, family/tier/capability, exact targets, base with the expected revision after, operations + preview digests, explicit-request proof; nonce server-only), the only minter as a `/api/chat` closure, the explicit-request proof by derivation, one-shot consumption with ordered checks and exact burn reasons, browser-attested settlement, the loop's awaited settlement from the durable record, the browser ritual over the real canonical session with journal + recovery; routes GET/POST `/api/agent/execution-grant`, POST `/settle`; ratchet 158 = 155 + 3 + 0; import gates. Gateway dispatch + exposure lift: B18-C |
| B18-C safe mutation tools | `safe-mutation-contract.md` (design + amendments), `safe-mutation-tools.md` (closing record, I10) | IN PROGRESS — I1 vocabulary + gates (`928160b`, CI green); I2 dispatch + loop + route plumbing (CONFIRMED locally); nothing exposed to a real run until I3 lifts `pcb.move-footprint` |
| B18-D chat execution UX | `chat-execution-ux.md` | pending |
| B18-E mandatory scenarios | `scenarios.md`, `evidence/` | pending |
| validation | `test-and-validation-report.md`, `changed-files.md`, `unknowns-and-owner-decisions.md`, `final-verdict.md` | pending |

Program ledger: `artifacts/remaining-builder-program/`.
