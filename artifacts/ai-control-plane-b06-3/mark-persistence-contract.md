# B06.3 — Mark Persistence and Metadata Sanitization Contract

## Lifecycle-aware mark persistence

SavedProject patches MERGE: omitting `schematicCanonicalMark` from a save
silently KEEPS whatever mark was stored before. B06.2's autosave omitted the
mark whenever `headMark()` was null — so a projection saved during
hydration/conflict/unavailability could remain paired with a mark it never
re-earned. B06.3 makes the patch explicit per session lifecycle
(`schematicMarkPatch`, pure, evidence-pinned):

| Lifecycle | Patch | Effect |
|---|---|---|
| `ready` | `{schematicCanonicalMark: headMark}` | the EXACT state and EXACT head mark save together in one write |
| `hydrating` / `conflicted` / `unavailable` | `{schematicCanonicalMark: undefined}` | the active mark is DELETED — a state saved in these phases has adopted no canonical head and must not claim one |
| `unopened` | `{}` | untouched — no session has judged the head yet |

(`saveProjectFields` deletes keys whose patch value is `undefined`.) Prior
marks survive only as clearly untrusted evidence — e.g. inside a preserved
`schematicProjectionConflict` record — never as an active adoption claim.

## Metadata sanitization (both loaders, schema-exact)

`schematicCanonicalMark` and `schematicProjectionConflict` are UNTRUSTED
JSON. The strict loader (`loadProject`) and the salvage loader
(`loadProjectSalvaged`) apply the SAME validation (tested for equivalence,
and for agreement with the engineering-side
`validateSchematicCanonicalMark`):

- **Mark**: exactly `{lineageId, headSequence, canonicalStateDigest}` — no
  extra fields; `lin1-[0-9a-f]{8,}` lineage; non-negative safe-integer
  sequence (negative, fractional, infinite, unsafe, and non-numeric all
  rejected); `eng1-[0-9a-f]{8,}` digest. Anything else is DROPPED
  (downgraded to untrusted projection data), never cast to the trusted type.
- **Projection-conflict record**: exactly `{state, reason, at}`; `state`
  must be structurally a schematic state (component/wire arrays, optional
  kicad/label arrays); non-empty `reason`; finite numeric `at`. Malformed
  records are dropped — arbitrary JSON can never become recovery authority.

Tests: `app/lib/project/__tests__/b06-3-mark-sanitization.test.tsx`
(mandatory tests 7–13, including 12 malformed-mark variants across both
loaders).
