# Sirkit Working-Tree Diff Diagnosis and Agent Handoff

**Captured:** 2026-07-19  
**Repository:** `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`  
**Protected original:** `C:\Users\robsa\sirkit` — do not modify  
**Branch:** `codex/cd-13-full-flow-orchestrator`  
**HEAD:** `2bd1603a775bd4b409b89710cd4e5f8d70201632`

> Important snapshot note: all counts below were captured immediately before this handoff file was added. This document itself adds one additional untracked Markdown file, so a new `git status` will show one more untracked path.

## 1. Instructions for the next agent

Do not treat the current working tree as a reviewable Stage 6 patch. It is a cumulative working copy containing prior PCB, AI, Stage 1–10, CD-1–13, footprint-binding, test, migration, documentation, and benchmark work.

Before editing anything:

1. Run the read-only commands in Section 12 and confirm the numbers have not materially changed.
2. Do not modify or revert the protected original repository.
3. Do not delete generated artifacts merely to make the diff smaller without explicit user authorization.
4. Do not run formatters, code generators, Drizzle generation, migration application, commits, resets, checkouts, or cleanup commands during the audit.
5. Separate Stage 6 prerequisite work from unrelated earlier work before proposing anything for preservation or commit.
6. Treat all existing user changes as valuable until their provenance and purpose are understood.
7. Do not claim Stage 6 complete while its existing completion report says `BLOCKED`, the latest changes are not fully verified, and database qualification remains outstanding.

## 2. Executive conclusion

The current Git state does **not** contain the reported `+1,496 / -16,899` tracked diff.

The exact unstaged tracked diff at capture time was:

```text
134 files changed, 6510 insertions(+), 1456 deletions(-)
```

Nothing was staged.

The complete working-tree population was:

```text
Tracked modified files: 134
Untracked files:        1113
Total changed paths:    1247
```

The untracked files contained 68,394 text lines and approximately 9.98 MB. If they were naively counted as additions, the overall working copy would be roughly `+74,904 / -1,456`, not `+1,496 / -16,899`.

Therefore, the deletion-heavy number was produced from a different base, branch, folder, comparison target, or stale UI state.

The correct safety verdict is:

> **UNSAFE TO KEEP OR COMMIT WHOLESALE.** There is no mass deletion, but the tree mixes 1,247 paths from many unrelated programs, includes 300 generated artifacts, contains unqualified migrations, has contradictory documentation, and lacks a final verification pass for the newest changes.

## 3. Direct Git evidence

### 3.1 Tracked diff totals

```text
git diff --stat
134 files changed, 6510 insertions(+), 1456 deletions(-)
```

Summing `git diff --numstat` independently produced the same result:

```text
tracked_files=134 additions=6510 deletions=1456
```

### 3.2 Index state

```text
staged_files=0
```

### 3.3 Structural change audit

```text
deleted_files=0
renamed_files=0
type_changed=0
unmerged=0
git diff --check findings=0
```

No tracked file is wholly deleted. No rename, type change, or unresolved merge exists.

## 4. Files with the most deleted lines

No file has more than 200 deleted lines. The maximum is 107.

