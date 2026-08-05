# R05-RC01 Schematic-to-DSN Electrical Identity Integrity

## 1. Verdict and repository fingerprints

**Verdict: `COMPLETE`.** The current durable schematic-to-board path preserves stable net identity on unrelated net insertion, refuses unsafe deletion/legacy ambiguity without mutation, validates the exact verified pin-to-pad artifact before planning, independently revalidates PCB mapping truth at the DSN gate, rejects canonical reference collisions, and retains the already-complete semantic PCB revision contract.

| Item | Evidence |
|---|---|
| Working repository | `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit` |
| Protected original | `C:\Users\robsa\sirkit` exists and was not modified |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting working-tree fingerprint | `f6ddcdf2288d1ea794fe760cd49dda594849c660f06bc68fd94a033a8ac5b068` |
| B10D prerequisite | `r03-b10d-retry-02-report.md`: `COMPLETE_DEMO` |
| Starting full TypeScript | exit `0`, zero diagnostics |
| Final full TypeScript | exit `0`, zero diagnostics |

The repository was already substantially dirty and included untracked B3 files before R05-RC01. No reset, clean, stash, stage, commit, push, rebase, migration generation, dependency update, or broad formatting was performed.

Authorized production starting fingerprints captured before edits:

| Path | Starting SHA-256 | Starting lines |
|---|---:|---:|
| `app/lib/pcb/types.ts` | `ab5b030...` | 369 |
| `app/lib/pcb/netlist-bridge.ts` | `38020a...` | 931 |
| `app/lib/pcb/dsn/preflight.ts` | `530c8d...` | 313 |
| `app/lib/pcb/dsn/write-dsn.ts` | `b1e47f...` | 716 |
| `app/lib/pcb/ai/snapshot.ts` | `383cba70...` | 383 |
| `app/lib/pcb-sync/types.ts` | `646c593b...` | 646 |
| `app/lib/pcb-sync/service.ts` | `f22041...` | 242 |
| `app/lib/pcb-sync/durable.ts` | `151c6c59...` | 151 |

Final fingerprints for R05-touched files:

| Path | Final SHA-256 | Final lines |
|---|---:|---:|
| `app/lib/pcb-sync/service.ts` | `2007a0e5c4210e2840911da74aceba9c2e5d66d3ee43f09036758f8e2608e5ae` | 346 |
| `app/lib/pcb/dsn/preflight.ts` | `b5fe68764662b776c82762303d1ed4a50a8f983a796a3de384ea70878725e7a1` | 363 |
| `app/lib/pcb-sync/__tests__/preflight-apply.test.ts` | `39758be9d24bf284a500647cb94b7504e294a3d3395ecbb1572bda3acec2f7fe` | 409 |
| `app/lib/pcb/__tests__/write-dsn.test.ts` | `d31c54c7bbac80b8abf816d1b46394f4336fc8092ef54093ac743fe78044f069` | 199 |
| `app/lib/pcb/__tests__/electrical-identity-boundary.test.ts` | `6bf080d3cee948076188e654d2d2bc13937a8178b2be514fc2c94787f8d82573` | 146 |

## 2. Current authoritative call graph

```text
live SchematicState
  -> buildPcbSyncPublicationGraph
     - canonical component/pin identities
     - durable stableNetId + exact members
  -> U01 createPcbSyncPostHandler.publish_demo_snapshot
     - strict graph validation
     - DurablePcbSyncSnapshotStore (PostgreSQL durable aggregate)
  -> PcbSynchronizationService.preflight
     - acquire exact snapshot revision
     - Stage 2 exact binding resolution
     - immutable footprint + verified mapping materialization
     - R05 mapping-content/digest/identity validation
     - stable-ID reconciliation and exact plan
  -> explicit human Apply
     - stage clone
     - stable-ID executor
     - complete staged validation
     - one durable board/plan/audit/outbox transaction
  -> authoritative PcbBoard load/reload
  -> boardToDsn candidate construction
  -> assertDsnReady / validateDsn
     - R05 independent mapping and DSN parity validation
  -> router launch only after successful preflight
```

`PcbEditor` does not call `syncFromSchematic` for authoritative synchronization. The function remains an explicit legacy/import/test path. R05 did not refactor it. Its existing safety regressions remain useful defense-in-depth, but durable authority is U01 -> snapshot -> B3 -> durable board.

## 3. Audit defects: reproduction and disposition

### C-01 numeric net-ID drift

**Current-path disposition: fixed before R05, strengthened by R05.**

