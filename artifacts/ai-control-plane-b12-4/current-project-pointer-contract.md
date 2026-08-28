# B12.4 §E — the current-project pointer contract

> **SUPERSESSION NOTE (B12.5).** "The pointer always agrees with the
> successfully installed project" below held only while the pointer
> WRITE succeeded: `markProjectCurrent`'s boolean was IGNORED at the end
> of the mutation-heavy install, so a failed write yielded installed +
> visible B + persisted A (B12.5 counterexample R2). Activation is now
> transactional (PREPARE → typed POINTER COMMIT before any visible
> change → guarded no-throw COMMIT with blocking recovery):
> `../ai-control-plane-b12-5/transactional-project-activation.md`.
> The exactly-once / zero-on-superseded discipline below stands.
> Preserved as historical evidence.


Modules: [`app/lib/project/current.ts`](../../app/lib/project/current.ts)
(`loadProjectRecord`, `createProjectRecord`, `markProjectCurrent`),
[`app/page.tsx`](../../app/page.tsx) (`switchProject`, `createNewProject`,
`handleImportProjectFile`, `installProject`). Supersedes the load-time
pointer writes (R5: a failed switch left `sirkit:currentProjectId` on a
target that never installed — a reload bootstrapped the wrong project
while the UI reported "unchanged").

## The rule

> `sirkit:currentProjectId` changes exactly once per successful
> transition, inside the WINNING install, after the target actually
> installed. Loading, creating, importing, failing, and being superseded
> never touch it.

| Entry point | Before B12.4 | Now |
| --- | --- | --- |
| `switchProject` | `openProject(id)` set the pointer at load, then hydrated; plus a RAW `autosaver.flush()` in the click handler | `loadProjectRecord(id)` (read-only) → `hydrateProject` → the transition contract; the ONE required flush is the coordinator's typed `beforeInstall` |
| `createNewProject` | `startNewProject()` set the pointer at create; raw flush | `createProjectRecord()` persists the record only; the pointer commits on install |
| `handleImportProjectFile` | `openProject(imported.id)` set the pointer before hydration | the imported record/checkpoints persist; activation belongs to the winning install |
| `installProject` (the winning install body) | never touched the pointer | `markProjectCurrent(record.id)` as its LAST act — an install failure before that line leaves no false pointer |
| bootstrap | unchanged | `bootstrapCurrentProject` still resolves/creates and repairs dangling pointers at startup; the mount hydration re-commits the same id on install |

`openProject`/`startNewProject` remain exported for the bootstrap
fallback semantics but are documented DEPRECATED for transition flows; the
page-wiring source gate asserts no transition handler calls them and no
raw autosaver flush remains in switch/create handlers.

## Proven (production `current.ts` + real coordinator, localStorage shim)

- FAILED switch: visible stays A, pointer stays A, a reload bootstraps A —
  no split-brain (R5's exact scenario fails closed).
- SUPERSEDED target (B then C while a lease defers both): the pointer goes
  to C only, written exactly once (write-count instrumented) — B never
  touches it.
- Created-but-never-installed records never own the pointer; a failing
  transition to a new record leaves it unchanged; the successful retry
  commits it.
- The success path changes the pointer exactly once to the installed
  project.
