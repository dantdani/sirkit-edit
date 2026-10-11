# B20-B4 — no proposal over MCP: the withholding move, the evidence behind it, and the process gate

Labels: **CONFIRMED** (executed and measured, or read in the code on 2026-09-21), **INFERRED** (a conclusion from reading),
**RECORDED** (written down without a claim), **UNKNOWN**.

B4 was planned to serve Sirkit's inert proposals over MCP. Its first dispatch stopped at its timing probe (section 3), and
the lead decided (the OD-87 default): **B20 serves no proposal over MCP.** All five proposals move from
`INTENTIONAL_MCP_EXPOSED_TOOL_IDS` to `MCP_WITHHELD_TOOL_IDS` (`app/lib/engineering/mcp-exposure-review.ts`) by one reviewed
ratchet move, each with its reason; the structural rule (`mcp-exposure.ts`), the registry and every descriptor are
unchanged (registry digest `eng1-4aacd63c7e0a6193`, as on the base 4299067), so only the two lists, the MCP tool manifest and
the pages moved.
The MCP subset is 9 tools: the 9 served reads; 8 tools are withheld: 2 reads and the 5 proposals, and B24-D2's 1 paged board read ([B24-D2, 2026-10-09] 7 until B24-D2 withheld its paged board read by choice, OD-235; its row is in section 14, appended so no line of this page moved).
MCP exposure in B20 is read-only. Closes D20-34's placement half and UNKNOWN 4; defers D20-8 by owner decision (not
closed); D20-10's proposal half does not apply in B20. The propose delegation, the returned projection, the proposal
pool, windows, replay and trace designed for B4 (OD-50's projection, OD-83 to OD-86, OD-88) are NOT built; their design is
kept for a reversal (section 9).

## 1. Served and withheld — CONFIRMED (suite `b20-b4-withhold-proposals`, cases 1 to 5)

| tool | class | MCP | increment | decision | reason |
|---|---|---|---|---|---|
| `sirkit.component-authority.inspect` | read | served | B3 | — | served from the durable server board (`mcp-server-reads.md`) |
| `sirkit.manufacturing.readiness-inspect` | read | served | B3 | — | served from the durable server board; a report, never a release |
| `sirkit.pcb.board-inspect` | read | served | B3 | — | served from the durable server board |
| `sirkit.pcb.mechanical-inspect` | read | served | B3 | — | served from the durable server board |
| `sirkit.pcb.revision-inspect` | read | served | B3 | — | served from the durable server board (no pin needed) |
| `sirkit.pcb.via-inspect` | read | served | B3 | — | served from the durable server board |
| `sirkit.project.canonical-revision-inspect` | read | served | B3 | — | served from the durable server board (no pin needed) |
| `sirkit.validation.connectivity-verify` | read | served | B3 | — | served from the durable server board |
| `sirkit.validation.drc-run` | read | served | B3 | — | served from the durable server board |
| `sirkit.project.history-inspect` | read | withheld | B3 | OD-69 | bound to the browser's captured project timeline; no durable history source |
| `sirkit.schematic.inspect` | read | withheld | B3 | OD-69 | the editor's `SchematicState` lives in browser storage; no durable table holds it |
| `sirkit.schematic.propose-tier1-edit` | propose | withheld | B4 | OD-82 | compiles against the editor's `SchematicState` and head mark, which are browser-only (as B3's OD-69) |
| `sirkit.schematic.propose-component-replacement` | propose | withheld | B4 | OD-82 | compiles against the editor's `SchematicState` and head mark, which are browser-only (as B3's OD-69) |
| `sirkit.pcb.propose-bounded-edit` | propose | withheld | B4 | OD-82 | seals the open editor's history head, lineage and DRC preset; no durable source holds them, and apply re-verifies them against the live editor |
| `sirkit.routing.propose` | propose | withheld | B4 | OD-82 | its engine is the FreeRouting child process; an MCP call may not start a process |
| `sirkit.placement.propose` | propose | withheld | B4 | OD-87 | its engine blocks the event loop and cannot be stopped inside a spec (sections 3 and 4); served only once a bounded engine host with kill semantics exists |

What the move changes on the wire (CONFIRMED):
- `tools/list` for every role lists reads only (case 3): the viewer, the reviewer, the editor and the admin see the nine
  reads, the commenter the seven its role permits; the `mcp` discovery channel under the most permissive context includes
  exactly the nine and excludes each proposal as `not_mcp_exposed`.