- `PcbNet.id` remains a board-local serialization index.
- `PcbNet.stableId` and `endpointKeys` carry source electrical identity.
- B3 reconciles by `stableId`; executor lookup never uses numeric equality as source identity.
- Insertion of earlier-sorting `AAA` created a new numeric net while track `r05-track`, via `r05-via`, and zone `r05-zone` remained attached to `stable-net-1` byte-equivalently.
- Rename preserves the stable identity and changes only the display name/semantic revision.
- Routed membership change is already blocked by `PS_ROUTED_NET_CHANGE_REQUIRES_STAGE8`.
- Split/merge regressions already reject routed ambiguity atomically.

One current-path defect was found: a source-net deletion could previously appear as `ready_no_changes` while the old board net remained. R05 now detects every board-only stable net. It returns `PS_REMOVED_NET_RECONCILIATION_REQUIRED`, or `PS_REMOVED_NET_PROTECTED` with exact track/via/zone IDs, and does not publish a board. This authorized batch cannot synthesize the missing removal plan because `plan.ts`/`executor.ts` were forbidden; fail-closed is the required safe behavior. Legacy nonzero nets without `stableId` now return `PS_BOARD_NET_IDENTITY_UNKNOWN`; duplicate board stable IDs return `PS_BOARD_NET_IDENTITY_DUPLICATE`.

### C-02 pin/pad count acceptance

**Current-path disposition: core exact mapping existed; one live multiplicity gap fixed.**

The durable path already required the selected binding, footprint asset version/content digest, mapping certificate, exact pin identifiers, and existing pad numbers. Pre-repair reproductions proved two pins could nevertheless claim one physical pad using ordinary `electrical` mappings and still receive `ready_to_apply`; the equivalent DSN also passed preflight. Both focused reproductions failed before the production repair.

R05 now:

- recomputes and verifies mapping artifact and footprint materialization digests;
- requires exactly one entry bound to each exact `pinInstanceId` and symbol pin number;
- uses the existing shared `resolvePinPadMapping` authority for missing/unknown pins and pads, explicit many-to-one/one-to-many semantics, connected nonphysical pins, unclassified pads, and pad/net conflicts;
- blocks unauthorized shared ownership as `PS_MAPPING_PAD_OWNERSHIP_CONFLICT`;
- accepts explicitly `internally-common` one-pin/multiple-pad mappings;
- accepts explicit mechanical NPTH holes without creating electrical nodes;
- blocks unaccounted exposed/electrical pads as `PS_MAPPING_UNCLASSIFIED_FOOTPRINT_PAD`.

### C-04 duplicate references

**Current-path disposition: exact U01 and DSN checks existed; canonical B3 defense added.**

- U01 already rejects duplicate component IDs, exact duplicate references, duplicate pin identities, duplicate stable net identities, and malformed net-member references before persistence.
- B3 now canonicalizes references with the existing KiCad/Sirkit comparison rule and rejects case/whitespace-equivalent collisions as `PS_REFERENCE_DESIGNATOR_DUPLICATE` before resolution or board mutation.
- B3 defensively rejects duplicate component, pin-number/pin-instance, and stable-net identities even if a non-U01 snapshot provider is introduced.
- DSN preflight already rejects canonical reference collisions and now also rejects duplicate serialized component/pin keys, node keys, and endpoint-manifest keys.
- No automatic renumbering occurs.

### C-09 incomplete PCB semantic revision

**Current-path disposition: `RETIRED_BY_ARCHITECTURE`; already repaired before R05.**

The live `pcbRevisionId` delegates to canonical `pcbRevisionPayload` in `app/lib/pcb/revision.ts`. That payload already includes stable net identity/membership/name, footprint geometry/placement/source mapping, pad-net assignments, tracks/vias/zones/locks/provenance, stackup and plane intent, outline, routing preferences, keepouts, net classes, constraints, placement policy, and manufacturing-relevant board state. It excludes viewport/selection/transient progress.

Existing regressions prove revision invalidation for net rename/stable identity/membership, routing preferences, net classes, stackup routing/plane assignment, outline/keepouts, footprint/pad geometry and placement, copper and locks. Canonical collection reordering is invariant. Stale repair, routing, readiness, and release candidates reject. No forbidden revision/router/DRC/Gerber file required modification.

## 4. Stable net identity and propagation

The stable net contract is the durable `stableNetId` emitted by the canonical publication graph and persisted through:

1. U01 `PcbSyncAuthoritativeSnapshot.nets[].stableNetId`;
2. B3 `NetTransferAssessment` and plan operations;
3. authoritative `PcbBoard.nets[].stableId` plus sorted `endpointKeys`;
4. board revision/digest payload;
5. DSN integrity v2 `stableNetId`, endpoint, terminal-group, and physical-pad ledgers.

