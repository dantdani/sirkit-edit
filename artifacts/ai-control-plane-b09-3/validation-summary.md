# B09.3 validation summary

Date: 2026-08-09. Workspace: `C:\Users\robsa\Desktop\sirkit-edit`
(uncommitted working tree; `C:\Users\robsa\sirkit` untouched; no GitHub
authority used).

## New permanent regression suite

`app/lib/agent/__tests__/b09-3-closure.test.ts` — **19 tests, all pass**:
§A lineage integrity (6), §B registered resource path (5), §C semantic
schema validation (4), §D catalog/runtime truth incl. stale-phrase
tripwires, pre-B10 runtime-availability gate, and the preserved
sourceEvidence gate (4).

## Changed files

Production: `app/lib/agent/context.ts` (discovery lineage from the
validated head mark; effectiveHeadMark), `app/lib/agent/gateway.ts`
(lineage + in-boundary mark revalidation in `verifyAgentContextIntegrity`;
`invokeSchematicSnapshot` and its branch deleted), `app/lib/agent/loop.ts`
(boardless toolset withholds every read), `app/lib/agent/provider-tools.ts`
(semantic `validateSchemaStructure`; object-root parameters rule;
empty-schema guess removed from `convert`),
`app/lib/engineering/tool-catalog.ts` (header truth, add_via vocabulary,
schematic-inspect notes, propose `requiresLineage: true`, all
"assemblable" claims removed), `scripts/generate-agent-artifacts.ts`
(manifest v2 runtime truth). Tests: `b09-3-closure.test.ts` (new),
`b09-2-closure.test.ts` (2 tests updated to B09.3 truth, marked
superseded), `b09-proposals.test.ts` (33b split into
lineage_required/context_integrity shapes). Artifacts: b09-3 set (7 docs),
B09.2 corrections (5 docs), regenerated b04/b05/b05-1/b06*/b07/b09
manifests/fixtures.

## Test batteries (exact counts)

| Battery | Result |
| --- | --- |
| Regression gate `npx vitest run b07 b04-tool-registry b08 b06` | **316 passed** (18 files) — baseline preserved |
| `npx vitest run b05 app/lib/agent` (incl. 19 B09.3 + updated B09/B09.1/B09.2) | **147 passed** (10 files) |
| `npx vitest run app/lib/engineering/__tests__` | **450 passed** (26 files) |
| `npx vitest run app/lib/pcb/lifecycle/__tests__` | **20 passed** (2 files) |
| Full suite `npx vitest run` | **2149 passed, 5 failed, 20 skipped** (2174 total; 264/271 files passed, 3 skipped) |

The 5 full-suite failures are all in the DOCUMENTED timing-budget family
(perf assertions under parallel load): auto-place ×2, connectivity-board
<50 ms, pcb-repair-agent performance target, route-tool 500-track preview.
Isolated reruns: auto-place 8/8, connectivity-board 10/10,
pcb-repair-agent 8/8, route-tool 25/25. **Zero functional failures.**

## Static gates

- `npx tsc --noEmit`: clean.
- Scoped ESLint (`app/lib/agent/**`, `tool-catalog.ts`,
  `generate-agent-artifacts.ts`, all new/changed tests): zero findings.
- Artifact byte-match/determinism gates: pass against regenerated fixtures
  (all four generators re-run; registry digest `eng1-9fc75afe389b1f49`).
- sourceEvidence path gate: 27/27 descriptors, zero missing.
- Stale-phrase tripwires: zero hits across production sources and generated
  B09 manifests.
- Static exposed registry: exactly 8 distinct tool ids (gated).
- Pre-B10 runtime-availability gate: manifest v2 truth cross-checked
  against actual `buildRunToolset` behavior for the browser request shape.
- Transient reproduction script `scripts/_tmp-b093-repro.ts`: deleted.

## Stop-condition checklist

- Lineage disagreement fails every gateway path closed — CONFIRMED (reads,
  proposals, direct invocations; §A tests).
- Provider schemas semantically valid, not merely container-shaped —
  CONFIRMED (§C; all eight exposed schemas still render for both providers).
- No fictitious schematic resource or special read bypass remains —
  CONFIRMED (source scan gate; boardless reads refuse).
- Every read uses the registered resource/invocation boundary — CONFIRMED
  (gateway has exactly one read path: `ReadToolInvocationService`).
- Pre-B10 runtime tool availability recorded truthfully — CONFIRMED
  (manifest v2 + runtime cross-check).
- Catalog and generated artifacts free of the confirmed stale claims —
  CONFIRMED (tripwires green).
- Static exposure exactly eight IDs — CONFIRMED.
- No B10 board bridge, no autonomous mutation — CONFIRMED (none
  implemented).

## UNKNOWN

- Live provider model turns: both OpenAI and Anthropic accounts remain out
  of credits. All provider-boundary behavior is proven against real
  adapters with fake SDK clients; live end-to-end chat turns stay UNKNOWN
  (unchanged since B09).

## B10 readiness

With B09.3 closed, B09 is genuinely ready for B10 (context bridge) at the
boundary level: lineage-complete context integrity, semantic fail-closed
provider schemas, a single registered read path, and truthful pre-B10
availability records — B10's job is precisely to deliver the authoritative
board context that turns the recorded "withheld" reads live. The
live-credit caveat carries forward. B10 was NOT started — awaiting explicit
owner authorization.
