# Stage 17 Phase C — via padstacks

## Files

**New:** `app/lib/pcb/padstack/{registry,migrate,defaults}.ts` (types.ts landed
in A), `app/components/pcb/{PadstackPanel.tsx,padstack/PadstackPreviewSvg.tsx,
padstack/PadstackEditor.tsx}`.
**Modified:** `types.ts` (+`board.padstacks?: Padstack[]` — optional/additive),
`edit/{validate,apply,describe}.ts` (four padstack ops live),
`render/copper.ts` (vias render through `resolveVia`), `route-tool.ts` (via
placement uses the active net class's default padstack),
`board-persistence.ts` (`normalizePadstacks` beside `normalizeZones`),
`PcbEditor.tsx` (demo/sync migration + panel wiring), `PcbToolbar.tsx`
(Padstacks button), `inspectors/ViaInspector.tsx` (fork rule),
`inspectors/fields/PadstackField.tsx` (live picker).

## Design decision (load-bearing)

**Denormalize-on-write:** a via with `padstackId` keeps `size`/`drill` equal to
the padstack dims; every mutation path (set-via-padstack, edit-padstack,
migration, route placement) writes both. Geometry consumers (DRC, clearance
guard, KiCad emit, DSN, 3D) stay correct unchanged; `resolveVia` is the
read-through API. Editing a padstack updates all member vias in the SAME
history entry (one undo step — asserted).

`applyEdits` now validates/compiles SEQUENTIALLY against the evolving board
(`compileEdits`), so batch-internal dependencies work — the fork rule pairs
`create-padstack` with a `set-via-padstack` that references the predicted
`nextPadstackId(board)` in one batch = one undo entry.

## Fork rule (pinned UX)

Via dim edits in the inspector are LOCAL by default: they fork
`Custom for <via> [+N]` unless the inline "Also update N other vias using
'<name>'" checkbox is ticked (→ `edit-padstack`). When nothing else uses the
shared padstack, the edit goes in place (forking would only litter).
Padstack Library edits are always global. Delete is blocked with the reason
while `usageCount > 0`. Panel edits auto-commit debounced 500 ms; each flush
is one undo entry.

## Verification gate

- `padstack-registry` 9/9, `padstack-migrate` 6/6, `padstack-usage` 3/3.
- Migration idempotency: `ensureBoardPadstacks` ×2 → deep-equal (asserted).
- Legacy board renders identically: `resolveVia` outputs equal pre/post
  migration for every via (asserted).
- **Export byte-comparison (gate 3): DSN pre/post migration — EXACT string
  equality** (DSN never reads `padstackId`; via candidates stay the
  DEFAULT_CLASSES catalog). **KiCad .kicad_pcb — byte-equal after normalizing
  `(uuid "…")`** (the emitter mints fresh uuids per emit by design; dims,
  layers, nets identical).
- Route tool places class-correct padstacks (via-default for Default-class
  nets, dims denormalized).
- Routed-demo vias are 0.6/0.3 → migration reuses the seeded `via-default`
  (dims-matching reuse asserted; odd dims get `Auto 0.55/0.25`-style entries).
- Full suite: 425 passed / 2 skipped; the only failure across runs was the
  pre-existing Stage 11 zone-pour < 300 ms wall-clock budget flaking under
  full-suite parallelism on a loaded machine (passes in isolation, 640 ms
  total test incl. DRC). `pnpm tsc --noEmit` clean.

## Deviations

- Seeded default dims follow the Stage 17 pin (0.6/0.3, 0.8/0.4, 1.2/0.6),
  NOT Stage 10's `DEFAULT_CLASSES` via dims — freshly routed Default-class
  vias are now 0.6/0.3 instead of 0.8/0.4. Migrated boards are unaffected.
- `board.padstacks` is optional (matches silkItems/netClassing posture);
  spec wrote it non-optional.
- Demo/sync boards bypass board-persistence, so PcbEditor migrates them at
  init (sync results via an immer draft — they share frozen subtrees).
- Padstack panel borrows the DRC panel's slot in the right column while open.