- A `tools/call` naming any of the five proposals, even by a project admin whose role would permit every one natively, is
  B2's one identical `-32602`: the same bytes as a nonexistent id's answer, echoing nothing, traced `unknown_tool`, with no
  durable read (case 4; B3's suites H case 8 and C case 14 moved to say so).
- The five descriptors are still agent-exposed inert proposals the structural rule admits (case 2): the reviewed decision
  alone withholds them, and the agent path is unchanged (the agent set of 32 and its digest equal the base pins).

The reasons, read in the code on 4299067: the schematic proposals take the editor's state as their input type (C28, C29);
the bounded edit is re-verified against the live editor's history head at apply (C27); routing runs the FreeRouting child
process (C30, C31); placement is section 3 and 4.

## 2. What B4 builds instead

- **The move** in `app/lib/engineering/mcp-exposure-review.ts`, one reason comment per withheld id, and the reworded
  comments that counted "the 5 inert proposals" or said a proposal is "listed until B4" (`mcp-exposure-review.ts`,
  `mcp-exposure.ts`, `app/lib/mcp/server/dispatch.ts`, `app/api/mcp/route.ts`).
- **Listed means served** (section 7) and **the process gate** (section 6).
- **The regenerated manifest** `mcp-tool-manifest.csv` and `.json` (9 exposed rows; 7 rows `withheld`), and the pages
  `mcp-exposure.md`, `mcp-server-reads.md` and `mcp-server-endpoint.md` amended with `[B20 B4]` notes.

## 3. The timing probe — CONFIRMED by measurement, on a synthetic board only

Measured on 2026-09-21 by B4's first dispatch, on an Intel Core Ultra 5 125U (14 threads), 15 GiB, Node v24.15.0, one heavy
job at a time (the probe scripts and logs are in the session scratchpad, never in the repository: logs `b4-0*` and `b4f-*`).
Every run used `candidateCount` 8 and `timeoutMs` 15 000. Rows P1 to P10 called `runPlacementCandidate`, the producer the
native agent path and the preview route use, synchronously; P11 and P12 (the abort probe, section 4) called
`runEngineeringPlacement` directly, with the options `placementRunOptions` builds and an observer.

**The probe board and its confounds.** Built with the b17-e fixture helpers: one footprint in five is a 32-pad IC (12 × 18 mm
courtyard), the rest 2-pad chips, on a 25-column grid at a 14 mm pitch, with 200 nets at every size; the routed variant adds
300 tracks and a copper zone. Because the net count is fixed, pads per used net grow with the footprint count (1.35 at 25,
2 at 50, 4 at 100, 10 at 250, 20 at 500); at 25 footprints only 48 of 148 used nets have two or more pads. The IC courtyards
overlap only at 250 and 500 footprints (25 and 75 pairs), never at 100 or fewer. The footprint series is one pseudo-random
netlist, not a size sweep. **Every number below is specific to this synthetic board; real boards are UNKNOWN** (no real board
could be loaded without PGlite).

| row | footprints | iterations | variant | runs | each run (ms) | median (ms) | max (ms) | log |
|---|---|---|---|---|---|---|---|---|
| P1 | 250 | 400 | unrouted | 5 | 86167, 89922, 86214, 91041, 98704 | 89922 | 98704 | `b4-06` |
| P2 | 250 | 400 | routed | 5 | 81069, 92906, 98975, 91967, 104049 | 92906 | 104049 | `b4-07` |
| P3 | 250 | 400 | unrouted | 1 | 44300 | 44300 | 44300 | `b4-04` |
| P4 | 250 | 400 | routed | 1 | 47361 | 47361 | 47361 | `b4-04` |
| P5 | 250 | 1 | unrouted | 1 | 55679 | 55679 | 55679 | `b4-08` |
| P6 | 25 | 400 | unrouted | 5 | 16219, 16090, 15969, 16048, 15743 | 16048 | 16219 | `b4f-03` |
| P7 | 25 | 400 | routed | 5 | 15977, 16103, 15442, 15324, 15312 | 15442 | 16103 | `b4f-03` |
| P8 | 25 | 400 | unrouted | 1 | 14596 | 14596 | 14596 | `b4-05` |
| P9 | 50 | 400 | unrouted | 1 | 28165 | 28165 | 28165 | `b4-05` |
| P10 | 100 | 400 | unrouted | 1 | 262261 | 262261 | 262261 | `b4-05` |
| P11 | 25 | 400 | unrouted | 1 | 16556 | 16556 | 16556 | `b4f-06` |
| P12 | 50 | 400 | unrouted | 1 | 43339 | 43339 | 43339 | `b4f-06` |

Rows P1 to P7 time the `runPlacementCandidate` call; P8 to P10 (the breakdown probe) also include the candidate's
intactness check and its serialization, at most 146 ms of each value; P11 and P12 time the engine call alone. P12 was
cancelled by the probe at its second budget poll (section 4), so its value is the time to the cancellation, at least
42 990 ms of it inside the first spec.

At the floor (400 iterations, 250 footprints) 12 runs took 44.3 to 104.0 s; 1 run at 1 iteration took 55.7 s; 12 runs at 25 footprints took at most 16.6 s; 2 runs at 50 footprints took 28.2 to 43.3 s.

[B20 B4 review] coverage-1: the first B4 record left the abort probe's two runs out of this table although they ran at its
settings, and so counted 11 runs at 25 footprints (at most 16.2 s) and one at 50 (28.2 s); the lead's decision text counted
10 at 25 footprints (the `b4f-03` runs alone). With them: 12 runs at 25 footprints, at most 16.6 s, and 2 at 50 footprints,
28.2 and 43.3 s. No conclusion changes: 25 footprints stayed under 20 s, and placement stays withheld.

- **At and above the floor no cap kept the synchronous section at or under 20 s.** Every run at 250 footprints ended
  `best_known_budget_exhausted` with one candidate: the first spec alone ran 44 to 104 s, and the budget is checked only
  between specs (section 4).
- **An iteration cap cannot bound it.** The first spec is the current-placement seed (C9); `maxIterations` is read only by
  the force initializer (C11), so 1 iteration took 55.7 s (P5), and stop-evidence case 5 proves the first spec identical at 1
  and 2 000 iterations.
- **The time is the first spec's evaluation and its local refinement** (`b4f-04*`, `timeoutMs` 1 000): at 50 footprints the
  first spec took 0.3 s with no refinement pass and 39.8 s with one; at 100 footprints 2.1 s with no pass; at 250 footprints
  one evaluation with no pass took 60.9 s. Refinement re-evaluates the whole candidate up to 16 × 4 times per pass (C4 to C6).
  Run-to-run variance on this machine is large (50 footprints: 28.2 s in P9 and 43.3 s in P12; one refinement pass took
  39.8 s in `b4f-04c` and the preview route 40.9 s in `b4f-05`, both at `timeoutMs` 1 000).
- **A footprint cap bounded it on this board only far below the floor**: 25 footprints stayed at or under 16.6 s over 12
  runs (P6 to P8 and P11), where the 15 s budget stops between short specs; 50 footprints took 28.2 and 43.3 s (P9, and
  P12 to its cancellation), and 100 footprints 262.3 s in one run (P10).
- **A budget shorter than the problem build runs no spec** (`timeoutMs` 50 at 50 and 100 footprints, `b4f-04a` and `b4f-04b`;
  stop-evidence case 4).
- At 2 000 iterations and 500 footprints no run finished within 11 minutes; the probe processes were stopped by PID (`b4-03`).
- **Size.** The raw sealed placement candidate measured 2 233 630 to 3 869 953 characters (25 to 250 footprints), above
  B05's 1 000 000-character output anchor; the largest board measured through the engine is 511 596 characters (250
  footprints, routed).

