# B17-E — Project history model (operation timeline) and import/export outcomes

Labels: CONFIRMED = executed and measured on this machine; INFERRED = derived from code reading; PROPOSED = designed, not exercised; RECORDED = written down without a claim.

## Two authoritative histories, one timeline (CONFIRMED)

The schematic keeps a snapshot-based `SchematicHistory` (undo through the B07.2 coordinator's transactional reconcile-then-move); the PCB keeps the patch-based canonical `PcbHistory` behind the B08 executor (verified durable replay). Neither is replaced. `app/lib/project/operation-timeline.ts` adds the PROJECT OPERATION TIMELINE:

- one ordered, bounded (500) record of operations from both stores — `commit`, `undo`, `redo`, `hydrate`, `restore` — each with the store, label, actor, the store's own references (canonical transaction id, entry id) and a **head fingerprint** taken right after the operation (schematic: entry count + digest of the entry stack; PCB: canonical lineage id + head sequence + entry count);
- the page records every schematic history publication (`publishSchematicHistory`: commit, deferred commit, undo/redo cursor, hydration, adoption restore); the PCB editor records every canonical commit / undo / redo of the bound history and a `hydrate` when a history is bound;
- each store LENDS the timeline its own undo and its current head (`bindStore`) while its editor is open;
- **project-level undo** (`Revision history → Undo latest`, `data-testid="project-timeline-undo"`) calls `undoLatest()`: it identifies the latest ELIGIBLE operation — the newest entry whose store's current head equals the recorded head — and runs THAT store's own undo. It refuses, naming the store, when the store is not open or its history moved on without the timeline seeing it (`DIVERGED_SCHEMATIC` / `DIVERGED_PCB`: hydration, a checkpoint restore, a lifecycle replacement), and when the newest entry is not a commit (`NOT_UNDOABLE`: an undo, a hydration, a restore). Nothing is ever undone across both stores at once — no cross-store atomicity is claimed or faked.

Tests: `app/lib/project/__tests__/b17-e-operation-timeline.test.ts` (3): ordering/bounds/observability and head equality; eligibility and every refusal; delegated undo to the bound store only (an unbound PCB store never falls back to the schematic's undo).

Registry: `project.operation-timeline` (new, implemented), `project.undo-redo` re-described ("two authoritative histories coordinated by the project operation timeline"). Control: the dialog's Undo latest → `undoLatestProjectOperation`.

## Import / export outcomes (CONFIRMED)

`app/lib/project/io-outcome.ts` declares, for every import/export path, what it PRODUCES — `canonical-state`, `inert-proposal` or `file-artifact` — what it validates before creating or emitting anything, and how the outcome is reported; an unavailable path names its precise blocker. `app/lib/project/__tests__/b17-e-io-outcomes.test.ts` pins the declarations to existing registry records and checks that every import/export record is declared.

| path | produces | validation | reported as |
|---|---|---|---|
| schematic KiCad export | file artifact | read-only export of validated state (the route's fail-closed integrity validation) | the download; a refused export is now a structured toast naming `SCHEMATIC_STATE_INVALID` and the sanitized issues (was a raw `alert`) |
| schematic KiCad import | canonical state (when it exists) | structural + semantic | **unavailable**: no `.kicad_sch` import path exists (no control, no route); the only reader answers `CD8_KICAD_SEMANTIC_ADAPTER_NOT_CERTIFIED` — `schematic.import-export-kicad` stays `partial` with this precise blocker |
| PCB KiCad export | file artifact | read-only export gated on a verified authoritative board | the download; unsupported content (`X-Sirkit-Export-Unsupported`) is reported as a toast from BOTH entry points now (the palette dropped it) |
| autoroute import | canonical state | structural + semantic (DSN preflight, SES parse, boundary checks, revision/provenance) | a reviewed routing candidate; one canonical transaction on apply |
| project file open | canonical state | structural + integrity digest + schematic validation | the announcement now names restored checkpoints, "imported as a copy", missing catalog parts and the warning count |
| project file save | file artifact | — | the `.sirkit.json` download with an integrity digest |
| engineering / gerber export | file artifact | readiness + waiver | the fab dialog report id |
| bare-board release | canonical (durable) state | the B16 release gate | the manufacturing panel + stage evidence |

Imported content is untrusted until the path's structural and semantic validation passed; the declarations say which.

## Registry closure (CONFIRMED)

After B17-E the non-implemented records are exactly: `schematic.import-export-kicad` (partial — no `.kicad_sch` import path, above), `full-flow.run` and `project.engineering-effects` (api-only by design, precise), `placement.preview-api` (api-only by design: the shared candidate's server producer for tools), `manufacturing.assembled-release` (missing — assembled-product release is out of scope until the component-acquisition and assembly chapters B22–B24). `placement.auto` and `routing.autoroute` are implemented on the shared candidate.
