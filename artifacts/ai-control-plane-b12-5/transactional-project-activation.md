# B12.5 §C — transactional project activation

## The defect (R2)

`installProject` performed every visible mutation first and called
`markProjectCurrent(record.id)` LAST — discarding its boolean. With the
pointer write failing, the coordinator reported **installed**, the
visible project was B, and the persisted current project remained A: a
reload opened A over live work in B.

## The activation protocol

A target is not successfully installed until its persistent
current-project pointer is confirmed. `installProject`
([app/page.tsx](../../app/page.tsx)) now runs three explicit phases and
returns the coordinator's typed `ProjectInstallResult`:

1. **PREPARE** — pure construction only (fresh
   `SchematicEditorSession`, `SchematicHistory`, projections, chat/view
   decoding). Nothing live changes; any throw returns a typed
   PRE-COMMIT failure and the prepared session is disposed.
2. **POINTER COMMIT** — `markProjectCurrent(record.id)` returns
   `{ ok: true, wrote } | { ok: false, detail }` and is CHECKED. It
   verifies by read-back (a storage layer that accepts the write but
   drops it is caught, not discovered at the next reload) and skips the
   write when the pointer already names the target. `{ ok: false }` is a
   PRE-COMMIT failure: no visible change has happened yet.
3. **COMMIT** — the live adoption, composed of setState/ref assignments
   that do not throw, guarded regardless: an unexpected throw returns
   `{ ok: false, recovery: true }`.

The coordinator (§D) completes the transaction semantics:

- PRE-COMMIT failure → the failed target's incarnation interlock is
  retired and the survivor is reactivated with a fresh ACTIVE interlock.
  Pointer, visible project, session, history and live interlock still
  agree on A — proven with real apply-after-failure and
  identity-preservation tests. No target session, scope, history,
  hydration, success toast, or autosave ownership survives (the target
  session is disposed in phase 2's failure path; phases 1–2 never touch
  the live refs the reset/hydration machinery runs on).
- COMMIT-PHASE failure → `transition-failed { recovery: true }`: the
  page enters **explicit blocking recovery** (a non-dismissible dialog;
  reload recovers from durable state) and NEITHER project is claimed
  installed. This is why "move the pointer to the front of the old
  mutation-heavy function" would not have been a fix: the stage's
  inverse split-brain is real, and the protocol answers it by making
  the commit phase no-throw by construction AND by refusing to claim
  any survivor when the guard trips anyway. Note the failure geometry
  is deliberately consistent: the pointer committed to the TARGET
  before the commit phase, so the recovery reload bootstraps the target
  from durable state — the one thing that is never produced is a
  claimed-installed project disagreeing with the persisted pointer.

## Pointer-write discipline

- Successful activation of a different project: exactly ONE pointer
  write, inside the winning install.
- Superseded activation: ZERO writes.
- Re-activation of the already-current project: ZERO writes
  (`{ ok: true, wrote: false }`).
- Import/create records persist without becoming current until their
  installation wins (B12.4 §E, unchanged and re-proven).

## Truthful bootstrap

`bootstrapCurrentProject` now reports `pointerPersisted` — a refused
pointer write during dangling-pointer fallback or first-project creation
is surfaced as a toast ("a reload may open a different project"), never
swallowed. A bootstrap whose project storage is entirely unavailable
throws; the page catches it and enters the blocking activation-recovery
surface instead of fabricating a phantom workspace. (The bootstrap
fallback paths re-resolve deterministically on reload, so an unpersisted
bootstrap pointer is a truthfully-reported degraded state, not a silent
split-brain: the persisted pointer in that state is dangling/absent,
not naming a different live record.)

## Evidence

`b12-5-transactional-activation.test.ts` (11): R2 exact closure
(throwing pointer), silently-dropped write caught by read-back,
prepare-phase failure before any pointer/UI change, commit-phase
blocking recovery (retired non-replaced interlock, refused leases),
pointer-write counts (winner 1 / superseded 0 / re-activation 0),
survivor operability after failure (fresh lease + follow-up activation),
truthful bootstrap, and page source gates pinning the three-phase
structure, the checked pointer result, the recovery routing in the
outcome handler, the guarded bootstrap, the IndexedDB journal store, the
non-dismissible recovery dialog, the PCB no-pointer-write gates, and the
final-act announce ordering.

## Internal adversarial refutation pass (post-implementation)

The internal refutation pass found one MAJOR completeness hole and one
ordering note, both closed before this stage's verdict:

1. **PCB fallback pointer write (major).** `ensureCurrentProjectScope`
   (app/lib/pcb/board-persistence.ts) — reachable when the PCB view
   mounts — checked record existence with the STRICT loader, so a
   salvaged-but-strict-failing current project (a supported production
   state) made it mint a phantom "Untitled project" and write
   `sirkit:currentProjectId` RAW, outside the activation protocol:
   visible project A, persisted pointer at the phantom. It now checks
   existence with the SALVAGE loader (the page's own bootstrap
   semantics) and NEVER writes the pointer; the degenerate no-project
   fallback materializes an inactive record only. `saveCurrentBoard`
   (no production caller) lost its identical minting write. Permanent
   closures: a board-persistence source gate (no pointer writes), a
   behavioral test (existing record honored with zero pointer writes; a
   dangling pointer is never repointed by the PCB stack), and the
   legacy-import fixture re-pinned to prove the save does not repoint.
2. **Announce-toast ordering (note).** The success announcement now runs
   as the commit phase's FINAL act (source-gated), so no later statement
   can fail and contradict an already-shown success toast.
