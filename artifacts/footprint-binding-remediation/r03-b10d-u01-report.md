# R03-B10D-U01 Durable Demo Server Contract Unblock Report

## 1. Verdict

`COMPLETE`

U01 now provides the missing real server bridge: strictly validated demo schematic/netlist publication into the existing durable B3 snapshot aggregate, and exact-scope authoritative board loading from the existing durable PCB repository. A clean PostgreSQL 16 + pgvector database applied migrations `0000` through `0025` and passed publication -> preflight -> explicit apply -> load -> repository recreation -> reload. The same database run proved that an unresolved footprint commits no board and a stale snapshot CAS attempt leaves the committed board unchanged.

Authentication remains explicitly `DEFERRED_BY_USER`. The `x-sirkit-*` headers remain a demo transport and are not represented as production identity. Gap `R02-B1-011` remains open.

## 2. Repository identity and containment

| Item | Evidence |
|---|---|
| Working repository | `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit` |
| Protected original | `C:\Users\robsa\sirkit`; not modified |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting all-path status count | `1,273` |
| Starting fingerprint | `c8d23edd60b44a51b3fc6fcf3307688bf116d45e12b53f9d82e22f1e29c99cfb` |
| Pre-report ending all-path status count | `1,273` |
| Pre-report ending fingerprint | `8d746d8e76ff1a950478925c0bd0d04571c41350741bdc74dd23f95f88a75877` |

The repository was already substantially dirty/untracked. No reset, clean, stash, stage, commit, push, rebase, broad format, dependency update, migration generation, or schema mutation was performed. All unrelated work was preserved.

### Authorized-path baseline ledger

| Path | Baseline lines | Baseline SHA-256 | Final lines | Final SHA-256 | U01 state |
|---|---:|---|---:|---|---|
| `app/lib/pcb-sync/types.ts` | 588 | `e77e720bfbbe4db731c1d104fb16f2d92928d7845a3bd13fa298163c17856563` | 646 | `1e8fc53618480b7b05f5646d5d7e364177c3a94ad1f324a7604e0878dec92ffe` | changed |
| `app/lib/pcb-sync/stable.ts` | 52 | `b9118c8a4947b253b714872d56c1e0d9b3c1712dc78045ad439542340ad31058` | 61 | `50b396c79d05ac56dfd6ced6f8b7c033e4b8194266c9ec3c58680747c72f23da` | changed |
| `app/lib/pcb-sync/durable.ts` | 127 | `789fbd7e40ffb73b389bd0ec53beac1a40f12d7531da366ce5a4dca254add7a7` | 151 | `6c593ba101915afa81d6422e204b41a658f3700fdffbac6638f0d504d986c966` | changed |
| `app/lib/pcb-sync/service.ts` | 242 | `f22041a57abeb70ed22d3954a7e799945fc9fda8cabf42db34c403151558688b` | 242 | same | unchanged |
| `app/api/pcb-sync/handler.ts` | 39 | `b104d81f49153c2fd8eedc10bb3214a342babf595f9f822860a1b9c23f10fdfa` | 162 | `6324f211caf7045bb40fe707cc4a5c94942bbee28a4e1d683ebdc2489c7ead5e` | changed |
| `app/api/pcb-sync/route.ts` | 38 | `400aba9c9fd576e39fc7403cea10ba1f9d5fa34dd92a3e2ffb554d89b0add2df` | 40 | `ca6a8a001d0daeb5048ffb51f48b3fd2795a65f87cdd383d26c21f8e17d2d32b` | changed |
| `app/api/pcb-sync/_scope.ts` | 51 | `69483021e061daeb4734489b73d658543efe1e5aa019159f0772c7549b55e440` | 51 | same | unchanged |
| `app/api/pcb-sync/__tests__/route.test.ts` | 123 | `d22e0f748d948e54683b49f6f633ce6c7283db0f955141545bb4d63242af35d5` | 238 | `894ec6f28ef01130ab2e1a491c116a452a56a56f0b17889ad3f8c6d83b4d8e43` | changed |
| `app/lib/pcb-sync/__tests__/preflight-apply.test.ts` | 262 | `8024a623ab1836854fa51e6b6d9392dca75624b07ef500d5d89470ac6923b463` | 262 | same | unchanged |
| `app/lib/pcb-sync/__tests__/atomicity-recovery.test.ts` | 186 | `b6425e50db1b55da04a8a495ac83e80a8d0281121142905abcd1ed34b47630c7` | 186 | same | unchanged |
| `app/lib/durable-workflow/__tests__/stage3-stage5-owners.test.ts` | 145 | `887d39f60794ae2809b57c9ab94e6793f08ec7ce7d782c040f8f4950062c918d` | 149 | `dec34cc6cf8eb55fd0cc02eb6e9124eeca10b46310e525ff0357c12ef39b28eb` | changed |

