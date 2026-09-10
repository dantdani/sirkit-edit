# B16-C.1 — Routed-board revision contract

Labels: CONFIRMED = executed and measured on this machine; INFERRED = derived from code reading; PROPOSED = design not yet exercised; RECORDED = written down without a claim; UNKNOWN = not established.

## The guard stays (CONFIRMED)

Structural schematic → PCB synchronization is still refused once protected copper exists: `PS_STRUCTURAL_ADD_REQUIRES_UNROUTED_BOARD`, `PS_ROUTED_NET_CHANGE_REQUIRES_STAGE8`, `PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8`, `PS_REMOVED_NET_PROTECTED`, `PS_ROUTED_COMPONENT_REMOVAL_REQUIRES_STAGE8`, `PS_EXTRA_BOARD_COMPONENT_PROTECTED` are all reproduced on the routed parent in `app/lib/pcb-sync/__tests__/b16-c-board-revision.test.ts` before each product path is taken. The sync policy (`blockRoutedStructuralChanges: true`) is unchanged; `validatePcbSyncPolicy` still refuses any weakening.

## The product path: derive a new board revision (CONFIRMED)

`POST /api/pcb-sync` `preview_board_revision` → human review → `derive_board_revision` (`app/lib/pcb-sync/board-revision.ts`, `board-lineage.ts`, `service.ts`).

1. **Identity.** A derived board gets a NEW id `<root>@r<generation>` (`pcbDerivedBoardInstanceId`, `pcbBoardLineageOf`). The parent's record, its qualification authority and its release ledger are keyed by the old id and are never rewritten.
2. **Rework plan (pure, deterministic).** `previewBoardRevision({ parent, snapshot, assessments, carry, outline? })` → `BoardRevisionPlan` sealed by `planDigest` (same inputs → same digest; asserted). Per component: `kept | added | removed | footprint_changed | pin_map_changed | symbol_changed | placement_reset` with the reasons. Per net: `copper_retained | copper_stripped | unrouted | added | removed` with the PROOF (`parentEndpoints`, `nextEndpoints`, `equivalent`, `reason`).
3. **Semantic-equivalence proof.** Copper is retained for a net ONLY when: same stable net id; the parent net's canonical endpoint set (`component::pin`, derived from pad → verified pin-pad mapping, never from display names; cross-checked against the board net's `endpointKeys`) is byte-identical to the new snapshot's; every member component is kept (same footprint asset version + content digest, same mapping certificate, same symbol version); placement is carried (copper geometry depends on pad positions); and the operator carried copper. Anything else is stripped and the reason is written per net. Zones on retained nets are carried with `dirty: true` (must be re-poured). Board-only footprints and nets without stable identity are never carried.
4. **Explicit carry-forward.** `carry: { copper, placement, constraints }` are three separate operator decisions; `constraints=false` drops `constraintState`, `netClassing` and routing keepouts; `placement=false` drops every footprint (the sync re-places them) and therefore every copper; an explicit `outline` may replace the parent outline (recorded as `outline.changed`).
5. **Human review.** `humanReviewRequired: true`; derivation requires `confirmation: "derive_board_revision"`, a human `pcb_editor` / `project_admin`, the plan id + digest and the derived sync plan digest — all recomputed server-side and refused on drift (`PS_BOARD_DERIVATION_PLAN_MISMATCH` 409). The browser dialog (`BoardRevisionDialog`) shows the plan and requires an explicit "I reviewed this rework plan" acknowledgement.
6. **Derivation-aware sync on the stripped board.** The stripped board is synchronized with the current snapshot in the SAME commit (adds, removals, membership updates). Only on this transient derived context (`PcbSyncPreflightContext.derivation`) is protection per NET instead of per board class: a footprint on a retained net stays protected, everything else may change — safe by construction because all remaining copper passed the proof. This context is never set for an ordinary target.
7. **One atomic commit.** `deriveBoardRevision` writes the derived board (expected revision 0 — must not exist), the child lineage (`current`) and the parent lineage (`superseded`) in one durable commit with a CAS on the parent lineage; a retry with the same idempotency key replays.
8. **Re-run everything before release.** The derived board has NO authority: `/api/pcb/qualify` runs placement / routing / DRC / RC01–RC03 again (component bindings resolve by LINEAGE ROOT id, so the reviewer-approved exact parts carry over without re-binding); `/api/pcb/release` requires that fresh authority. `requalificationRequired: true` on every plan.
9. **Nothing old becomes current again.** A superseded board is refused by synchronization (`PS_BOARD_SUPERSEDED` context issue), derivation (`PS_BOARD_SUPERSEDED` 409), qualification and release (`MFG_BOARD_SUPERSEDED` 409, naming `supersededBy` and `currentBoardId`). `GET /api/pcb-sync?boardId=` carries `lineage { state, supersededBy, currentBoardId, generation, parentBoardId }` so a browser that only knows the root id follows to the current revision.

## In-place "rip up routing" (RECORDED, not provided)

No in-place rip-up command was added. The runbook allows one only as a Tier 2 destructive edit with exact preview, one atomic transaction, complete inverse evidence and explicit confirmation; the derived-revision path already gives an exact preview, one transaction and immutable history, and is never a silent fallback. PROPOSED for B17 if an operator workflow needs it.

## Test matrix (CONFIRMED, `b16-c-board-revision.test.ts`, durable stack: `DurablePcbSyncRepository` + `DurableBoardLineageStore` over `InMemoryDurableWorkflowRepository`)

| change on a routed board | parent refusal | derived outcome |
| --- | --- | --- |
| component add | `PS_STRUCTURAL_ADD_REQUIRES_UNROUTED_BOARD` | kept + added; net copper retained byte-for-byte (1 track, 1 via); new net added; placement carried |
| component remove | `PS_REMOVED_NET_PROTECTED` | removed; its net and copper stripped; the other net's copper retained |
| component replace / footprint change | `PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8` | `footprint_changed`, dropped and re-added with the CURRENT exact authority; its copper stripped |
| pin-map change | `PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8` | `pin_map_changed`, same as above |
| net membership change | `PS_ROUTED_NET_CHANGE_REQUIRES_STAGE8` | that net's copper stripped (proof: endpoint set changed), others retained; membership synchronized on the derived board |
| net rename (same identity) | none needed | copper retained; name updated |
| board outline change | (editor act) | outline replaced explicitly, copper retained, DRC/qualification re-run |
| rules / constraints change | (carry choice) | constraints carried only on request; plan digest differs; requalification required |
| carry copper = false / placement = false | — | everything stripped by the operator's explicit choice, reason recorded per net |

Lineage: chain `board-1` → `board-1@r1` → `board-1@r2`; `resolveCurrent` from any id; superseded parent refuses sync and derivation; idempotent replay; tampered derived board refused (`PS_BOARD_REVISION_PLAN_MISMATCH`), leaving no partial state.

## Not done / bounded (RECORDED)

- Autonomous qualification still re-places and re-routes the whole derived board; carried copper is a starting point for human routing and for future incremental qualification (PROPOSED B19+), not a shortcut around RC02.
- The equivalence proof is per net; it does not prove copper geometry legality against a changed outline or changed rules — DRC/qualification do, and are mandatory.