The ID is deterministic from authoritative source ownership, unaffected by display rename or unrelated net insertion/deletion, and scoped by the exact tenant/project/branch/design/schematic snapshot. Board-local numeric IDs are allocated only after stable reconciliation.

## 5. Legacy and ambiguous behavior

- Missing stable identity is not permission to map by numeric ID or name.
- Existing nonzero legacy nets fail with `PS_BOARD_NET_IDENTITY_UNKNOWN`.
- A stable board net absent from the source fails with an explicit reconciliation/protected-state diagnostic.
- A changed routed membership, split, merge, or protected removal fails before mutation.
- Diagnostics include stable net identity and exact protected object IDs where present.
- Original board records are deeply equal after every blocked successor in memory and PostgreSQL.

## 6. Pin/pad authority and multiplicity rules

Accepted:

- one exact schematic pin -> one exact footprint pad;
- one exact pin -> several pads when the verified mapping explicitly permits it;
- several pins -> a common pad only when every owner is `internally-common` and all owners resolve to one net (or are all unconnected);
- explicit exposed-pad mapping;
- explicit intentional no-connect/schematic-only pins when not connected;
- NPTH/mechanical pads with no electrical node.

Rejected:

- equal counts with different identifiers (`1,3` versus `1,2`);
- missing or duplicate `pinInstanceId` authority;
- mapping content/digest mismatch;
- nonexistent pad numbers;
- connected no-connect/schematic-only endpoints;
- ordinary electrical mappings that share one pad;
- internally-common owners on different nets;
- missing exposed/electrical pad accounting;
- mechanical classifications for nonexistent pads.

## 7. DSN parity gate

`validateDsn` now independently reconstructs each board component's mapping contract with `resolvePinPadMapping` and validates it before a candidate can pass `assertDsnReady`. It checks:

- exact component ID, symbol pin, endpoint key, and pad ownership;
- duplicate endpoint, DSN pin, and DSN node keys;
- unique canonical references;
- exact stable-net manifest parity;
- every source endpoint and physical pad instance in the emitted component/network;
- no unclassified electrical pad;
- no endpoint on multiple PCB nets;
- no stale source revision or altered conservation manifest.

`boardToDsn` may construct an in-memory diagnostic candidate, but it cannot become routable or launch routing after any blocking parity result. The writer was not weakened and no router/SES/Gerber path changed.

## 8. Duplicate identity rules

| Boundary | Rejected identities |
|---|---|
| U01 publication | component, exact ref, pin instance, stable net, invalid member reference |
| B3 preflight | component, canonical ref, pin instance/number, stable source net, stable board net, exact mapping pin identity |
| DSN preflight | canonical component ref, mapping endpoint, serialized pin, physical node, manifest endpoint, stable net |

Annotation remains upstream authority. No PCB-side auto-renumbering was introduced.

## 9. Semantic revision before/after

No product change was needed. The audited C-09 reproduction no longer executes against the current revision architecture. Tests prove:

- net rename changes revision;
- stable net identity/membership changes revision;
- net class/routing preference changes revision;
- stackup routing and plane assignment changes revision;
- outline/keepout/footprint/copper/lock changes revision;
- canonical reordering does not change revision;
- UI-only state is outside `PcbBoard` revision payload;
- candidates bound to an old revision reject.

## 10. Tests, typecheck, and lint

| Gate | Result |
|---|---|
| Starting focused safety suite | 7 files, 62/62 passed |
| Pre-repair gap reproduction | 2 intended failures: B3 duplicate pad ownership and DSN duplicate pad ownership |
| Modified focused B3 + DSN | 33/33 passed before expanded durable cases |
| Final affected netlist/connectivity/DSN/B3/U01/B10D suite | 16 files, 133/133 passed, 3 environment-gated skipped |
| Stale-candidate/readiness/release suite | 3 files, 30/30 passed |
| In-memory durable identity flow | 1/1 passed |
| PostgreSQL durable identity flow | 1/1 passed |
| PostgreSQL U01 handler flow | 1/1 passed |
| Full TypeScript | exit `0`, zero diagnostics |
| Focused production/new-test lint | exit `0`, zero warnings |
| `git diff --check` on tracked R05 files | exit `0` |

One deliberately broader run reported `139 passed`, `14 failed`, `3 skipped`. All 14 failures stop before R05 in three untouched legacy PCB-sync tests because their shared `footprint-resolver/__tests__/fixtures.ts` omits the now-required B1 decision evidence (`PB_DECISION_EVIDENCE_REQUIRED`). This exact baseline incompatibility was documented by U01; it is not an R05 regression. The authoritative R05 fixtures use legitimate select/approve evidence.