## 3. Exact blocker confirmed

Before U01, POST supported only `preflight` and guarded `apply`; GET returned capabilities only. `DurablePcbSyncRepository.getBoard()` persisted complete board content but no API exposed it. `DurablePcbSyncSnapshotStore.publish()` existed, but production had no validated live-schematic publication boundary. The browser could therefore neither create the exact server snapshot preflight required nor load the complete committed board after apply.

During the real PostgreSQL gate, one additional persistence incompatibility was found: deterministic B3 operation ordering keys contain NUL separators, while PostgreSQL `jsonb` rejects `\u0000`. `durable.ts` now losslessly encodes only the affected plan storage strings and decodes them before domain use. Plan IDs and technical digests remain unchanged. No migration was required.

## 4. Demo snapshot-publication API contract

`POST /api/pcb-sync` accepts operation `publish_demo_snapshot` with request schema `sirkit.pcb-sync-demo-publication-request.v1`.

The request carries stable design/board identity, project/design/schematic/component-set/net-graph revisions, assembly variant identity/revision, library/optional constraint revision, expected numeric snapshot aggregate revision, idempotency key, requested time, components with pins, canonical nets with members/no-connects, prerequisite issues, and an optional client-observed source digest. It does not accept tenant, project, branch, actor, an authoritative snapshot object, board content, or path.

The server:

1. enforces the existing 8 MB request limit;
2. rejects unknown publication and nested graph fields;
3. validates bounded string/collection domains;
4. rejects duplicate component, reference, pin, net, member, and no-connect identities;
5. validates component/pin/number/disposition references and requires every connected pin to have a net;
6. deterministically sorts components, pins, nets, members, aliases, constraints, no-connects, and issue references;
7. computes source, schematic, net-graph, and snapshot digests server-side;
8. creates the existing canonical empty B3 board template server-side;
9. publishes through `DurablePcbSyncSnapshotStore` with exact expected-revision CAS;
10. returns snapshot ID, aggregate revision, exact digests, scope/design/board/variant identity, creation/idempotency state, and the canonical snapshot;
11. performs no board mutation and no footprint assignment.

Created publication returns HTTP `201`; identical replay returns HTTP `200`, the original snapshot identity/content, `created:false`, and `idempotent:true`. Reusing the same key with changed digest, board identity, or actor returns `PS_SNAPSHOT_IDEMPOTENCY_CONFLICT`. Stale expected revision returns `PS_SNAPSHOT_REVISION_CONFLICT`.

The narrow response advertises `{ authentication: "deferred", gap: "R02-B1-011" }`. This is honest demo ingestion, not production trust.

## 5. Authoritative board-load API contract

`GET /api/pcb-sync?boardId=<stable-id>` derives tenant/project/branch and actor from the existing scope helper. Optional `knownRevision` and `knownDigest` implement exact conditional validation.

Outcomes:

- `found`: exact `PcbSyncBoardRecord`, including complete committed board content, revision, digest, scope, board ID, and update time;
- `not_modified`: only when every supplied known revision/digest matches exactly;
- `not_found`: explicit HTTP `404`; no revision-zero or empty committed board is fabricated.

Unknown/duplicate query fields reject. The handler recomputes the board record revision/digest before response, and the durable repository also verifies the payload and durable head digest. Reads are exact-scope, emit no outbox event, mutate no aggregate, never accept board content, and never reconstruct from client state.

The existing board record does not store source snapshot/plan identity, so U01 does not fabricate those fields.

