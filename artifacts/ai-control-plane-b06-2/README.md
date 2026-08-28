# AI Control Plane — B06.2: Executor Authority Enforcement and Hydration Consistency Closure

B06.2 closes the four runtime boundaries independent review found unclosed
after B06.1. Every closure is enforced in runtime code at the actual
boundary, with direct bypass tests.

Companion documents:

- `executor-authority-gate.md` — runtime grants and the canonical-executor
  authority gate (Gap 1).
- `projection-reconciliation-contract.md` — mark validation and the
  five-case decision table (Gap 2).
- `hydration-readiness-contract.md` — the session lifecycle, adoption
  handshake, and serialized delete/replacement planning (Gap 3).
- `recovery-fixtures.json` — decision-table evidence generated from the real
  `decideProjectionReconciliation`; regenerate with
  `npx tsx scripts/generate-b06-schematic-artifacts.ts` (CI-pinned).

## Gap closures

**1 — Authority enforced at the canonical executor.** The planner's
`instanceof` check remains, but the invariant now lives in
`CanonicalExecutor.execute`: any initial `schematic_replace_component`
installing atomic-authority fields must present a registered, non-forgeable
runtime grant (minted only by `consumeReplacementAuthority`) matching scope,
current canonical revision, component, target part, every installed field,
and consumed-resource records. Grants are single-use (retired on durable
commit); serialized operation data — including caller-supplied
`consumedAuthorityResources` and copied grant ids — can never bootstrap
authority; idempotent retries and durable undo/redo replay without live
grants (durable-record-sourced). Catalog-unverified replacement carries no
atomic fields and clears stale ones. Verified replacement remains
UNAVAILABLE from any production UI flow (no grant path is wired); the gate
plus the adapter define the only path a future flow may use.

**2 — Projection marks validated against durable lineage.**
`schematicCanonicalMark` is structurally validated at load (no blind cast)
and verified against the envelope's actual head/log digests. The explicit
decision table: resume / rebase-local-newer (mark exactly matches head) /
recover-canonical (verified-older or untrusted, projection preserved) /
conflict (mark ahead — preserve both, explicit choice) / conflict
(wrong-digest, unverifiable position — fail closed). Conflicts disable
editing and offer “keep local” (envelope quarantined) or “use canonical”
(projection saved to `schematicProjectionConflict`).

**3 — Hydration/edit race closed.** Lifecycle
`unopened → hydrating → ready | conflicted | unavailable`; mutations are
structurally rejected unless `ready` (checked synchronously at call time);
`recovered-canonical` requires the `confirmAdoption` handshake before
readiness; the stale pre-recovery projection digest is permanently refused
(`STALE_PRE_RECOVERY_SNAPSHOT`) so it can never rebase canonical backward;
`headMark()` is null unless ready (autosave cannot mis-pair state and mark);
`dispose()` invalidates the previous session's queued commands and
callbacks; pending AI proposals and recovery dialogs are discarded on
hydration/switch. Delete and BOM-replacement plans are now built inside the
serialized queue against the canonical head (tested with rapid pairs).

**4 — No silent volatile persistence.** Production store resolution returns
the IndexedDB store or NULL — never in-memory (explicit test injection
only). Without durable storage the session is `unavailable`: mutations are
disabled with a truthful durability error; no “edits still work” claims. A
corrupt envelope is never overwritten automatically: the session goes
`conflicted`, the raw value stays intact, and only the explicit
“Start fresh (old history preserved)” action quarantines it
(`preserveEnvelope` on both stores — raw copy, invisible to `load`) before
a replacement lineage starts. Automatic rebases also quarantine the prior
envelope.

## Verification (2026-08-06, repo root)

```
npx tsc --noEmit                                              # PASS (0 errors)
npx eslint <changed files>                                    # PASS for all B06.2 code (page.tsx keeps its pre-existing findings in untouched legacy regions)
npx tsx scripts/generate-b06-schematic-artifacts.ts           # B06 + B06.1 + B06.2 fixtures regenerated
npx vitest run app/lib/engineering/__tests__/b06-2-authority-hydration.test.ts   # PASS (20 tests, mandatory areas 1–25)
npx vitest run app/lib/engineering                            # PASS (266 tests — B01–B06.2 incl. regenerated-fixture pins)
npx vitest run app/lib/engineering app/lib/project \
  app/lib/physical-binding app/lib/pcb-sync app/lib/schematic-compiler         # see final stage report
npx vitest run                                                # see final stage report (timing flakes isolated if any)
```

Mandatory test 26 (B01–B06.1 suites green) is the engineering/project/
physical-binding/pcb-sync/schematic-compiler run above.

## Remaining limitations

- The authority gate lives at the canonical executor (the supported
  execution boundary); in-process code with direct transaction-service
  access sits below the supported surface, as with every B03.x boundary.
- Grants are head-revision-pinned: an intervening commit between consuming
  authority and applying the replacement requires re-consumption
  (fail-closed by design).
- Conflict resolution and corrupt-history recovery are per-project dialogs;
  quarantined envelopes are recoverable via the store but have no browsing
  UI yet.
- Undo reconciliation of pre-reload transactions still follows the
  documented rebase rule (in-memory link table).
