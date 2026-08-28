# B16.0.22 — authorization & trusted-scope proof

Evidence: `app/api/__tests__/b16-0-22-tranche-parity.test.ts` (59/59 pre AND
post) + exact policy rows pinned from `policyFor()`.

## Policy rows (pinned)

| method | class | roles | CSRF |
|---|---|---|---|
| 4× GET | authenticated read | ALL_MEMBERS (viewer admitted) | none |
| assignment-queue / footprint-resolution / physical-bindings POST | mutation | pcb_editor, reviewer, project_admin | required |
| replacement-authority POST | read (proof endpoint) | pcb_editor, reviewer, project_admin, automation | required |

## Pinned per method (pre = post)

- **Unauthenticated → 401** (all 8), **foreign membership → 403**, **revoked
  membership → 403** — with ZERO domain work: `listPage` / `resolve` /
  `repository.load` / `loadRunComponentAuthority` spies all uncalled.
  **CONFIRMED**.
- **viewer/commenter → 403 on every POST**; **viewer admitted past
  authorization on every GET**. **CONFIRMED**.
- **Trusted scope is the only authority**: assignment preview and footprint
  resolve requests force `tenantId/projectId/branchId/actorContext`
  (actorId `u1`, actorKind `human`) over browser-supplied values;
  physical-binding create forces `origin.actor` + `createdBy`; the
  replacement-authority loader receives the TRUSTED scope and `binding.scope`
  echoes it. **CONFIRMED** by spy-argument pins.
- **Scope byte-match**: physical-bindings candidate/transition against a
  foreign-scope set → 403 `PB_API_SCOPE_FORBIDDEN` before the service runs;
  replacement-authority smuggled body scope → 403 with the exact historical
  text. **CONFIRMED**.

## Projections added (Request-free)

`assignmentScopeFromContext`, `resolutionScopeFromContext`,
`bindingScopeFromContext`, `passivePolicyScopeFromContext` (pcb-sync's
existed since B16.0.15) — each the exact projection its `scopedXJson` helper
returned. The helpers themselves are retained for their standing suites.
