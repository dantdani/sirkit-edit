# B16.0.15 §D — Qualification boundary parity (CONFIRMED)

`POST /api/pcb/qualify` → `authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 })`.
The wrapper runs the authenticated-release policy (pcb_editor | project_admin),
same-origin CSRF, media-type, and the bounded body read BEFORE the callback.
The callback logic — capability screen, outline fitting, qualify-layout, RC01/
RC02/RC03 evidence, authority persistence — is byte-identical to the pre-edit
handler; only the boundary prologue changed.

| Requirement (§D) | Status | Evidence |
|---|---|---|
| 1. client supplies identifiers/options only, never board content | CONFIRMED | forbidden `board`/`snapshot`/`path` → 400 before any work |
| 2. board loaded from `stage3Repository` with the trusted scope | CONFIRMED | pin: `getBoard({tenantId,projectId,branchId,boardId})` from context |
| 3. no body board can enter qualification | CONFIRMED | body `board` is a forbidden key; the callback reads only `record.board` |
| 4. pre-flight capability before router creation | CONFIRMED | `evaluateAutonomousCapability(... pre_placement)` precedes `createAutonomousRouteExecutor` |
| 5. ineligible → zero router/process work | CONFIRMED | pin: ineligible → 422, `createRouter`/`qualifyLayout` never called |
| 6. candidate outlines smallest-first + authoritative fallback | UNCHANGED | `fitOutlineCandidates(...)` then `{ board: sourceBoard, label:"authoritative-default" }` — code untouched |
| 7. selected board published only after complete qualification | UNCHANGED | `commitSelected` runs inside `qualifyAutonomousLayout`; publish gated on `status === "complete"` |
| 8. failed/partial/stale/mismatched cannot publish | UNCHANGED | revision-mismatch guard + status checks unchanged |
| 9. selectedRevision === makeBoardRecord revision | UNCHANGED | `if (next.revision !== selectedRevision) return {ok:false,...}` |
| 10. authoritative netlist from final routed board | UNCHANGED | `routedNetlist = boardToSourceNetlist(board)` on the selected board |
| 11–13. RC01 parity / RC02 evidence (0/0/0) / RC03 capability | UNCHANGED | assembled verbatim into the authority object |
| 14–16. authority persisted only after all evidence; bound to the 6 identity fields; failure paths persist nothing | CONFIRMED (16) + UNCHANGED | pin: ineligible path never calls `authoritySave`; the authority object binds tenant/project/branch/design/board/boardRevision/boardDigest |
| 17. `Cache-Control: no-store` where emitted | UNCHANGED | success response header unchanged |
| 18. `maxDuration = 300` | UNCHANGED | module export untouched |

Items marked UNCHANGED are covered by the standing real qualification suites,
which pass unmodified; the migration did not touch that logic
([qualification-transactional-safety.md](qualification-transactional-safety.md)).
