# Multi-agent build (planner → parallel subsystems → merge)

Date: 2026-06-26 · Status: done; merge unit-tested; worker loop smoke-tested live

## What
Complexity-gated orchestration on top of the existing single build loop.

- **`/api/schematic/build-multi`**
  1. **Planner/architect** (one forced tool call) decomposes the request into
     subsystem blocks + the shared-net contract (`+3V3`, `GND`, `SDA`, …).
  2. **Complexity gate**: ≤1 block (or planner failure) → normal single
     `runBuildToolLoop` (simple prompts pay only one cheap planner call).
  3. **Parallel subsystem designers** — `Promise.all` of scoped
     `runBuildToolLoop`, each connecting to the board via exact shared-net labels.
  4. **Deterministic merge** (`app/lib/merge-netlists.ts`) — concatenate,
     **de-collide refDes** (rewrite endpoints + parentRefDes), nets join by
     shared label name (the label system is what makes the merge clean).
- Build-mode **Generate** now calls `/build-multi` (same response shape).

The "agents" are parallel invocations of the proven worker; the deterministic
spine (merge + validator + review) does the integration and checking.

## Files
`app/api/schematic/build-multi/route.ts`, `app/lib/merge-netlists.ts`, `app/lib/prompts.ts`, `app/page.tsx`