| Rank | File | Added | Deleted | Why it changed |
|---:|---|---:|---:|---|
| 1 | `app/lib/pcb/__tests__/build-bundle.test.ts` | 48 | 107 | Manufacturing tests were rewritten around immutable readiness and release manifests. |
| 2 | `app/api/pcb/export/gerbers/__tests__/route.test.ts` | 94 | 105 | Gerber endpoint tests changed from a DRC override to release-gate behavior. |
| 3 | `app/lib/pcb/route-tool.ts` | 230 | 94 | Professional route candidates and sessions replaced older direct segment commands. |
| 4 | `app/lib/pcb/dsn/read-ses.ts` | 295 | 93 | SES import gained multilayer diagnostics, stable identities, manifest checks, and recovery data. |
| 5 | `app/lib/pcb/ai/snapshot.ts` | 115 | 72 | The AI PCB snapshot moved to an electrical-truth and fabrication-readiness model. |
| 6 | `app/lib/pcb/netlist-bridge.ts` | 209 | 56 | Stable net identity, explicit pin-pad mapping, and net reconciliation replaced heuristic behavior. |
| 7 | `app/components/pcb/FabDialog.tsx` | 79 | 53 | Export-override UI was replaced by revision-bound waiver and release UI. |
| 8 | `app/lib/pcb/dsn/write-dsn.ts` | 222 | 52 | DSN export gained multilayer, plane-fill, via, and electrical-manifest behavior. |
| 9 | `app/lib/pcb/autoplace/force-directed.ts` | 35 | 39 | Pairwise springs were replaced with a more scalable hyperedge representation. |
| 10 | `app/lib/pcb/fab/build-bundle.ts` | 71 | 35 | Ad-hoc DRC/refill logic was replaced by immutable fabrication-readiness logic. |
| 11 | `app/lib/pcb/drc/run-drc.ts` | 90 | 34 | DRC moved toward shared electrical truth and constraint lineage. |
| 12 | `app/components/pcb/hooks/useFabExport.ts` | 72 | 34 | Client export now handles release manifests and waiver reasons. |
| 13 | `app/lib/pcb/autoroute/verification.ts` | 68 | 34 | Stable-net, layer, via, locked-copper, and zone-fill verification was added. |
| 14 | `app/lib/pcb/render/scene.ts` | 61 | 34 | Placement-preview rendering and transform handling were added. |
| 15 | `app/lib/pcb/__tests__/route-tool.test.ts` | 102 | 33 | Tests were updated for route-candidate commands and professional route modes. |
| 16 | `app/lib/pcb/ai/pcb-tool-service.ts` | 69 | 31 | AI tools moved to engineering placement/routing and electrical truth. |
| 17 | `app/lib/llm/__tests__/providers.test.ts` | 56 | 23 | GPT-5.6 and no-local-output-cap behavior were added. |
| 18 | `app/api/pcb/export/gerbers/route.ts` | 75 | 20 | The Gerber API moved to release-mode and readiness enforcement. |
| 19 | `app/lib/pcb/autoroute/completion.ts` | 110 | 19 | Route-attempt artifacts, stable revisions, and recovery checks were added. |
| 20 | `app/api/pcb/autoroute/route.ts` | 109 | 19 | Autoroute now validates immutable candidates and preserves protected copper. |

These are substantive rewrites, not whole-file erasures. Most are earlier PCB routing/manufacturing work and do not address a Stage 6 footprint-assignment prerequisite.

## 5. Exhaustive classification of all changed paths

The following ordered rules classified all 1,247 paths exactly once. The order matters: migration and generated paths are removed before the broader source/test rules are applied.

| Classification | Tracked | Untracked | Total | Exact path rule |
|---|---:|---:|---:|---|
| Production code | 108 | 591 | 699 | Remaining `app/**`, `lib/**`, `.env.example`, `package.json`, and `pnpm-lock.yaml` |
| Migration/schema | 2 | 21 | 23 | `app/lib/db/schema.ts` and all `drizzle/**` |
| Test/fixture | 23 | 201 | 224 | Remaining `**/__tests__/**`, `**/fixtures/**`, `*.test.*`, `**/corpus*`, `**/benchmark*`, `scripts/**`, `.github/workflows/**`, and `tsconfig.*.json` |
| Generated artifact | 0 | 300 | 300 | `artifacts/**`, `progress/**`, `docs/**`, and root `SIRKIT_*.md` reports |
| Deleted legacy code | 0 | 0 | 0 | No Git `D` paths exist |
| Unrelated file-kind | 1 | 0 | 1 | `.gitignore` |

This classification is about file kind. Section 8 separately classifies whether each path actually addresses a Stage 6 prerequisite.

### 5.1 Generated artifact inventory

```text
artifacts/**   215 files
progress/**     32 files
docs/**         10 files
SIRKIT_*.md     43 files
total          300 files
```

The `artifacts/**` files alone occupy about 3.9 MB. Many are repeat benchmark runs or full test-suite JSON captures. This is generated-output accumulation, not generated-file cleanup.

### 5.2 Untracked production modules

