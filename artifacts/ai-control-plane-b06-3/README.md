# AI Control Plane — B06.3: Lineage Authentication, Mark Persistence, and Quarantine Atomicity

B06.3 closes the boundaries independent review found unclosed after B06.2:
projection marks were never authenticated against the durable lineage,
`resumeHead()` could adopt a mark's lineage, non-ready autosaves could leave
stale marks in place, and quarantine failures were swallowed while the
primary envelope was overwritten anyway.

Companion documents:

- `lineage-authentication-contract.md` — envelope-exclusive lineage
  authority, the authenticated decision table, and legacy migration.
- `mark-persistence-contract.md` — lifecycle-aware mark persistence and
  schema-exact metadata sanitization in BOTH SavedProject loaders.
- `quarantine-atomicity-contract.md` — mandatory quarantine-before-overwrite
  with actionable failure behavior.
- `lineage-recovery-fixtures.json` — decision-table + mark-persistence
  evidence generated from the real implementation; regenerate with
  `npx tsx scripts/generate-b06-schematic-artifacts.ts` (CI-pinned).

## What changed (runtime)

1. **The durable envelope is the exclusive lineage authority.** Store
   commits carry `lineageId` forward (it previously vanished on the first
   commit — the root cause of mark-based lineage selection);
   `validatePersistenceEnvelope` rejects malformed lineages and the digest
   binds them; `decideProjectionReconciliation` takes the validated envelope
   lineage and authenticates every mark against it; `resumeHead(envelope)`
   no longer accepts a mark. The exact missed case — foreign lineage, mark
   sequence AND digest equal to the envelope head, differing projection —
   now returns `conflict (foreign-lineage-mark)`; a head-equal projection
   with a foreign mark resumes on the envelope lineage with the mark
   discarded and the mismatch recorded.
2. **Legacy envelopes migrate deterministically and durably** (lineage
   derived from the envelope's own genesis, prior value quarantined first,
   `b06.3-lineage-backfill` recorded, stable across reloads; marks play no
   part).
3. **Both SavedProject loaders sanitize schematic metadata schema-exactly**
   (marks: exact three fields, lineage/digest formats, safe-integer
   sequence; projection-conflict records: exact shape with a structurally
   plausible state) — arbitrary JSON never becomes a trusted mark or
   recovery authority.
4. **Autosave marks follow the session lifecycle** (`schematicMarkPatch`):
   ready saves the exact state+mark pair; hydrating/conflicted/unavailable
   explicitly CLEAR the active mark (merge semantics made omission unsafe);
   unopened leaves storage untouched.
5. **Quarantine success is mandatory before any envelope overwrite** —
   rebases, conflict resolutions, corrupt-history recovery, and migration
   all abort with the primary untouched when preservation fails; the
   recovery dialog stays actionable with truthful messaging and safe retry.

## Verification (2026-08-06, repo root)

```
npx tsc --noEmit                                              # PASS (0 errors)
npx eslint <changed files>                                    # PASS for all B06.3 code (page.tsx keeps its pre-existing legacy-region findings)
npx tsx scripts/generate-b06-schematic-artifacts.ts           # B06/B06.1/B06.2/B06.3 fixtures regenerated
npx vitest run app/lib/engineering/__tests__/b06-3-lineage-quarantine.test.ts \
  app/lib/project/__tests__/b06-3-mark-sanitization.test.tsx  # PASS (14 tests, mandatory areas 1–17)
npx vitest run app/lib/engineering app/lib/project \
  app/lib/physical-binding app/lib/pcb-sync app/lib/schematic-compiler   # see final stage report (mandatory test 18)
npx vitest run                                                # see final stage report
```

## Remaining limitations

- Lineage migration timestamps (`completedAt`) are wall-clock; the derived
  lineage itself is deterministic.
- Quarantined envelopes remain store-level artifacts without a browsing UI.
- The defensive `lineage-unverifiable` decision branch is unreachable in
  production (migration always runs first) and downgrades the mark rather
  than conflicting — documented choice.
