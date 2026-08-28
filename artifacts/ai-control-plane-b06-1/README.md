# AI Control Plane — B06.1: Proposal Boundary, Authority Closure, Label-Safe Replacement, Durable Head

> **Corrected by B06.2** (`artifacts/ai-control-plane-b06-2/`): independent
> review found four boundaries this record overstated — authority was
> enforced only by the planner (now: executor-level runtime grants),
> projection marks were trusted by sequence alone (now: validated against
> durable log positions with conflict preservation), hydration left editing
> enabled during unresolved recovery (now: lifecycle gating + adoption
> handshake + serialized delete/replacement planning), and construction fell
> back silently to in-memory storage without IndexedDB (now: `unavailable`,
> fail-closed, corruption quarantined).

B06.1 closes four verified gaps between what the B06 artifacts claimed and
what the runtime actually did. Every closure below is a RUNTIME change with
tests; the corrected B06 documents note what changed.

Companion documents:

- `proposal-apply-contract.md` — sealed tier-1 proposals, all-or-nothing
  compilation, explicit human apply, cancel/stale/altered behavior.
- `authority-consumption-contract.md` — the branded verified-authority
  adapter over B05.1 resource bundles; caller assertions are never authority.
- `schematic-durability-contract.md` — the durable IndexedDB head,
  projection reconciliation, recovery, and serialized planning.
- `replacement-connectivity-fixtures.json` — kernel-generated label-move /
  dropped-label / authority-consumption fixtures with proven exact
  round-trips; regenerate with
  `npx tsx scripts/generate-b06-schematic-artifacts.ts` (CI-pinned by
  §3 of the B06.1 test suite).

## The four gaps and their closures

**A. Provider output auto-applied (and theory renames mutated state via
`setComponents`).** `page.tsx` compiled `/api/schematic/edit` responses and
executed them immediately, then applied `legacyTheoryRenames` directly.
Now: receiving provider output mutates nothing — the response compiles
all-or-nothing into a deep-frozen `SealedTier1Proposal` (id digest, pinned
base schematic digest, exact operations + operations digest, impacts,
provenance, expiry) shown in a review dialog. Only the explicit
“Apply exact proposal” button executes, re-verifying every digest at the
dialog AND inside the serialized session queue. Cancel changes nothing;
stale/altered/expired proposals are rejected. The `legacyTheoryRenames`
runtime path is deleted (structural test); a proposed theory rename is an
unsupported operation that blocks the whole proposal. Any blocker refuses
the complete proposal — the valid subset never executes, and a rejected
canonical transaction is never followed by another mutation.

**B. One registry record hid two behaviors.** Split:
`schematic.edit-tier1-propose` (kind `propose`, owns `/api/schematic/edit`,
NO mutation authority) and `schematic.edit-tier1-apply` (kind `destructive`,
UI apply handler only, canonical executor authority, explicit human
approval, no route, no provider/discovery/OpenAI/Anthropic/chat/MCP
exposure). B01 matrices + route coverage regenerated and CI-pinned
(72 action records, 137 routes).

**C. Caller-supplied `verified-atomic` was accepted.** The planner now
accepts only `{status:"catalog-unverified"}` or a branded
`VerifiedReplacementAuthority` minted by the internal adapter that consumes
a VALIDATED B05.1 resource bundle (manifest/envelope digests, scope,
schematic revision, freshness, verified-exact inspection, permitted target
part, atomic-revision match). Plain status objects, forged identifiers, and
structural clones are refused; consumed resource ids+digests are recorded in
the plan and the durable transaction record. No production
verified-authority flow exists yet, so verified replacement stays
UNAVAILABLE from the UI rather than trusting an assertion (the BOM swap
remains explicitly catalog-unverified and clears stale authority).

**D. Labels counted as connections but never moved.** Replacement now plans
and executes versioned `netLabelMoves` (label id + expected `from` position
→ mapped position) atomically with identity and wire-endpoint moves,
records exact inverse moves (undo is digest-identical), validates the
label's current coordinate as a hard precondition, refuses ambiguous
stacked-pin moves, and surfaces stranded labels on acknowledged drops. A
label-only connection is reported preserved ONLY because its label move is
part of the atomic operation.

**E. (From the same evidence list) The "durable" session was in-memory.**
`SchematicEditorSession` now persists through
`BrowserIndexedDbProjectStore("sirkit-schematic-canonical-v1")`; in-memory
stores are test-only. One authoritative head: snapshot/revision/log survive
reload; UI projects only after the durable commit; pre-commit failure
changes nothing; committed-but-unacknowledged transactions recover by
idempotent retry; SavedProject is a projection ordered by its atomic
`schematicCanonicalMark` — a stale projection can never overwrite a newer
canonical head (the head is projected back out); corrupt envelopes fail
closed with a user-visible recovery; projects are isolated per store key +
lineage.

**F. Rapid commands could rebase onto an old React snapshot.** The session
now recognizes known canonical ancestor digests: a merely-behind caller
executes against the current head instead of rebasing backwards, so two
rapid commands serialize and neither edit is lost (tested).

## Verification (2026-08-06, repo root)

```
npx tsc --noEmit                                                   # PASS (0 errors)
npx eslint <changed files>                                         # PASS for all B06.1 code (page.tsx keeps its 17 pre-existing findings in untouched legacy regions)
npx tsx scripts/generate-action-toolability-matrix.ts              # 72 actions, 137 routes, fingerprint regenerated
npx tsx scripts/generate-b06-schematic-artifacts.ts                # B06 replay + B06.1 connectivity fixtures regenerated
npx vitest run app/lib/engineering/__tests__/b06-1-proposal-authority-durability.test.ts   # PASS (25 tests)
npx vitest run app/lib/engineering/__tests__/b06-schematic-mutations.test.ts               # PASS (32 tests)
npx vitest run app/lib/engineering app/lib/project \
  app/lib/physical-binding app/lib/pcb-sync app/lib/schematic-compiler                     # see final stage report
npx vitest run                                                     # see final stage report (timing flakes isolated)
```

## Remaining limitations

- Verified-atomic replacement has no production UI flow (deliberate — see
  authority contract). Wiring one requires a durable component-authority
  bundle source plus an approved composition point.
- Undo reconciliation of PRE-reload transactions uses the rebase rule (the
  in-memory link table does not persist); snapshot undo/redo is unaffected.
- Proposal expiry/creation times use wall-clock `Date.now()` in the page
  (deterministic `now` injection is used everywhere below the UI).
- The legacy paths documented in the B06 migration matrix (wire graph tools,
  drags, generate/import lifecycle, theory rename) remain out of scope until
  the wire-geometry/stable-identity stage.
