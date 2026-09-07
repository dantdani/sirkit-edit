# B16.1C — Qualification authority contract (§D)

Route: `POST /api/pcb/qualify` (`app/api/pcb/qualify/route.ts`; policy row pcb_editor | project_admin, same-origin JSON, bounded 8 MB/30 s — unchanged). Every item below is CONFIRMED by the named test unless labelled otherwise.

## Inputs the server reads (never the client)

1. `stage3Repository.getBoardHead(scope)` — the CURRENT durable board record AND its integer aggregate revision (`app/lib/pcb-sync/durable.ts`). Not found → 404 `MFG_AUTHORITATIVE_BOARD_NOT_FOUND`.
2. `resolveQualificationComponentAuthority({ board, scope, bindings: stage3BindingRepository })` (`app/lib/pcb/fab/qualification-authority.ts`) — for every footprint: `syncIdentity` present; the binding named by `bindingRevisionId` is the SELECTED peer for that component instance (`listSelectedPeers` over tenant/project/branch/board/component); lifecycle `selected`; approval `approved`; footprint asset version + content digest match; pin-pad mapping `verified` with the same certificate id; a usable package (mounting smd|through_hole, canonical name) whose EXACT tuple (identity system, canonical name or chip source token, mounting, pin count) is in the closed vocabulary `QUALIFICATION_PACKAGE_VOCABULARY` (`sirkit.qualification-package-vocabulary.v1`: 0603/0805 two-pin passives; SOIC-8/14/16 and TSSOP-8/14/16; 1×01…1×06 2.54 mm vertical pin headers). Anything else → 422 `MFG_COMPONENT_AUTHORITY_INCOMPLETE` (or `MFG_PACKAGE_AUTHORITY_UNSUPPORTED` when every blocker is `QA_PACKAGE_UNSUPPORTED`) with the bounded `QA_*` blocker list; no regex, no substring, no "non_hdi_other" fallback (tripwire). Tests: `qualification-authority.test.ts` (all nine blocker codes), recovery H.3, parity suite.
3. `schematicAuthorityFor(scope)` — the LAST committed pcb-sync audit's plan snapshot (`schematicRevision`, `schematicDigest`, `planId`, `snapshotDigest`); missing → 422 `MFG_SCHEMATIC_AUTHORITY_MISSING`.
4. `DurableManufacturingAuthorityStore.getHead(authorityScope)` — idempotency: if the current board revision + digest, the component-authority digest and the schematic digest all equal the sealed head, the head is returned with `idempotent: true` and NO router runs (acceptance step 8).

## The run

- In-flight guard per (tenant, project, branch, board): a concurrent call is refused 409 `MFG_QUALIFICATION_IN_PROGRESS` (recovery H.11).
- Declaration: `footprintQualifications` are exactly the server-proven classes; risk classes are the profile's declared envelope; `revision = componentAuthority.digest`.
- Capability pre-screen (`evaluateAutonomousCapability`, `sirkit.autonomous-pcb-capability.v1`) → 422 `MFG_AUTONOMOUS_INELIGIBLE` before any router creation (parity suite).
- `qualifyAutonomousLayout` with the production `AutonomousRouteExecutor` (bundled FreeRouting 2.2.4 on the bundled JRE) over fitted outline candidates smallest-first; the selected verified candidate is committed with `publishBoard(next, { expectedRevision: head.aggregateRevision, idempotencyKey: "qualify:<board>:<from>-><to>" })` — compare-and-swap on the CURRENT aggregate revision; a conflict is 409 `MFG_BOARD_REVISION_CONFLICT`, never an overwrite.
- Deterministic CI: the router is REPLAYED from a recording keyed by the exact placed-board revision (`__tests__/fixtures/route-fixture.ts`; fixtures `blinker-route-fixture.json` (2 executions) and `blinker-route-fixture-recovery.json` (4 executions), recorded locally with `SIRKIT_B16_1C_RECORD_ROUTES=1`); replay refuses unknown boards (`ROUTE_FIXTURE_MISS`) and every replayed candidate is re-verified by the unchanged verification code (RC01 parity, `verifyAutorouteCandidate`, capability re-evaluation, DRC).

## The sealed artifact (`ManufacturingReleaseAuthority`, aggregate `mfg.release-authority.v1`)

| Mandated binding | Field(s) | Evidence |
|---|---|---|
| tenant/project/branch | `tenantId, projectId, branchId, designId, boardId` | acceptance 7; H.15 |
| schematic identity + revision | `schematic {revision, digest}` + `schematicAuthority {revision, digest, planId, snapshotDigest}` | acceptance 7 (`schematicRevision` equals the published snapshot's) |
| PCB identity + revision | `boardRevision` (= `pcbRevisionId` of the routed board), `boardDigest`, `board`, `netlist` | acceptance 7/10 |
| component-authority digest | `qualificationAuthority.digest = qualification-authority-<sha256>` over the exact tuples; facets `componentAuthority.{bindingRevision (bindings-…), footprintLibraryRevision (footprints-…), mappingRevision (mappings-…), policyRevision (vocabulary version), assemblyVariantRevision (variants-…), digest (component-authority-…)}` | acceptance 7/10; `qualification-authority.test.ts` |
| footprint / pin-map digest | `footprintLibraryRevision` (asset version + content digest per tuple), `mappingRevision` (certificate ids) | same |
| routing / placement / DRC evidence digests | `rc01.digest = parity-<sha256(parity certificate)>`, `rc02.digest = route-<sha256(pass ids, DSN/SES digests, router versions, remaining/shorts/DRC/vias/length)>`, `rc03.digest = capability-<sha256(evaluation digest)>` (`qualification-evidence.ts`) | acceptance 7 |
| fab profile id + version | `manufacturingRuleProfile {profileId "jlcpcb-2l", version 1, evidence {sourceRef, verifiedAt}, digest}`, `fabPreset`, `drcPreset` | acceptance 10 |
| timestamp + actor | `sourceDate` (server clock), `actor` (server-derived actor id) | acceptance 7 (`actor: u-fresh-editor`) |
| deterministic digest | authority record digest `sha256(stableJson(authority))` returned as `authorityDigest` + aggregate `authorityRevision`; `store.save` is idempotent by `authority:<board>:<boardRevision>:<componentAuthorityDigest>` | acceptance 7/8; recovery H.13 (new revision r2 after a board change) |

Failure → no authority is written (`authoritySave` never called on any refusal path — parity suite; recovery H.6: a router crash leaves board and authority untouched, 500 `MFG_QUALIFY_FAILED` + correlation id, redacted trace).
