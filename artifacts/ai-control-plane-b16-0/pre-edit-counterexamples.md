# B16.0 — pre-edit counterexamples (R02-B1-011), reproduced verbatim

Ten counterexamples were recorded against the UNMODIFIED perimeter before
editing. Items 1-4 were reproduced with a disposable probe against the real
`pcbSyncScope` (deleted after capture); items 5-10 by inspection.

## Items 1-4 — the header-trust probe output (verbatim)

```
B16_0_PROBE {"item1_forgedAdminAccepted":true,"item2_actorIdIsCallerControlled":true,"item3_missingKindDefaultsHuman":true,"item3_invalidKindDefaultsHuman":true,"item4_qualifyReleaseUseScopedPcbSyncJson":true}
```

- **1 — a caller claims `project_admin` and it is accepted.**
  `pcbSyncScope(req({ "x-sirkit-role": "project_admin", "x-sirkit-actor-id": "attacker" }))` returned `{ok:true, scope:{actor:{role:"project_admin", actorId:"attacker"}}}`.
- **2 — a caller changes `x-sirkit-actor-id` and becomes a different apparent human.** `alice` and `bob` each became their claimed actor id, unverified.
- **3 — missing or invalid actor kind defaults to `human`.**
  A missing `x-sirkit-actor-kind`, and an invalid `"totally-made-up"`, both yielded `actorKind:"human"`.
- **4 — `/api/pcb/qualify` and `/api/pcb/release` inherit this caller-controlled scope.** Both routes call `scopedPcbSyncJson` → `pcbSyncScope`; the caller-asserted `scope.actor.actorId` was stamped into the durable `ManufacturingReleaseAuthority.actor` (`qualify/route.ts:210`).

## Items 5-10 — inspection

- **5 — no authoritative project-membership lookup exists.** No `membership`/`project_members` table, type, or lookup anywhere (`grep` clean); `authorization.ts` maps the header-asserted role to capabilities with nothing verifying the caller holds it.
- **6 — no verified server-side session producer exists.** No `@supabase/*` dependency, no `getClaims`/`getUser`/`createServerClient`, no `middleware.ts`. The two `getUser` hits are unrelated model-simulation code.
- **7 — sensitive UI clients construct actor and role headers.** `PcbSyncClient.headers()` sent all seven `x-sirkit-*` headers; `PcbEditor` hard-coded `{actorId:"local-user", role:"project_admin"}`; `AssignmentQueuePanel` sent them in headers AND a body `actorContext`; eight workspace pages hard-coded `local-project-owner`/`project_admin`.
- **8 — production routes read `x-sirkit-role`/`x-sirkit-actor-kind` directly.** 15 `_scope.ts` files plus ~17 inline routes read the identity headers (54 files / 72 occurrences of `x-sirkit-*`).
- **9 — the 12 exposed AI tools cannot invoke manufacturing release.** `sirkit.manufacturing.release` is `operationClass:"release"` (a mutation class) and `agentExposed:false`; the registry validator forbids exposing a mutation class. Exposure is exactly 12 read/propose tools.
- **10 — the MFG01 release gate is server-authority-only.** `releaseManufacturingPackage` reloads the durable `ManufacturingReleaseAuthority` and independently re-validates it (`MFG_AUTHORITY_CHANGED_DURING_GENERATION`), never trusting caller-supplied board content.

## Conclusion

The release ENGINE (items 9-10) is stronger than its HTTP identity PERIMETER
(items 1-8): a forged `x-sirkit-role: project_admin` header authorized
qualify/release scope. B16.0 repairs the perimeter (server-derived identity +
project membership, fail-closed in production, explicit local_dev) without
touching the engine.