## 11. Isolated PostgreSQL identity and migration evidence

| Item | Evidence |
|---|---|
| Docker | Desktop 4.67.0, client/server 29.3.1, `desktop-linux` |
| Image | `pgvector/pgvector:pg16` |
| PostgreSQL | `16.14 (Debian 16.14-1.pgdg12+1)` |
| pgvector | `0.8.5` |
| Migration chain | 26/26, exact `0000` through `0025`, `ON_ERROR_STOP=1`, per-file transaction |
| Public tables after migration | 140 |
| Identity-flow durable rows | 17 records / 13 replays / 7 outbox events |
| U01-flow durable rows | 7 records / 5 replays / 3 outbox events |
| Cleanup | both labeled disposable containers removed; no R05 containers remain |

No ambient/shared/development/production database was used. Both databases were new container-local `sirkit` databases bound to random loopback ports. No volume was created.

## 12. Durable resync identities, digests, and no-mutation evidence

R05 identity flow after earlier-sorting net insertion and repository recreation:

```text
boardRevision       pcb2-faa8f0803c7954bd
boardDigest         pb1-f3d9d9cb4edcb190a7cad08a2d95f0323b7bfc204bbdc597abf074fbdde44cb5
track/via/zone net  stable-net-1
```

U01 live handler flow:

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

The PostgreSQL identity flow additionally published successors for:

1. an unrelated earlier-sorting net: applied, exact copper preserved;
2. deletion of that net: blocked, board deeply unchanged;
3. symbol pins `1,3` versus footprint pads `1,2`: blocked mapping, board deeply unchanged;
4. canonical duplicate reference: blocked conflict, board deeply unchanged;
5. fresh repository object: exact record/revision/digest/content reload.

## 13. Exact files and churn

R05 changed five product/test files:

1. `app/lib/pcb-sync/service.ts`
2. `app/lib/pcb/dsn/preflight.ts`
3. `app/lib/pcb-sync/__tests__/preflight-apply.test.ts`
4. `app/lib/pcb/__tests__/write-dsn.test.ts`
5. `app/lib/pcb/__tests__/electrical-identity-boundary.test.ts`

Because `service.ts` and `preflight-apply.test.ts` were already untracked at the R05 baseline, Git cannot reconstruct their task-local numstat. The conservative ledger counts every current line of all three untracked R05 files as newly added, plus the complete tracked diff:

```text
tracked:              +296 / -3
untracked upper bound: +901 / -0
conservative total:  +1197 / -3
files: 5 / 13
total churn: 1200 / 1500
```

This is a strict upper bound; actual R05 task-local churn is materially smaller. The report is the separately authorized artifact and is excluded from product/test churn.

## 14. Forbidden-path and cleanup confirmation

R05 modified no editor/assignment/auth, footprint-resolver, physical-binding, mapping authority, passive-policy, placement, router, DRC, SES, Gerber, manufacturing, Drizzle/schema, migration, dependency, lockfile, or generated path. Pre-existing changes in those areas were preserved untouched.

No test database, container, volume, staged file, commit, branch change, or process was left behind. The protected original was not modified.

## 15. Authorization

R05-RC01 completion gates pass. **R05-RC02 autorouter/interchange hardening is authorized.** This does not authorize R04D final qualification, Gerber release, manufacturing release, or changes outside the next prompt's explicit scope.

```text
R05-RC01 VERDICT: COMPLETE
STABLE NET IDENTITY: PASS
UNRELATED NET INSERT/DELETE PRESERVES COPPER: PASS
NET SPLIT/MERGE FAILS CLOSED: PASS
EXACT PIN/PAD MAPPING: PASS
DUPLICATE REFERENCES REJECTED: PASS
DSN SCHEMATIC PARITY: PASS
SEMANTIC PCB REVISION COMPLETE: PASS
STALE CANDIDATE REJECTION: PASS
DURABLE POSTGRESQL RESYNC SMOKE: PASS
FULL TYPESCRIPT: PASS
FOCUSED TESTS: 163/163
PRODUCT/TEST FILES CHANGED: 5
PRODUCT/TEST DIFF CHURN: +1197 / -3
MIGRATION OR SCHEMA CHANGED: NO
FORBIDDEN FILES CHANGED: NO
R05-RC02 AUTHORIZED: YES
R04D FINAL QUALIFICATION AUTHORIZED: NO
GERBER RELEASE AUTHORIZED: NO
REPORT: artifacts/prompt-to-gerber/r05-rc01-report.md
```