## 4. D20-34, the placement half — CONFIRMED by measurement and by test

- **Budget.** The time budget and the cancellation hook are checked only BETWEEN candidate specs: `checkBudget` polls the
  observer's `shouldCancel` and reads the clock (C1, C2), and the engine calls it once per spec, before the spec starts
  (C10); `localRefine` has no poll (C3 to C6). So 15 000 ms (the probe), 110 000 ms (the native agent path's clamp, C14) and
  120 000 ms (the engine's own clamp, C7) are between-spec budgets, not bounds: one spec measured 262 s at `timeoutMs`
  15 000 (P10). By test (`b20-b4-stop-evidence`): case 3 (a spec that runs 600 s on a faked clock completes and is kept),
  case 4 (a budget shorter than the problem build runs no spec), case 5 (an iteration cap cannot shorten the first spec).
- **Abort.** Measured with the engine called directly with an observer (`b4f-06`, rows P11 and P12): at 25 footprints an
  abort timer set for 100 ms fired at 16 557 ms, after the engine had returned at 16 556 ms, and all 8 polls read false; at
  50 footprints an abort raised 350 ms into the first spec was seen only at the second poll, 42 990 ms later (43 339 ms in
  all). By test: case 1 (an abort raised inside a spec is
  seen only at the next poll, and the rest of the spec still runs) and case 2 (an abort delivered by a timer is never seen
  while the engine runs).
- **No observer reaches the engine on the shared producer:** `runPlacementCandidate` calls the engine without one (C13;
  case 7), so no abort reaches it on the native or the preview path.
- **Over MCP nothing acts on a late result:** no proposal is served in B20.

## 5. UNKNOWN 4 — resolved: no proposal is persisted server-side (CONFIRMED, re-verified on 4299067)

- **No producer reaches a store.** The runtime import closures (the edges of `_import-closure.ts`) of the five producer
  modules reach no database, durable-workflow, pcb-sync durable or lineage module, Supabase or Postgres adapter, or outbound
  fetch: `engineering/schematic-proposals.ts` (13 files), `engineering/replacement-proposals.ts` (14),
  `pcb/proposal/pcb-edit-proposal-service.ts` (74), `agent/layout-proposals.ts` (132), `pcb/candidates/layout-candidate.ts`
  (120), 143 files together (scratchpad probe `u4-store-probe`, log `b4w-01`). A broad scan of the same closure for any path
  naming a store, repository, database, durable, persistence, network or fetch found one module only,
  `engineering/persistence.ts`, a pure envelope module that imports `stable` and `types`, reached through the commit gateway
  (log `b4w-02`).
- **The commit gateway is apply-only.** `layout-candidate.ts` imports `commitPcbCandidate` (C21) and calls it three times,
  all in the human apply paths over the editor's in-memory history: `applyLayoutCandidate` for placement (C22) and for
  routing (C23), and `clearNets` (C24). (B4's design text named two call sites; there are three, all apply paths.)
- **No table holds a proposal.** `app/lib/db/schema.ts` has no match for
  `tier1|pcb_edit|layout_cand|replacement_prop|sealed|proposal`.
- **Retention is in the browser only.** `LayoutCandidateStore` is a bounded in-memory registry (C25), one per PCB editor
  mount (C26); a sealed proposal reaches a human only as a run-stream event of the chat route.

## 6. The process gate (follow-up F4) — CONFIRMED (suite `b20-b4-process-gate`)

Over the runtime import closure of the three MCP routes (`POST /api/mcp`, `POST /api/mcp/token` and
`GET /.well-known/oauth-protected-resource/api/mcp`; 232 files on 4299067, 243 from every module of the MCP tree), no
first-party module is reached that
- references a process or thread module (`child_process`, `worker_threads`, `cluster`), `vm`, or ([B20 B4 lead]) `module`
  (it mints a `require`), with or without `node:`, by
  a reference the AST gate extracts (import, re-export, `require` and its loader aliases, dynamic import); a type-only import
  is erased and does not count;
- [B20 B4 review] loads a built-in by name without such a reference: `getBuiltinModule` under any static spelling (a member
  name concatenated from string pieces included; a static module name counts as that module, and any other use, such as a
  computed module name or a destructured alias, fails closed), `binding` of `process`, or `_linkedBinding` / `dlopen` of
  anything; or compiles code from a string (`eval`, the `Function` constructor, also through `.call`, `.apply` or `.bind`);
  [B20 B4 lead] a name spelled with an escape (`\u`, `\x`) is read as the name, and a computed key that statically
  spells a loader name (a destructuring key or an object key) fails closed;
- [B20 B4 review] imports a third-party package specifier outside the reviewed list (case 5): `@supabase/ssr`,
  `drizzle-orm`, `drizzle-orm/pg-core`, `drizzle-orm/postgres-js`, `drizzle-orm/supabase`, `flatbush`, `immer`, `openai`,
  `polygon-clipping` and `postgres`.

So none of the app's five process spawners is reached: the simulate route, the SPICE model smoke test, the autoroute runner,
the kicad-cli runner and the SPICE worker. [superseded 2026-10-02 by the B22 closeout (D22-16, OD-139): the gate's list is now the diagnostic runner, FreeRouting's and kicad-cli's runners and the engine host with its worker entry (B22-A3 OD-136, B22-B OD-140); none is reached] The tripwire (case 3) catches, with its chain, a probe reached from the endpoint
route that imports a process module directly, by re-export, through a hop, by `require`, by a dynamic import, as `cluster`,
or by importing an app spawner, and each spelling the review named or implied: `process.getBuiltinModule`,
`globalThis.process.getBuiltinModule`, `process["getBuiltinModule"]`, a concatenated member name (with a static and with a
computed module name), a destructured `getBuiltinModule`, a computed module name, `process.binding` (also by a concatenated
name), `process.dlopen`, `dlopen` on an alias of `process`, `eval`, `eval` as a concatenated member of `globalThis`,
`new Function`, `node:vm`, an unreviewed package (`execa`) and an unreviewed subpath of a reviewed one
(`openai/helpers/audio`); and ([B20 B4 lead]) `process` and `getBuiltinModule` spelled with unicode escapes, `eval` spelled
with one, `process` and `getBuiltinModule` as hex-escaped member names, `getBuiltinModule("module")` then `createRequire` by
element access, an imported `node:module`, a concatenated computed destructuring key for `getBuiltinModule` and for `eval`,
and `Function.call` and `Function.apply`. A static non-process built-in (`node:fs`) and a property merely named
`binding` are not caught.

The reviewed list is RECORDED by review on 2026-09-21, not proven by the gate: in the installed versions (`@supabase/ssr`
0.12.4, `drizzle-orm` 0.45.2, `flatbush` 4.6.2, `immer` 10.2.0, `openai` 6.48.0, `polygon-clipping` 0.15.7, `postgres` 3.4.9)
and their runtime dependencies (`cookie` 1.1.1, `flatqueue` 3.1.0, `robust-predicates` 3.0.3, `splaytree` 3.2.3) no file
names `child_process`, `worker_threads`, `cluster`, `vm` or `getBuiltinModule`, except `openai/helpers/audio`, which spawns
ffmpeg and which the closure does not import.

Not analysed: the code inside the reviewed packages (their specifiers are pinned; the packages are not walked); a member
name computed at run time (such as `globalThis[name]`); `binding`, `eval` or `Function` reached through an alias of
`process`, of a global object or of `Function`; and reflection (`Reflect`, property descriptors). [B20 B4 review] The first B4
text claimed a probe was caught whatever runtime spelling it used; the gate saw only first-party module references, so
`process.getBuiltinModule("node:child_process")` or a spawning package passed it (regressions-1, security-1). [B20 B4 lead]
The independent check then found three spellings the review's gate still missed - names written with escapes (its text
prefilter skipped such a file), `module` as a loader, and a computed destructuring key or `Function.call` / `.apply` - each
now caught and pinned by a probe, each fix shown by reverting it (the probes fail). The gate is a tripwire against a
spawner reaching MCP by accident; review stays the guarantee against a deliberate one, as OD-81 says of the directive filter.

B2's J2 forbids only the kicad-cli runner (under `pcb/fab`), so until B4 the
dispatch header's claim that nothing it reaches can "run a process (J2)" held for the other four spawners by absence alone;
the header now names this gate. A worker-thread or child-process engine host for placement (a reversal, section 9) would
change this gate deliberately, by owner decision.

## 7. Listed means served — CONFIRMED (suite `b20-b4-withhold-proposals`, case 5)

After the move no listed tool answers `not_served`. The dispatch keeps its closed `not_served` branch (the text "This tool is
listed but not yet served; nothing was done.") as defence. The ratchet calls `tools/call` on every tool `tools/list` returns,
for every role, and requires the read branch (traced `read_served` or `read_refused`, never `not_served`). A forged registry
that registers placement's proposal descriptor under the listed read id `sirkit.pcb.via-inspect` passes the exposure report
and the listing (both clean), is caught by this ratchet alone, and is answered by the defence branch with the exact
`not_served` refusal; B2's endpoint suite reaches the same branch through the canonical wrapper with that forgery.

## 8. The re-read of 2026-09-21 — CONFIRMED (fetched live by B4's first dispatch and its review round)

- **MCP 2026-07-28 tools:** `tools/list` "MUST NOT vary per-connection" and MAY vary by the authorization on the request;
  `structuredContent` must conform to `outputSchema`, and a tool returning structured content SHOULD also return it as text;
  an unknown tool is the protocol error `-32602`, an input-validation or business failure `isError: true`.
- **MCP 2026-07-28 authorization:** the error-handling table makes the status codes a MUST (403 for insufficient scope);
  the `insufficient_scope` challenge parameters are SHOULD. **The 403 fallback is moot in B20:** B4 adds no propose scope,
  the token carries exactly `sirkit.mcp`, and `tools/list` varies by role only (OD-57).
- **OpenAI** (developers.openai.com/api/docs/guides/tools-connectors-mcp): names MCP 2025-03-26 and links its tools
  error-handling section; `mcp_call` carries `output` and `error`; which result field feeds `output` is UNKNOWN.
- **Anthropic** (platform.claude.com/docs/en/agents-and-tools/mcp-connector): beta `mcp-client-2025-11-20`, links the
  2025-11-25 authorization spec; `mcp_tool_result` carries `content` and `is_error`; `structuredContent` is not mentioned.
- Both connectors are handshake-era clients that cannot call this modern-only server (OD-41, OD-70): recorded as fact, not
  as a dependency. RFC 6749 section 3.3, RFC 6750 section 3.1 and RFC 9728 section 2 were re-read for the scope design,
  which B4 does not build.

## 9. Reversal conditions — RECORDED

Restoring any proposal is a reviewed ratchet move back to the exposed list with an owner decision, a serving path
(section 7) and the pins of the moved suites:
- **placement** (OD-87): a bounded engine host with kill semantics (the runbook's B22-B "run a pinned placement/routing
  experiment" runtime profile), stopped hard at the budget; or an accepted bound after a real-board probe; or serving only
  below a measured footprint cap. A worker-thread or child-process host changes the process gate (section 6) deliberately.
- **routing:** a sandboxed routing worker under the same B22-B profile (the same gate change).
- **the bounded PCB edit:** a durable source for the editor's history head, lineage and DRC preset.
- **the two schematic proposals:** a durable `SchematicState` store (the reversal of OD-69 too).
- **What a reversal must add** (the B4 design, kept by the lead): the raw sealed candidate embeds the whole board and its
  constraint history and measured 2.2 to 3.9 million characters on the probe board, so a served placement returns a bounded,
  sanitized projection (OD-50's alternative); a propose delegation on the token; a proposal pool with admission and run
  windows; replay; and a closed proposal trace. OD-83 to OD-86 and OD-88 stay reserved for that design.

## 10. Follow-ups — RECORDED

- **F1 — the anonymous preview route.** `/api/pcb/placement/preview` is public "stateless compute" (C18), accepts a
  16 000 000-byte body (C16) and forwards the caller's `localRefinementPasses`, `gridNm` and `timeoutMs` to the engine (C15;
  stop-evidence case 6). The engine clamps passes to 0 to 3 (C12) and the grid to at least 10 000 nm (C8); the `[50, 120 000]`
  ms timeout (C7) is checked only between specs, and the route's `deadlineMs` 45 000 reaches only the body reader (C19, C20),
  never the synchronous call (C17). Measured in process on 2026-09-21 (the POST handler called directly, no network): one
  anonymous request (50 footprints, 105 010 characters, `timeoutMs` 1 000, 3 passes) answered 200 after 124.9 s and blocked
  the event loop for 124.9 s; with 1 pass, 40.9 s (`b4f-05`). [B24-closeout, 2026-10-10] superseded: B24-A3's record, artifacts/ai-control-plane-b24/abuse-controls.md:334.
- **The native agent path's budget.** `sirkit.placement.propose` over the chat run clamps the engine to 110 s (C14), a
  between-spec budget like every other: a spec that has started runs to its end.
- **F4** is closed by the process gate (section 6).
- **Stale text left for the lead:** superseded 2026-09-24 by the B20 closeout (D20-30). The two registry texts that said MCP
  serves or lists proposals were rewritten to what B4 landed, and their generated artifacts regenerated with no other drift:
  - the `mcp.server` record's `mutationAuthority` in `app/lib/engineering/action-registry.ts` now reads "(B3 serves the nine
    reads through the B05 invocation layer from the durable server board; B4 withheld every proposal, OD-82 / OD-87, so
    tools/list holds reads only)", generated into the `mcp.server` row of
    `artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv`;
  - the `/api/mcp` evidence text in `app/lib/auth/route-policy.ts` now reads "lists the nine-read subset only - every proposal
    withheld, OD-82 / OD-87", generated into the `/api/mcp` row of
    `artifacts/ai-control-plane-b16-0-1/exact-route-authorization-policy.csv`.
  Before the closeout this bullet named those four paths as a follow-up. [B20 B4 review] The first B4 text named the
  action-registry record alone and said it fed the B16 route artifacts; it feeds the B01 matrix, and the route-policy text
  feeds the B16 one (coverage-2, regressions-4). `b20-b4-withhold-proposals` case 8 pins the state: every such statement
  outside the lead's files is corrected beside it (`[B20 B4]`), and none is left uncorrected.

## 11. Citations, as of base 4299067

Each row names a file, its line AS OF 4299067, the enclosing function when the anchor text recurs in the file, and the
anchor. The tests check the ANCHOR, never the line (it occurs exactly once in the file, or in that function's body:
`b20-b4-withhold-proposals` case 7, and stop-evidence case 8 for C1 to C20), so an unrelated edit to a shared file cannot
break them.

| # | file | line as of 4299067 | within | anchor | what it shows |
|---|---|---|---|---|---|
| C1 | `app/lib/pcb/placement/engine.ts` | 47 | — | `function checkBudget(` | the one budget and cancellation check |
| C2 | `app/lib/pcb/placement/engine.ts` | 48 | `function checkBudget(` | `observer?.shouldCancel?.()) throw new EngineeringPlacementCancelledError()` | the cancellation poll |
| C3 | `app/lib/pcb/placement/engine.ts` | 286 | — | `function localRefine(` | local refinement (no poll inside) |
| C4 | `app/lib/pcb/placement/engine.ts` | 291 | `function localRefine(` | `.slice(0, 16)` | up to 16 target footprints |
| C5 | `app/lib/pcb/placement/engine.ts` | 297 | `function localRefine(` | `structuredClone(best.placements)` | a clone per neighbour move |
| C6 | `app/lib/pcb/placement/engine.ts` | 299 | `function localRefine(` | `evaluateCandidate({ problem, placements` | a whole-candidate evaluation per move |
| C7 | `app/lib/pcb/placement/engine.ts` | 309 | — | `Math.max(50, Math.min(120_000, Math.round(options.timeoutMs ?? 15_000)))` | the engine's timeout clamp |
| C8 | `app/lib/pcb/placement/engine.ts` | 315 | — | `Math.max(10_000, Math.round(options.gridNm ?? 100_000))` | the grid clamp |
| C9 | `app/lib/pcb/placement/engine.ts` | 319 | — | `{ initializer: "current", seed: problem.seedSet[0] }` | the first spec is the current-placement seed |
| C10 | `app/lib/pcb/placement/engine.ts` | 327 | — | `checkBudget(startedAt, timeoutMs, input.observer)` | one check per spec, before it starts |
| C11 | `app/lib/pcb/placement/engine.ts` | 345 | — | `forcePlacement(problem, spec.seed, maxIterations, gridNm)` | the only reader of maxIterations |
| C12 | `app/lib/pcb/placement/engine.ts` | 359 | — | `Math.max(0, Math.min(3, Math.round(options.localRefinementPasses ?? 1)))` | the refinement-pass clamp |
| C13 | `app/lib/pcb/candidates/layout-candidate.ts` | 180 | — | `runEngineeringPlacement({ board: input.board, options: placementRunOptions(input.board, input.request) })` | the shared producer passes no observer |
| C14 | `app/lib/agent/layout-proposals.ts` | 120 | — | `timeoutMs: Math.max(1_000, Math.min(input.timeoutMs, 110_000))` | the native agent path's 110 s clamp |
| C15 | `app/api/pcb/placement/preview/route.ts` | 21 | — | `["candidateCount", "maxIterations", "localRefinementPasses", "gridNm", "timeoutMs"]` | the caller's options forwarded |
| C16 | `app/api/pcb/placement/preview/route.ts` | 30 | — | `publicJsonRoute({ maxBytes: 16_000_000, deadlineMs: 45_000 }` | a public route, 16 MB body, 45 s deadline |
| C17 | `app/api/pcb/placement/preview/route.ts` | 40 | — | `runPlacementCandidate({ board: input.board, request: request(input.options) })` | the synchronous engine call |
| C18 | `app/lib/auth/route-policy.ts` | 257 | — | `pub("/api/pcb/placement/preview", ["POST"], "stateless compute")` | the public policy row |
| C19 | `app/lib/auth/route-handlers.ts` | 581 | `export function publicJsonRoute` | `const readOpts = { maxBytes: options.maxBytes, ...(options.deadlineMs` | the deadline reaches the body reader |
| C20 | `app/lib/auth/route-handlers.ts` | 583 | `export function publicJsonRoute` | `readBoundedJsonObject(request, readOpts)` | and only the body reader |
| C21 | `app/lib/pcb/candidates/layout-candidate.ts` | 19 | — | `import { commitPcbCandidate } from "../../engineering/pcb-commit-gateway";` | the commit gateway import |
| C22 | `app/lib/pcb/candidates/layout-candidate.ts` | 321 | `export function applyLayoutCandidate(` | `commandId: "pcb.auto-place",` | apply of a placement candidate |
| C23 | `app/lib/pcb/candidates/layout-candidate.ts` | 340 | `export function applyLayoutCandidate(` | `commandId: scope ? "pcb.reroute-nets" : "pcb.autoroute-import",` | apply of a routing candidate |
| C24 | `app/lib/pcb/candidates/layout-candidate.ts` | 372 | `export function clearNets(` | `commandId: "pcb.clear-nets",` | clear nets, a human edit |
| C25 | `app/lib/pcb/candidates/layout-candidate.ts` | 249 | — | `export class LayoutCandidateStore {` | the in-memory candidate registry |
| C26 | `app/components/pcb/PcbEditor.tsx` | 1366 | — | `const [layoutCandidates] = useState(() => new LayoutCandidateStore());` | one store per editor mount |
| C27 | `app/components/pcb/PcbEditor.tsx` | 1439 | — | `if (head.headSequence !== pendingPcbProposal.base.historyHead.sequence) {` | apply re-verifies the live editor's history head |
| C28 | `app/lib/engineering/schematic-proposals.ts` | 29 | — | `import type { SchematicState } from "@/lib/schematic-types";` | the schematic proposal's input is the editor's state |
| C29 | `app/lib/engineering/schematic-proposals.ts` | 31 | — | `import { validateSchematicCanonicalMark } from "./schematic-projection";` | and its head mark |
| C30 | `app/lib/pcb/autoroute/runner.ts` | 12 | — | `import { spawn } from "child_process";` | the FreeRouting runner starts a process |
| C31 | `app/api/chat/route.ts` | 401 | — | `routingExecutor: async ({ signal: toolSignal, timeoutMs }) => {` | the routing proposal's engine is that runner |

## 12. Suites — CONFIRMED (run through the heavy-job runner; the page test counts `it(` blocks)

| suite | cases |
|---|---|
| `app/lib/mcp/server/__tests__/b20-b4-withhold-proposals.test.ts` | 8 |
| `app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts` | 5 |
| `app/lib/mcp/server/__tests__/b20-b4-stop-evidence.test.ts` | 8 |

The three suites ride the `app/lib/mcp` directory filter of the `prompt-to-gerber` job; none starts PGlite. The stop-evidence
suite pins UNCHANGED base code: it passed on 4299067 and did not fail first; mutations of the cited code show it is
sensitive. Reviewed pin moves (each reason beside the change): `b20-b1-mcp-exposure`, `b20-b1-tool-definitions`,
`b20-b3-mcp-subset-move`, `b20-b3-mcp-tools-call-reads` (H1, H8), `b20-b3-read-call` (C14), `b20-b2-mcp-endpoint` (the listing
by role, the role-filtered answer, the `not_served` defence) and `b20-b2-own-client-interop` (case 4).

## 13. The adversarial review's findings (2026-09-21) — CONFIRMED

Each finding was reproduced test-first through the heavy-job runner (the first run of each strengthened case failed on the
unfixed tree, every part recorded by soft assertions); the test-strength finding was also proved by a source mutation that
every suite passed before the change and the strengthened case fails, the source restored byte-for-byte (sha256).

| finding | fix | proof |
|---|---|---|
| regressions-1, security-1: the process gate saw only first-party module references | the gate also flags `getBuiltinModule`, `binding` of `process`, `_linkedBinding` / `dlopen`, `eval`, `Function` and `vm`, and pins the third-party specifiers to a reviewed list; the test header, the dispatch header, the endpoint page and section 6 state what it checks and what it does not analyse | `b20-b4-process-gate` case 3: seventeen new probes, each uncaught by the first gate (twelve in the first failing run, five more added with the fix, each run failing before its detection); case 5 (the reviewed list); case 4 (the claims); the review's own scenario applied to `dispatch.ts` (`process.getBuiltinModule("node:child_process")` and an `execa` import) failed cases 1, 2 and 5 while J2 and B3's import gates passed |
| regressions-2: stop-evidence case 6 cold-imported the preview route inside its 5 s budget | the import moved to module top level (collection has no timeout) | at a 300 ms test timeout `b20-b4-stop-evidence` case 6 timed out before (its body took 769 ms on an idle machine, nearly all of it the import) and passes after |
| regressions-4, coverage-2: stale registry and route-policy texts, one of four listed | section 10 names both texts and their generated artifacts with a follow-up increment; the B2 intro of `mcp-server-endpoint.md` corrected beside it | `b20-b4-withhold-proposals` case 8 |
| regressions-5: the reads page misquoted B1's header | D-13 now quotes the header as it reads | `b20-b4-withhold-proposals` case 8 (the quote is checked against `mcp-exposure.ts`) |
| coverage-1: the probe tallies left out the abort probe's two runs | rows P11 and P12; the tallies and the footprint-cap statement recomputed | `b20-b4-withhold-proposals` case 6 |
| coverage-3: the reads page still credited J2 with "no process run" | item 8 of its deviations carries the F4 correction | `b20-b4-process-gate` case 4 (every B20 page paragraph that says what the import gate proves names that gate) |
| tests-2: no test rendered a propose-class definition's `readOnlyHint` | withhold case 5 checks the forged proposal's annotations | forcing `readOnlyHint` true in the returned definition passed the 27 suites of `app/lib/mcp`, `app/api/mcp` and the B1 and B3 exposure suites (596 cases) before (forcing it at the derivation line was caught only by B1's page citation of that line); `b20-b4-withhold-proposals` case 5 fails with it |

## 14. [B24-D2, 2026-10-09] A third withheld category: the paged board read (OD-235) — CONFIRMED (suites `b20-b4-withhold-proposals` case 6, `b24-d2-board-read` case 2)

B24-D2 added one agent-exposed Tier 0 read, `sirkit.pcb.board-page-inspect` (OD-213: one layer, net or region of
board-inspect's own snapshot, a page at a time). The structural rule admits it, and it IS servable from durable state
(`canonical-state`, `durable-server-board`, `board-present`) - unlike B3's two withheld reads. It is withheld by a reviewed
choice, not an inability: paged answers and their cursors were never reviewed for MCP clients (OD-48, OD-54). The MCP subset
stays the 9 served reads; restoring the read needs an owner decision.

| tool | class | MCP | increment | decision | reason |
|---|---|---|---|---|---|
| `sirkit.pcb.board-page-inspect` | read | withheld | B24-D2 | OD-235 | servable from the durable server board, withheld by choice: paged answers and their cursors were never reviewed for MCP clients (OD-48, OD-54) |
