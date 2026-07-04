# SchGen cross-verification — netlist "second opinion" (advisory)

Date: 2026-07-02 · Status: core done (type-checked, lint-clean, unit-tested); live model = infra TODO

## Goal
Combine SchGen's generation to improve accuracy — as an INDEPENDENT second
opinion, not by merging. Chosen approach (option A): run SchGen on the same
prompt, reduce its output to a netlist, diff against Sirkit's netlist, surface
disagreements as advisory findings. The deterministic validator stays the only
blocking gate; consensus is a confidence signal, not ground truth.

## Design constraints honored
- **Common layer = netlist, not geometry.** SchGen's coordinates are its weak
  point; comparison is at the component-CLASS + named-NET level (differing refDes
  numbering / part identities make exact edge isomorphism meaningless anyway).
- **No code execution.** SchGen's DSL is parsed STATICALLY — `connect_pins` IS a
  net edge, `add_schematic_symbol` IS a component — so we recover the netlist
  without running model-generated Python.
- **Advisory only.** Findings feed the Layer-2 review pattern; nothing is merged
  (fusing two possibly-wrong netlists could invent shorts).

## What was built (deterministic, tested)
- `lib/netlist-crosscheck.ts` — generic over ANY two netlists (a second frontier
  model could feed it too):
  - `classifyComponent(refDes,name,value)` → coarse class (resistor/cap/…/ic).
  - `normalizeBuildNetlist(BuildLogicalNetlist, parts?)` → `NormalizedNetlist`
    (components + union-find nets, label-name and ground aware).
  - `crossCheckNetlists(primary, second)` → advisory findings: component-class
    count gaps (flags likely-missing support parts — decoupling caps, pull-ups,
    protection diodes — as warnings) + named-net presence gaps; plus a 0..1
    component-class `agreement` gauge.
- `lib/schgen-netlist.ts` — `parseSchGenSource(python)` statically scans
  `add_schematic_symbol` / `add_label` / `connect_pins` into a `NormalizedNetlist`,
  reporting `coverage` (so a low-coverage parse — e.g. model emitted loops/helpers
  — can be skipped rather than trusted).
- `app/api/schematic/cross-verify/route.ts` — orchestrates: Sirkit netlist
  (primary) vs SchGen second opinion → findings. **Pluggable dependency:** calls
  `SCHGEN_ENDPOINT_URL` (`{prompt}`→`{code}`); when unset returns
  `available:false` so it's safe to ship now. Guards against degenerate parses.

## Tests (`pnpm test:netlist`) — 10 new assertions
classify R/LED/IC · parse SchGen sample (components, connections, VIN label→named
net) · flags missing capacitor vs a richer second opinion · identical netlists →
no findings + agreement 1.0.

## Verification
`npx tsc --noEmit` clean · `npm run test:netlist` ALL PASS · eslint clean on the
four new/changed files.

## Remaining (your infra + a UI seam)
- **Host SchGen (GPU).** Stand up an inference service exposing `{prompt}→{code}`
  (Modal / Replicate / HF endpoint / GPU VM), set `SCHGEN_ENDPOINT_URL`. This is
  the one piece that can't be built from the app side. The route + parse + diff go
  live automatically once it's set.
- **UI:** fold cross-verify findings into the existing Review output (natural
  home) or a dedicated "Second opinion" action; can run async/debounced like
  Tidy/Review. Not wired yet (can't exercise without the endpoint).
- Static parse covers flat call sequences; if SchGen emits control flow, coverage
  drops and the route skips — an executed-in-sandbox → .kicad_sch → netlist path
  would be the fully-robust (but code-executing) alternative.
