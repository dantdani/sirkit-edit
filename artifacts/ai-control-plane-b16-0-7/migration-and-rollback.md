# B16.0.7 — Migration & rollback

## Status (honest)

| Deliverable | Status |
|---|---|
| R1–R11 analyzer/flow-gate closures + permanent tests | **DONE** |
| Wrapper-adoption classifier + structural gate + negative tripwire | **DONE** (inventory/tripwire mode) |
| `route-wrapper-matrix.csv` inventory | **DONE** (0/153 adopted, byte-stable ×2) |
| Migrate all `app/api` methods to canonical wrappers | **NOT DONE** — 0 / 153 |
| New wrapper variants (streaming JSON, public streaming, non-JSON bounded, selector envelope) | **NOT DONE** |
| Header-selector migration for body-scope routes (§C) | **NOT DONE** |
| Hard structural adoption gate (all protected/body methods = wrapper) | **NOT ENABLED** (would fail until migration lands) |
| Type-checker Request-confinement gate (§E) | **NOT DONE** (AST/flow gate enforces the route surface today) |
| §F full wrapper behavioral matrix (wrong role / revoked / foreign / CSRF / deadline-once) per variant | **PARTIAL** (existing `authenticatedJsonRoute` behavior proven; new variants pending) |

**B16.0.7 is therefore NOT COMPLETE.** The stop condition (ordinary
protected/body routes cannot express handwritten auth or raw Request handling at
all) is not met while 150 raw handlers remain.

## Migration plan (per family, ordered by risk)

For each route method in [route-wrapper-matrix.csv](route-wrapper-matrix.csv)
with `migration_status = PENDING_MIGRATION`:

1. Choose the target wrapper (the CSV's `target_wrapper` column).
2. Move the handler's post-authorization business logic into the callback,
   replacing `authorized.context`/`scope` with the callback `context`, the parsed
   `read.body`/`parsed` with `body`, and any `request.url`/query parsing with
   `meta.searchParams`.
3. Delete the handwritten `authorizeRequest`/`scopedTrustedJson` +
   `readBoundedJsonObject` boilerplate.
4. Run the route's family tests; adapt only assertion STRINGS to the wrapper's
   refusal contract (never status codes; never skip).
5. Re-run the adoption gate — the route's form flips to `canonical-wrapper`.

Families (from the inventory): architecture, interfaces, power, schematic,
pcb/*, spice/*, requirements, bom/*, calculation, circuit-knowledge,
circuit-verification, component-selection, firmware-bringup, footprint-resolution,
full-flow, mapping-verification, model-simulation, pcb-sync, physical-bindings,
release-engineering, schematic-compiler, assignment-queue, replacement-authority,
chat, parts/*, kicad/*, constraints/*, export/*, engineering-effects,
components/*, auth/*.

New wrappers needed BEFORE migrating their routes: `authenticatedStreamingJsonRoute`
(chat), `selectorEnvelopeRoute` (replacement-authority two-phase selector),
`boundedNonJsonRoute` (any non-JSON body), `publicStreamingInputRoute`.

## Rollback

All B16.0.7 changes are confined to the TEST-ONLY analyzer
(`_boundary-analysis.ts`), two new test files, and one generator — no production
route or runtime module was modified. Reverting those files restores the exact
B16.0.6 behavior; the full suite baseline is unchanged (3366 pass). Because no
route migration was applied, there is nothing to roll back on the runtime side.