## 6. Scope and demo-security boundary

Snapshot publication, preflight, apply, and board load use the same `pcbSyncScope()` result. Body scope/actor substitution is rejected for the publication request and overwritten by existing behavior for preflight/apply. Missing/malformed demo scope returns `PS_API_UNAUTHENTICATED`. Publication additionally requires `pcb_editor`, `project_admin`, or `automation` role. Cross-project snapshot acquisition and cross-project board loading return no data.

No Supabase Auth, Clerk, Auth.js, middleware, membership/user table, login UI, secret, or authentication dependency was added. Production identity gap `R02-B1-011` remains open.

## 7. Canonicalization, digest, idempotency, and CAS

`canonicalAuthoritativeSnapshot()` centralizes deterministic collection normalization. `authoritativeSnapshotDigest()` digests the normalized model and the canonical PCB revision payload. The durable publication replay is bound to the server snapshot digest, board identity, and demo actor. Exact retries return the stored result; changed reuse fails instead of silently replaying. The durable aggregate revision is `expectedRevision + 1`, and PostgreSQL/in-memory optimistic conflicts are translated to `PS_SNAPSHOT_REVISION_CONFLICT`.

The plan JSONB codec replaces literal NUL separators with the lossless storage token `\\u0000` only for `targetStableId` and `orderingKey`, then reverses it on load. Domain plan digest validation continues over the original NUL-bearing values.

## 8. Initial-board behavior

Before first apply, board load returns explicit `not_found`. Publication does not create a board. Preflight uses only the server-created `createEmptyBoard()` template already supported by B3. First apply retains the existing expected-absent board guard and atomically commits the complete staged board, plan lifecycle, audit, replay, and owner-bound outbox event.

## 9. B08 TypeScript defect

The passive-policy test now types the mock input from `Parameters<PassivePolicyInvalidationTarget["invalidate"]>[0]`. It narrows the outbox event through exact `eventType === "passive-policy.invalidate"` and `eventVersion === 1` checks before reading `toPolicyRevisionId`. The assertion remains present and no `any` or unchecked payload cast was introduced. Ordering, owner, digest, convergence, stale-count, and replay coverage remain intact.

## 10. Test and static-analysis results

| Gate | Result |
|---|---|
| U01 route suite | `10 passed`, `1 PostgreSQL-gated skipped` in ordinary run |
| Route + complete preflight/apply + atomicity/recovery + B08 owner test | `54 passed`, `1 PostgreSQL-gated skipped` |
| Final isolated PostgreSQL route integration | `1 passed`, `10 unrelated tests filtered` |
| Focused ESLint on all seven changed product/test files | exit `0`, no findings |
| Full TypeScript polled to completion | exit `1`, exactly `14` expected assignment-queue diagnostics |
| B08 diagnostic | removed |
| New U01 product/API/type diagnostics | `0` |

The broader `app/lib/pcb-sync` command reported `60 passed`, `14 failed`, `1 skipped`. All 14 failures stop in the pre-existing shared `app/lib/footprint-resolver/__tests__/fixtures.ts` with `PB_DECISION_EVIDENCE_REQUIRED`; that fixture does not supply the B1 select/approve decision evidence now required by production. It is outside U01's authorized paths. U01 did not weaken B1 evidence enforcement or modify that fixture. The U01-owned route fixture uses legitimate evidence and all affected contract/domain tests pass.

## 11. Isolated PostgreSQL identity and migration evidence

| Item | Final qualification evidence |
|---|---|
| Container | `sirkit-r03-b10d-u01-final2-20260720180931` |
| Image | `pgvector/pgvector:pg16` |
| Server | PostgreSQL `16.14 (Debian 16.14-1.pgdg12+1)` |
| Database | fresh disposable `sirkit` |
| Network | ephemeral `127.0.0.1` port only |
| Migration chain | `26/26`, exact `0000` through `0025`, `ON_ERROR_STOP=1`, per-file single transaction |
| Final durable rows | `7 records | 5 replays | 3 outbox events` |
| Cleanup | `U01_CLEANUP_PRESENT=False` |

