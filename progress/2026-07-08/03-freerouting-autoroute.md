# Stage 9 — One-click autoroute via Freerouting

## What changed
One-click "Route board": export Specctra **DSN** from the `PcbBoard`, run a local
**Freerouting** JAR as a subprocess (NGSpice pattern), parse the returned **SES** into
tracks+vias, and import the whole batch as ONE history command (single Ctrl+Z reverts
it). Server is pure (returns SES text + stats); the client parses + dispatches.

## New files
`dsn/types.ts` (DSN subset), `dsn/write-dsn.ts` (`boardToDsn`/`writeDsn` + `dsnNetName`,
`VIA_DIMENSIONS`), `dsn/read-ses.ts` (`parseSes`, reuses `sexpr.ts` + `layerFromKicadName`),
`autoroute/command.ts` (`buildAutorouteImportCommand`), `autoroute/runner.ts`
(`runFreerouting`), `api/pcb/autoroute/route.ts`, `components/pcb/hooks/useAutoroute.ts`;
5 test files; `.env.example` documents `FREEROUTING_JAR`/`JAVA_HOME`.

## Modified (integration hunks — flagged; single commands file + toolbar/editor)
`route-tool.commands.ts` — extended the `RouteCommand` union + all three switches:
```ts
// union member (NOTE: carries `removed`, unlike the plan's pinned shape — the pure
// invertRouteCommand(cmd) has no board arg, so it cannot restore replaced copper
// without it; RipupNet already uses this idiom. Makes the variant self-dual.)
| { kind: "AutorouteImport"; tracks: Track[]; vias: Via[]; replacedNetIds: number[];
    removed: { tracks: Track[]; vias: Via[] } };
// mutateBoardWithCommand:
case "AutorouteImport": {
  const replaced = new Set(cmd.replacedNetIds);
  board.tracks = board.tracks.filter((t) => !replaced.has(t.netId));
  board.vias = board.vias.filter((v) => !replaced.has(v.netId));
  for (const t of cmd.tracks) board.tracks.push(cloneTrack(t));
  for (const v of cmd.vias) board.vias.push(cloneVia(v));
  return;
}
// invertRouteCommand: (self-dual — swap tracks/vias with removed)
case "AutorouteImport":
  return { kind: "AutorouteImport", tracks: cmd.removed.tracks.map(cloneTrack),
    vias: cmd.removed.vias.map(cloneVia), replacedNetIds: [...cmd.replacedNetIds],
    removed: { tracks: cmd.tracks.map(cloneTrack), vias: cmd.vias.map(cloneVia) } };
// routeCommandLabel:
case "AutorouteImport": return "Autoroute board";
```
`PcbToolbar.tsx` — main-row "Route board" button (Zap icon; Loader2 spinner + elapsed
chip while running). Placed in the MAIN row, not the `children` slot, because the
`children` extras are gated behind `!init.demo` and would be hidden on `?pcbdemo=routed`.
New optional props: `onRouteBoard?`, `routing?`, `routingElapsedMs?`.
`PcbEditor.tsx` — `const autoroute = useAutoroute({ getHistory: () => historyRef.current, toast: setToast })`
and passed `onRouteBoard/routing/routingElapsedMs` to the toolbar.

## New exports (signatures)
`boardToDsn(board): DsnBoard`, `writeDsn(dsn): string`; `parseSes(sesText, board): SesResult`
(`{ tracks, vias, wasSuccessful, passesRun }`); `buildAutorouteImportCommand(board, { tracks, vias }): AutorouteImportCommand`;
`runFreerouting(input: RunFreeroutingInput): Promise<RunFreeroutingResult>`;
`useAutoroute(editor): { state, elapsedMs, lastResult?, lastError?, run(), cancel() }`;
API `POST /api/pcb/autoroute` → `{ ok, sesText, stats:{ elapsedMs, tracksImported, viasImported } }`.
Plus `DsnBoard`/`DsnBoundary`/`DsnLayer`/`DsnPadstack`/`DsnComponent`/`DsnNetwork`/`DsnRule` types.

## Design note — baked absolute placement
Our board is KiCad-convention (+y down, CCW rotation); Freerouting composes `(place)`
rotation/side with its own convention. To make correctness independent of that, we emit
ONE image per instance, `(place ref 0 0 front 0)`, and bake each pin's ABSOLUTE
`padWorldPosition`. Freerouting's composition is then the identity, so returned SES tracks
land exactly on our pad centers. Padstack dedup unaffected.

## Verification
- `pnpm test`: 186/186 pass (5 new files, 23 new tests); Stages 1/5/6/7/10 still green.
- `npx tsc --noEmit`: clean. `eslint` on all touched files: clean.
- **Coordinate contract (E2E minus JAR)** `autoroute-integration.test.ts`: a 90°-rotated
  2-pad net, emitted via `boardToDsn`, then joined by an SES wire between the two
  emitted pin coords, parses + imports and drives `computeConnectivity` to 1/1,
  airwires 0 — proving write-DSN pin coords == the pad points connectivity checks.
- **Failure cases** (route.test.ts): missing `FREEROUTING_JAR` → 500 `jar-missing`
  (runner never called); runner timeout → 500 `timeout`; bad body → 400.
- **NOT run: the live browser `?pcbdemo=routed` autoroute + <30 s timing** — needs a
  real `freerouting-2.2.0.jar` + Java 21, which are not installed in this
  environment (no JAR on disk, `FREEROUTING_JAR` unset). Everything up to the
  subprocess boundary is verified; the operator must install the JAR to run the
  full click-to-route + Ctrl+Z demo. `runner.ts` is a faithful clone of the
  NGSpice subprocess pattern.

## Adversarial review (multi-agent) + fixes
Find→verify review (5 dimensions, skeptic-verified). 5 low-severity defects confirmed &
fixed: collision-guarded padstack names (no duplicate `(padstack)` names); `np_thru_hole`
pads skipped (matches connectivity model); network nodes from EMITTED pins only (no dangling
refs); `parseSes` stats wrapped in try/catch → structured 500; import command rebuilt against
current `h.present` post-await + empty/failed session reports "no routes" vs silent success.
Also hardened: SES wires on unresolved net names dropped (never touch net 0); Windows
`java.exe`. Regression tests added. Refuted (no change): timeout-vs-maxDuration race and a
Windows bare-`java` spawn claim. Known assumption: SES read as raw nm (Freerouting preserves
the input `nm 1` resolution) — add unit scaling in read-ses if a future JAR rescales.

## TODOs
- Live progress bar deferred (Freerouting stdout is version-fragile) — spinner + elapsed only.
- Docker / hosted REST fallback deferred (env-driven local JAR only).
- **Auto-DRC on completion pending Stage 12**: when `runDrc(board, rules)` lands, call it
  inline in `useAutoroute.run()` on success (marked `// TODO(stage12)`) and surface the
  violation count in the completion toast/chip.
- Per-net class *overrides* (beyond class defaults) not emitted to DSN — Freerouting routes at
  class granularity; multi-pass strategy config also deferred.
- Pad-shape orientation for non-orthogonal rotations approximated (positions always exact).

## Env
- `FREEROUTING_JAR` (required, absolute path to freerouting-2.2.0+ JAR).
- `JAVA_HOME` (optional; else `java` on PATH) — Java 21+.