The 591 untracked production files span multiple independent programs, including:

- PCB and manufacturing;
- hierarchical constraints;
- atomic component catalog;
- requirements and functional architecture;
- power and interface planning;
- circuit knowledge;
- component selection;
- deterministic calculation;
- schematic compilation;
- circuit verification;
- simulation;
- firmware bring-up;
- release engineering;
- full-flow orchestration;
- physical binding Stages 1–7;
- durable workflow infrastructure;
- the Stage 6 assignment queue.

These must not be represented as one feature patch.

## 6. Deletion, formatting, and line-ending investigation

### 6.1 No accidental full-file deletion

Read-only checks found:

```text
git diff --diff-filter=D --name-only  -> 0 paths
git diff --diff-filter=R --name-only  -> 0 paths
git diff --diff-filter=T --name-only  -> 0 paths
```

There is no evidence of accidental legacy-file deletion.

### 6.2 Whitespace churn is small

Normal diff:

```text
+6510 / -1456
```

Ignoring all whitespace:

```text
+6466 / -1412
```

Only 44 added and 44 deleted lines are attributable purely to whitespace. Formatting churn does not explain a deletion-heavy diff.

### 6.3 CR-at-EOL churn is negligible

Ignoring carriage returns at end of line produced:

```text
+6509 / -1455
```

Only one addition/deletion pair is attributable to CR-at-EOL comparison.

### 6.4 Mixed line endings exist in nine tracked files

```text
.gitignore
app/api/export/kicad/route.ts
app/api/schematic/build-multi/route.ts
app/lib/build-loop.ts
app/lib/kicad-export.ts
app/page.tsx
lib/footprint-assign.ts
lib/persistence.ts
lib/schematic-types.ts
```

The repository has `core.autocrlf=true`, but 125 other tracked modified files remain LF-to-LF. There was no mass LF/CRLF conversion.

## 7. Large cumulative changes requiring special review

Even though the deletion count is modest, several additions are large and combine many prior stages:

- `app/lib/db/schema.ts`: `+957/-0`. It contains schema additions for the atomic catalog, constraints, CD-1–13, physical binding, and the durable workflow—not merely Stage 6.
- `lib/persistence.ts`: `+482/-4`. This is a broad persistence expansion and should be reviewed independently.
- `drizzle/meta/_journal.json`: `+127/-1`. It registers migrations `0006` through `0023` in one dirty working tree.
- `app/lib/pcb/dsn/read-ses.ts`: `+295/-93`.
- `app/lib/pcb/route-tool.ts`: `+230/-94`.
- `app/lib/pcb/dsn/write-dsn.ts`: `+222/-52`.
- `app/lib/pcb/netlist-bridge.ts`: `+209/-56`.

These changes may be valuable, but they cannot safely be approved as incidental prerequisites for the assignment queue.

## 8. Exact Stage 6 prerequisite mapping

All 1,247 paths were assigned to one prerequisite group using the path families below.

### B1 — Stage 1 durable physical-binding authority: 28 paths

Path families:

```text
app/lib/physical-binding/**
app/api/physical-bindings/**
drizzle/0022_footprint_binding_stage01.sql
*physical-binding-stage-01*
*FOOTPRINT_BINDING_STAGE_01*
scripts/physical-binding-stage1-evidence.ts
```

Addresses:

- immutable binding candidates and successor revisions;
- explicit selection/approval authority;
- optimistic concurrency and idempotency;
- persistent PostgreSQL representation;
- readiness evidence.

Remaining concern: isolated PostgreSQL migration, rollback, crash/restart, and recovery qualification has not been proven.

### B2 — Stage 2 deterministic resolver: 28 paths

Path families:

```text
app/lib/footprint-resolver/**
app/api/footprint-resolution/**
*footprint-resolver-stage-02*
*FOOTPRINT_RESOLVER_STAGE_02*
*FOOTPRINT_BINDING_STAGE_02*
```

Addresses:

- deterministic candidate collection and normalization;
- conflict and ambiguity reporting;
- explicit source authority and candidate dispositions;
- read-only resolution results consumed by Stage 6.

