# B16.0.22 — Unknowns & owner decisions

## Decisions taken

1. **Legacy refusal contract instead of raw retention** — the
   replacement-authority envelopes are §A-pinned byte-exact; the wrapper
   gained the closed-enum `legacyReaderRefusals: "replacement-authority-v1"`
   (precedent: B16.0.14's selector refusal contract). No route can inject
   envelope logic. **CONFIRMED**.
2. **Two envelope/dispatch normalizations** (pcb-sync duplicated query key;
   assignment-queue declared-length code label) — reproduced verbatim
   pre-edit, superseded with in-test notes
   ([query-projection-deltas.md](query-projection-deltas.md)). **CONFIRMED**.
3. **pcb-sync board-get split** into a Request-free core (canonical route
   path) + retained legacy Request adapter (standing factory tests, keeps the
   historical duplicate-key refusal). **CONFIRMED**.
4. **Two standing boundary-gate pins updated, not weakened** — the B16.0.2/3
   route-specific pins asserted the RAW guard-first form for
   replacement-authority; they now assert the canonical-wrapper
   classification (provenance-checked, strictly stronger). The generic
   zero-exception gates passed unchanged. **CONFIRMED**.
5. **Family scope helpers retained** (`scopedAssignmentJson`, `bindingScope`,
   `pcbSyncScope`, …) for their standing suites; routes use the new
   Request-free projectors. **CONFIRMED**.
6. **ESLint**: 4 pre-existing warnings in
   `app/api/passive-policy/__tests__/route-security.test.ts` (unused
   `_request` params, untouched file), 0 errors. **RECORDED**.

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN** (no live network in
  scope).
- **Remaining migration: 18 raw methods** (baseline 21) — the spice family,
  chat, and misc routes, plus the 3 factory routes (pcb-sync POST,
  passive-policy POST, + one prior). **CONFIRMED**.
- The replacement-authority `automation` policy role has no session
  `MembershipRole` mapping (memberships map to viewer/commenter/pcb_editor/
  reviewer/project_admin), so it is unexercisable via session principals —
  UNKNOWN whether any future worker-class principal is intended to use it.
  **RECORDED**, unchanged from pre-migration.

## Scope adherence

No provider credits, subprocesses, containers, devices, network, or DB
writes. Protected original `C:\Users\robsa\sirkit` untouched. B16.1, MCP,
multi-agent orchestration, provider expansion NOT started.
