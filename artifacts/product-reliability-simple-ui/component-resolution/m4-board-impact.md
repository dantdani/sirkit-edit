# M.4 / M.5 item 7: replacing a part on a project that already has a durable PCB

[PR-L6, 2026-10-19] OD-253 item 8. Branch `codex/astra-foundation`.

## What the owner gets

- **Before approval.** The review dialog shows a **PCB impact** section. It is assessed against the project's **durable** board. That is
  the board the preflight, qualification and release read; it is never the browser working copy. The board is read through the
  existing `GET /api/pcb-sync?boardId&include=manufacturing`; no route was added.
  - Each part gets a row: its board reference, the outcome, each pin with its net, pads and copper, the placement, the predicted
    Prepare PCB operation and its blocker codes, and whether the part must be re-bound.
  - The outcome uses the board-revision vocabulary: `not-on-board`, `unchanged`, `footprint_changed`, `pin_map_changed` or
    `symbol_changed`.
  - The dialog also lists what goes stale: placement legality, DRC, routing, the qualification authority, the latest release and the
    local stage evidence.
  - **Approve stays disabled, with a visible reason, while the impact is loading or cannot be read.** This fails closed. Discard stays
    enabled.
- **At Approve.** The controller re-reads the basis and recomputes the impact digest. The digest covers the board revision and digest,
  the authority head and the latest release.
  - If the digest moved, the controller refuses with `board-impact-changed`.
  - If the basis cannot be read, or the impact was never assessed, it refuses with `board-impact-unavailable`.
  - In both cases the refusal comes before the one-shot intent and before the fresh-facts endpoint. Nothing is changed.
  - The page keeps the batch open and reads the impact again.
- **In the receipt.** `sirkit.approved-resolution-receipt.v2` carries `boardImpact`:
  - the bounded summary (at most 20 items, 6 codes each, strings of at most 128 characters);
  - `not-recorded` on the crash-reconstruct path;
  - `not-assessed` when no impact was supplied.

  A persisted v1 receipt still validates. The journal checks every level of `boardImpact` with closed key sets, so a tampered or
  oversized value makes the entry `corrupt`; it is never trimmed. The committed run-log line and the receipt notice state the impact.
- **After apply, derived from facts.** `boardSchematicDrift(schematic, durable board)` (`app/lib/pcb-sync/schematic-drift.ts`) compares
  each instance's exact identity with the footprint's `syncIdentity`, keyed by the stable instance id. It reports four kinds: changed,
  unresolved, missing-from-board and removed-from-schematic. The PCB editor derives these from it:
  - a plain-text notice beside the route-stale notice (it takes no clicks and sits below the action panels);
  - the journey fact `boardBehindSchematic`: PCB applied becomes partial, nothing downstream succeeds, and the next action is Prepare
    PCB;
  - the journey's Prepare PCB runs the toolbar button's preparation for a board behind the schematic (before, it ran only when no board
    existed); applying the plan stays a click;
  - in-page refusals in `handleQualify` and `performVerifiedRelease`;
  - the manufacturing panel's own **Request release** and **Authorize release** are disabled with the same reason.

  Undo, Redo, a reload and a later Prepare PCB recompute it. There is no sticky flag, and no gate reads a receipt.

## Defects found and fixed in this increment

Each one has a permanent test that fails without the fix.

1. **Release bypassed the gate.** The manufacturing panel's Request release calls `workflow.requestRelease` directly and never passed
   through `performVerifiedRelease`. It is now disabled with the drift as its reason, and so is Authorize release
   (`m4-manufacturing-gate` 6).
2. **The journey's Prepare PCB did nothing on an existing board.** It ran only while no board existed, so the one next action offered for
   a board behind the schematic was a silent no-op (`m4-manufacturing-gate` 7; e2e step 3).
3. **The notice covered a control.** At 1366 px the centred notice covered the Missing parts list's "Find a replacement in the library".
   It now takes no pointer events and sits below the action panels (`m4-manufacturing-gate` 4; e2e step 3).
4. **Undo broke the next resolution until a reload.** The page's undo history does not hold the sheet size, so its undo target never
   matched the canonical transaction it undoes. The session rebased its lineage onto a sheet without a size, and the next "Find a
   replacement" was refused: "does not sit at the claimed canonical head". `historyStepState` keeps the authoritative sheet size, so the
   undo and redo are replayed canonically on the same lineage (`m4-reresolve-after-undo`; e2e steps 2 to 5).

## Domain guard (written and passing before the gates were wired)

`m4-schematic-drift` cases 6 and 7 take a board synchronized by the real `PcbSynchronizationService`. The board goes through the real
routes: reviewer bindings, publish, preflight and apply. Two schematics were synchronized:

- the fixture blinker (the prompt-to-Gerber design, 9 parts);
- the LED dimmer with D1 / D2 resolved to the fixture's eligible revision.