This was not the principal blocker; its production qualification depended on Stage 1 durability.

### B3 — Stage 3 durable snapshot, plan, board, and audit authority: 40 paths

Path families:

```text
app/lib/pcb-sync/**
app/api/pcb-sync/**
*pcb-sync-stage-03*
*PCB_SYNC_STAGE_03*
*FOOTPRINT_BINDING_STAGE_03*
```

Addresses:

- replacing in-memory authoritative snapshots;
- durable preflight plans and lifecycle;
- board/plan/audit commits;
- replay and plan invalidation;
- re-preflight without silently applying a board.

### B4 — Stage 4 durable mapping and invalidation: 31 paths

Path families:

```text
app/lib/mapping-verification/**
app/api/mapping-verification/**
*mapping-verification-stage-04*
*MAPPING_VERIFICATION_STAGE_04*
*FOOTPRINT_BINDING_STAGE_04*
```

Addresses:

- durable symbol-pin/package-terminal/footprint-pad verification;
- immutable verification results and lifecycle;
- Stage 1 projection;
- recoverable Stage 3 invalidation through an outbox.

### B5 — Stage 5 durable policy and component exceptions: 38 paths

Path families:

```text
app/lib/passive-policy/**
app/api/passive-policy/**
*passive-package-policy-stage-05*
*PASSIVE_POLICY_STAGE_05*
*FOOTPRINT_BINDING_STAGE_05*
```

Addresses:

- durable policy/context repositories;
- explicit approved per-component exception operation;
- policy successor revisions;
- Stage 2/3 invalidation through a recoverable outbox.

### B6 — shared transaction, replay, and outbox foundation: 12 paths

Path families:

```text
app/lib/durable-workflow/**
app/api/engineering-effects/**
drizzle/0023_footprint_binding_durable_workflow.sql
```

Addresses:

- compare-and-swap aggregate heads;
- immutable records;
- idempotent replay records;
- recoverable leased outbox events;
- multi-aggregate atomic commits within the durable repository boundary.

### B7 — Stage 6 assignment queue and workbench: 28 paths

Path families:

```text
app/lib/assignment-queue/**
app/api/assignment-queue/**
app/components/pcb/AssignmentQueuePanel.tsx
app/components/pcb/__tests__/assignment-queue-panel.test.tsx
app/components/pcb/PcbEditor.tsx
app/components/pcb/PcbToolbar.tsx
app/lib/pcb/board-persistence.ts
*ASSIGNMENT_QUEUE_STAGE_06*
*FOOTPRINT_BINDING_STAGE_06*
tsconfig.footprint-stage6.json
```

Addresses:

- structured blocker aggregation;
- stable assignment identity and deduplication;
- candidate comparison without automatic preselection;
- explicit human preview/commit;
- exact-plan digest checks;
- AI suggestion/authority separation;
- queue persistence, pagination, replay, and recovery;
- post-decision revalidation while preserving `boardChanged: false`.

### Multi-blocker rollout/schema files: 3 paths

```text
app/lib/db/schema.ts
drizzle/meta/_journal.json
.env.example
```

These span B1 and B3–B7. Their diffs are not isolated to Stage 6 and require special review.

### No Stage 6 prerequisite blocker: 1,039 paths

These include prior PCB routing, manufacturing, AI, Stage 1–10, CD-1–13, atomic catalog, constraints, benchmark, report, and generated-output work. They may address other user requests, but they do not justify inclusion in a Stage 6 prerequisite patch.

## 9. Current Stage 6 implementation status

The working tree contains a substantial but not fully qualified Stage 6 implementation:

- durable workflow heads, immutable records, replay records, and leased outbox events;
- durable Stage 3 snapshot/plan/board/audit adapters;
- durable Stage 4 mapping records and recoverable projection/invalidation;
- durable Stage 5 policy records and approved component exceptions;
- assignment-source materialization and deterministic blocker categorization;
- persistent assignment items, decision plans, decisions, and revalidation events;
- human-only candidate/policy decision orchestration;
- exact-plan preview and commit with decision reason/assignee bound into the plan digest;
- recovery when an owner commits but queue completion is interrupted;
- trusted revalidation that reloads Stage 1 and reruns Stage 2/3;
- accessible PCB assignment side panel with no ambiguous default candidate;
- bounded API payloads and a feature flag defaulting to off.