No ambient `DATABASE_URL`, `.env` secret, shared Supabase instance, or production data was used. An initial plain `postgres:16` attempt failed closed at `0000` because the required `vector` type was absent; it was cleaned. Qualification then used the correct Supabase-compatible PostgreSQL 16 pgvector image without skipping or altering any migration.

## 12. Ready-flow durable identities

```text
snapshotId       pcb-sync-snapshot:c0e41694d9d4e8b894b429ad220df3f7
snapshotRevision 1
snapshotDigest   pb1-ae183529164719612423df2999fb4b7575ab7bc3be8c46ed726f5595cb2934fe
planId           pcb-sync-plan:828e8f487782a74ee458707e69e03bef
planDigest       pb1-30086a8a5e840f60c929570c9a552fb37c6cd12a19f1aebbdabd26e33cbffd67
boardRevision    pcb2-da38df77e0ea98ac
boardDigest      pb1-cda1c7fe09785d748b6d463cab0920a26d875d41133f73ca6b0ae657d9d10c2b
reloadDigest     pb1-cda1c7fe09785d748b6d463cab0920a26d875d41133f73ca6b0ae657d9d10c2b
```

Repository and handler objects were recreated before reload. Revision, digest, and complete board content remained identical.

## 13. Blocked and stale/conflict no-mutation evidence

The PostgreSQL run published a separate valid graph whose component had no authoritative footprint binding. Preflight returned `blocked_component_resolution`; `board-pg-blocked` remained absent. No apply was attempted and no board aggregate was created.

The run then attempted a changed snapshot on the ready design with expected aggregate revision `0` after revision `1` existed. It returned HTTP `409` / `PS_SNAPSHOT_REVISION_CONFLICT`. The previously committed `board-1` record before and after the conflict was deeply equal, including revision, digest, content, and timestamp.

Unit coverage additionally proves changed-content and changed-actor idempotency conflict, malformed graph rejection before persistence, duplicate and oversized rejection, cross-scope isolation, explicit missing-board behavior, conditional not-modified behavior, and mutation-free reads.

## 14. Full TypeScript inventory before and after

Before U01: `15` diagnostics: `14` known assignment-queue/B7 compatibility diagnostics plus the B08 test error on `toPolicyRevisionId`.

After U01: exactly `14` diagnostics, all in:

- `app/lib/assignment-queue/__tests__/materializer-repository.test.ts`: one obsolete `applicability: "fitted"` diagnostic;
- `app/lib/assignment-queue/repository.ts`: stale durable-workflow method arities and owner/event type/version omissions.

There are no diagnostics in a U01 product/test path and no remaining B08 diagnostic. Assignment-queue files were not modified.

## 15. Exact files and churn

Seven product/test files changed:

1. `app/lib/pcb-sync/types.ts`
2. `app/lib/pcb-sync/stable.ts`
3. `app/lib/pcb-sync/durable.ts`
4. `app/api/pcb-sync/handler.ts`
5. `app/api/pcb-sync/route.ts`
6. `app/api/pcb-sync/__tests__/route.test.ts`
7. `app/lib/durable-workflow/__tests__/stage3-stage5-owners.test.ts`

Conservative isolated U01 patch ledger: `+409 / -74` product/test lines (`483` total churn), below the `1,200` limit. The report is the one separately authorized artifact. No generated file was created.

## 16. Forbidden-path confirmation

No editor, local board persistence, netlist bridge, PCB-sync client, assignment queue, authentication/B09, AI editor, component search, routing, placement, footprint resolver, Stage 6/7, schema, migration, dependency, lockfile, or generated path changed. `service.ts`, `_scope.ts`, `preflight-apply.test.ts`, and `atomicity-recovery.test.ts` retained their baseline hashes.

## 17. Cleanup evidence

All disposable containers from qualification, including failed setup/diagnostic attempts, were removed. Final filter result was empty and `U01_CLEANUP_PRESENT=False`. No environment variable, database volume, published container, temporary migration, or generated test artifact remains.

## 18. Authorization decision

`R03-B10D Retry 01` is authorized to consume these server contracts. It must still repair its separately assigned 14 assignment-queue diagnostics and implement the editor/client integration in its own authorized paths. U01 does not authorize R04D, Stage 6 demo resumption, or Stage 7.