Both boards have **zero drift** right after apply. The identity domains agree field by field: footprint version, mapping certificate and
symbol version. The prompt-to-Gerber browser proof (qualify, release, download) passes with the gates on.

## The impact agrees with the real Prepare PCB (`m4-board-impact-agrees-with-preflight`, durable stack)

| case | predicted | real preflight |
|---|---|---|
| unrouted board, another revision (same pin numbers) | `replace_unrouted_footprint` for D1 / D2, no blocker | the plan's operations for D1 / D2 are `replace_unrouted_footprint`; it applies, and the drift is gone |
| routed board, another revision | `PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8` (Stage 8) | the same cause codes; `previewBoardRevision` gives the same component outcomes and the same stripped nets, tracks and vias; the derived `<root>@r1` has no authority, and the basis loader follows the root to it |
| proved pin permutation, unrouted | `PS_REMOVED_NET_RECONCILIATION_REQUIRED` | the same code |
| proved pin permutation, routed | `PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8` and `PS_REMOVED_NET_PROTECTED` | the same codes |

The preflight's two summary gates (`PS_ALL_COMPONENTS_TRANSFER_READY` and `PS_ALL_NETS_TRANSFER_READY`) restate that an item is blocked.
The comparison sets them aside.

A net's stable id is derived from its endpoint set, so a permutation re-identifies the nets it touches. The board's old net becomes a
**removed** net. The scout map expected `PS_ROUTED_NET_CHANGE_REQUIRES_STAGE8` here; the real preflight never raises it for
endpoint-derived ids.

`m2-7-existing-board-acquired-binding` runs an M2-acquired revision (DO-35, through-hole) against a board that carries D1 / D2 as SOD-123.
It goes through the same impact (`footprint_changed`, `replace_unrouted_footprint`), the receipt v2 and the drift path, with Undo,
Redo and a save / reload.

## Findings recorded open (not fixed here)

1. **A re-resolved part that is already bound on the board cannot be carried to the board from the page.** A reviewer's bind of the new
   revision is refused while the earlier binding is in effect: `PB_ACTIVE_SELECTION_CONFLICT`, the B19-E rule, pinned by
   `b19-e-successor-*`. Bindings are per board lineage, so a derived revision does not avoid it.
   - The only way through today is API-only: a reviewer supersedes the old binding with the generic `transition` operation, then binds
     the new revision. The durable suite does exactly that.
   - The dialog discloses it per row ("re-binding needed … refused while that binding is in effect").
   - Until it is resolved, the board stays behind and qualify and release stay refused. Undo restores the bound part.
   - Owner decision needed: a reviewed binding replacement when the schematic instance's exact revision changed.
2. **A net-membership change on an existing board blocks Prepare PCB.** A pin permutation, or adding a connected part, raises
   `PS_REMOVED_NET_RECONCILIATION_REQUIRED` on an unrouted board, and no `remove_unrouted_net` operation is ever planned. This is
   existing Stage 3 behavior. The impact predicts it truthfully.
3. **The server-side schematic-currency guard on qualify and release is not built.** That is OD-253 item 8's default. The gate is
   client-side; an administrator could still POST `/api/pcb/release` directly.
4. **The B14 exact-replacement dialog does not consume `assessResolutionBoardImpact` yet.** Its controller, service and receipt (a
   closed journal key set of its own) would all need the same binding, so it does not stay contained. The fact-derived drift already
   covers B14 replacements after apply.
5. **Fixture clock and batch identity.** Under the frozen fixture clock, a batch re-sealed on exactly the head a reload re-derives
   (the same genesis) is byte-identical to one applied and undone before it. The journal then refuses it as that earlier commit ("The
   journal records a commit the canonical history does not contain"). A real clock gives every sealed batch its own identity, so this
   is a property of the fixture. The browser proof re-resolves before the reload.

## Browser proof

`e2e/m4-existing-board-resolution.spec.ts` uses the fixture runtime and an unrouted board:

1. resolve D1 / D2 (the impact says there is no PCB yet), then Prepare PCB through the binding review (the reviewer acts by switching
   the role cookie, without a reload), then apply; the fresh board is not behind;
2. **Undo** leaves D1 / D2 unresolved on the board: the notice shows, PCB applied is partial with Prepare PCB next, and Qualify & route
   is refused in the page with no request sent;
3. the journey's **Prepare PCB** refuses D1 / D2 by name; Find a replacement opens the dialog with the PCB impact rows (unchanged,
   preserve) against the durable board;
4. **Approve**: the receipt carries the impact, the notice is gone and the journey is back at Qualify & route;
5. **Undo** shows the notice again, **Redo** clears it, Undo shows it, and a **reload** recomputes it.

A replacement by **another** revision cannot reach the board from the page (open finding 1), so the browser proof re-resolves to the
bound revision. The durable suite proves the other-revision path at the API level.

Screenshots: `screenshots/m4-board-behind-schematic-1366x768.png` and `screenshots/m4-board-impact-review-1366x768.png`.