However, do not declare this complete because:

1. The latest security/pagination/UI edits were made after the last complete focused test run.
2. The final TypeScript/test command was terminated immediately when the user requested diagnosis-only mode.
3. Isolated live PostgreSQL migration/restart qualification was not run.
4. Existing Stage 6 documentation still reports `BLOCKED` and contradicts the source tree.
5. Bulk workflows and the exhaustive verification corpus required by the very large Stage 6 prompt have not all been proven.
6. The full repository build/test suite has not been established as clean after the cumulative changes.

## 10. Verification history relevant to the next agent

Successful focused evidence before the final edits included:

```text
Focused Stage 6 TypeScript compilation: passed

Durable workflow + assignment core:
3 test files passed
15 tests passed

Durable Stage 3–5 owner adapters + trusted revalidation:
2 test files passed
4 tests passed
```

The last command attempted to run focused TypeScript plus the expanded API/UI/queue suite. It was terminated, not allowed to complete, because the user said:

```text
STOP IMPLEMENTING. DIAGNOSIS ONLY. MAKE NO MORE CHANGES.
```

Therefore, never report the newest tree as fully passing based on the earlier results.

## 11. Safety decision

### Evidence against accidental destructive deletion

- zero deleted tracked files;
- maximum per-file deletion is 107 lines;
- no rename/type-change/unmerged path;
- no whitespace errors;
- negligible CR-at-EOL impact;
- only modest whitespace-only changes.

### Evidence against keeping the entire tree unchanged as one patch

- 1,247 changed paths;
- 1,113 untracked files before this report;
- 1,039 paths unrelated to a Stage 6 prerequisite;
- 300 generated artifacts;
- 23 schema/migration paths spanning many stages;
- contradictory blocked/completion documents;
- final verification interrupted;
- live database qualification missing;
- nine mixed-EOL tracked files;
- one branch contains many independent programs and prior tasks.

### Verdict

```text
UNSAFE TO KEEP OR COMMIT WHOLESALE
```

This does not mean all changes are bad. It means they must be separated by ownership and stage, reviewed, tested, and qualified before preservation or integration.

## 12. Read-only reproduction commands

Run these from the protected working copy. They do not modify files:

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --stat
git diff --numstat
git diff --summary
git diff --name-status
git diff --cached --stat
git diff --diff-filter=D --name-only
git diff --diff-filter=R --name-only
git diff --check
git diff --ignore-all-space --shortstat
git diff --ignore-cr-at-eol --shortstat
git ls-files --others --exclude-standard
git ls-files --eol -- $(git diff --name-only)
```

PowerShell top-20 deletion calculation:

```powershell
$rows = git diff --numstat 2>$null | ForEach-Object {
  $parts = $_ -split "`t", 3
  [pscustomobject]@{
    Added = [int]$parts[0]
    Deleted = [int]$parts[1]
    Path = $parts[2]
  }
}

$rows |
  Sort-Object -Property @{ Expression = 'Deleted'; Descending = $true }, @{ Expression = 'Added'; Descending = $true } |
  Select-Object -First 20
```

## 13. Recommended next audit sequence

This is a recommendation only. Obtain user approval before making changes.

1. Capture a fresh status and compare it with this pre-report snapshot.
2. Establish provenance for the 1,039 non-Stage-6 paths.
3. Separate generated evidence from source changes.
4. Review migrations `0006`–`0023` as an ordered migration program, not as one Stage 6 migration.
5. Isolate B1–B6 prerequisite changes from B7 queue/workbench changes.
6. Resolve documentation contradictions without rewriting historical evidence.
7. Run focused type checking and unit/integration/API/UI tests.
8. Qualify migration apply, restart, replay, outbox recovery, and rollback against an isolated database.
9. Run broader regression, lint, and build checks only after the patch boundaries are understood.
10. Present a proposed keep/split/drop inventory to the user before any revert, deletion, commit, merge, or push.

