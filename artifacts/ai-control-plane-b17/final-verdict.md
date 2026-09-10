# B17 — final verdict

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

## Verdict

**B17 PASSES its deterministic gate.** Every runbook pass criterion is met by executed evidence; the live checks that no local resource can exercise are recorded as UNKNOWN / BLOCKED-LIVE-QUALIFICATION (U17-1 … U17-4) and do not block completed deterministic work, exactly as the runbook's final-gate rule provides.

## Pass criteria (runbook "B17 validation and artifacts")

| criterion | evidence | state |
|---|---|---|
| exact registry coverage of all actionable controls | AST inventory 573 controls / 58 surfaces, every control matches exactly one classification rule, inventory equality gate, B01 matrices byte-consistent (`b17-a-control-inventory.test.ts` 1–3, `action-registry.test.ts`) | CONFIRMED |
| no silent or legacy-path buttons | gate 5 (a no-op handler must be `internal`/`unavailable`), gate 4 (no retired route), gate 6 (visible reason for unavailable) — `ui-negative-tripwires.md` §1 | CONFIRMED |
| the required 3D scenario passing through the semantic bus | browser scenario 1: open → hide top silkscreen only → focus J1 → isometric, asserted on bus state and scene visibility; `b17-c-pcb3d-commands.test.ts` pins the acceptance phrase's final state — `3d-command-proof.md` | CONFIRMED |
| UI/keyboard/tool parity tests | every navigation/selection/layer/reveal/3D control issues the bus command (B17-C/D); Ctrl+3 / Escape through the same commands; the agent's six view-session tools map onto the same descriptors and the browser proof drives them through the bridge (scenario 5); `b17-f-agent-exposure.test.ts` §2 asserts `viewCommands` ⊆ registered bus commands — `ui-negative-tripwires.md` §4 | CONFIRMED |
| no engineering mutation from a view command | `b17-negative-tripwires.test.ts` tripwire 1: 49 commands × representative + garbage payloads × 2 actors (518 dispatches, > 150 settled) leave the board and schematic sources byte-identical; tripwire 2: mirrors are human-only; tripwire 3: view-session tools carry no engineering side effect, authority or approval tier | CONFIRMED |
| full suite and generators green | run 2 (bounded workers) on the final tree: 4928 passed / 1 failed / 33 pending of 4962 (the one failure is a PGlite migration-planning case that exceeds its timeout under load and passes alone, 15/15); all eight generators idempotent on the final tree — `test-and-validation-report.md` §2–§3 | CONFIRMED |
| benchmark-quality green | green at every push incl. `81bf3ea` (34430572590); validation commit `f788acd`: deterministic-manufacturing run 34432252639 success (prompt-to-gerber, database-delivery, page-browser-e2e; 2026-09-10 03:09–03:14 UTC) and benchmark-quality run 34432252622 success (benchmark-core; nightly skipped by design) | CONFIRMED |

## What B17 delivered (CONFIRMED, by checkpoint)

- **B17-A** — one action registry re-baselined against the real UI (96 records, precise blockers for every non-implemented record), an AST control inventory with six CI gates.
- **B17-B** — the view-session command bus (`sirkit.view-command.v1`): scoped, non-authoritative, revision-versioned, single-settlement, traced; never engineering state.
- **B17-C** — the 3D view as `pcb3d.*` commands (open/close, presets, fit, reset, focus by component/selection/net, per-layer scene visibility, finish), StrictMode-safe ownership, browser-proven.
- **B17-D** — semantic targets and the versioned selection ("this component" refuses stale or absent selection, never a screen coordinate); `pcb.*` (25), `schematic.*` (12), `workspace.*` (3) commands wired into every entry point (toolbar, palette, context menu, panels, keyboard, tabs); Go to on both canvases; measurement without a dimension; the honest ERC refusal; seven real UI defects found by the browser proofs and fixed.
- **B17-E** — one revision-bound layout candidate for placement and routing across editor, agent and route; preview/apply/discard as one canonical transaction; clear/reroute selected nets and the routed-board revision on B16; the project operation timeline with delegated undo that refuses on divergence; import/export outcome declarations.
- **B17-F** — the one reviewed intentional agent tool set (22): reads, sealed proposals, the two shared layout candidates, six view-session bus-command tools and the view/timeline reads; 37 gates derived from it; contextual discovery by captured surface / board / role; server-validated view commands executed on the user's own bus; the FreeRouting pass executor shared by route and agent.
- **Validation** — the negative tripwires; one real B17-E regression found and fixed (`useAutoPlace.apply` generation check — `test-and-validation-report.md` §2); two pre-existing B16-C.1 test debts resolved.

## What B17 did NOT do (RECORDED)

- No agent executes an engineering operation: the agent reads, proposes (sealed artifacts / layout candidates) and drives the VIEW. Execution of reversible operations is B18.
- No live provider turn, no live auth, no live routing in CI, no database-backed suites (U17-1 … U17-4).
- No MCP surface, no multi-agent, no catalog/purchasing/firmware work.

## Integration

- PR #7 `chapter/b17-semantic-editor` → `main`, base `82ecbf8`; every commit authored by Dandi Desta, no AI co-author trailers; staged-content secret scan before every push; no force-push, no history rewrite.
- Merge normally after green CI on the validation commit (D17-1 / OD-8), fast-forward `main`, update the program ledger, continue to B18.
