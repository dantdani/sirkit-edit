# B09.2 pre-edit counterexamples (R1–R7)

All seven were reproduced with a transient script (`scripts/_tmp-b092-repro.ts`,
deleted after capture) against the UNMODIFIED B09.1 tree, before any B09.2
edit. Each output below is the defect as observed; each is now closed and
encoded as a permanent regression test in
`app/lib/agent/__tests__/b09-2-closure.test.ts` and
`app/lib/agent/__tests__/b09-2-recovery.test.tsx`.

## R1 — synthetic canonical authority from a substituted empty board

Assembling an agent context with NO board (and separately with a structurally
invalid board) still produced a full `CanonicalProjectState` built over
`createEmptyBoard()` substitution, with a manufactured revision digest.
`buildAgentResourceBundle` sealed it as a **verified/current** canonical
resource envelope while `warnings: 1` was emitted in the same assembly —
authority and warning coexisted.

Observed: `canonicalState !== null`, sealed envelope `authorityStatus:
"verified"`, `warnings: 1`.

Closure: context.ts claims canonical only when the board is supplied AND
validates (and the schematic, if supplied, validates); otherwise
`canonicalState`/`canonicalRevisionDigest` are null and
`buildAgentResourceBundle` throws `CANONICAL_RESOURCE_UNAVAILABLE`.
Test: §A "R1".

## R2 — canonical reads succeeded over the substitute

With the same substituted context, `sirkit.project.canonical-revision-inspect`
through the gateway **succeeded** (`status: "succeeded"`), reporting authority
over a board that was never supplied.

Closure: without canonical state the gateway refuses every canonical read
(`authority_unavailable`); only the narrow schematic-snapshot path serves
`sirkit.schematic.inspect`. Test: §A "R2".

## R3 — authorityStatus tamper undetected

Flipping `authorityStatus` on a sealed envelope from `"verified"` to
`"unverified"` after sealing passed `validateReadResourceBundle` with **zero
failures** — the status participated in neither the content digest nor the
manifest.

Closure: envelope schema v2 folds `authorityStatus` into the content digest
and the manifest entries; the same tamper now yields `corrupt_resource` +
`manifest_mismatch`. Test: §B "R3".

## R4 — deadline was advisory

A provider adapter that ignored the abort signal and resolved 40 ms AFTER a
40 ms run deadline produced a **completed** run: events
`run_started, warning, text_delta, run_completed` — the late result was
consumed and emitted as success.

Closure: loop.ts races every awaited operation against a BOUNDARY sentinel;
late resolutions are discarded, the run fails with `deadline`, exactly one
terminal event is emitted, and late rejections are swallowed (never
unhandled). Test: §C "R4" plus the adversarial set.

## R5 — malformed schemas silently accepted

All four hostile schemas passed `toStrictSchema` without error, being silently
rewritten into something the author never declared:

1. `{ type: "nonsense" }`
2. `required: ["ghost"]` with no such property
3. `items: 42` (non-schema items)
4. `enum: { x: 1 }` (non-array enum)

Closure: `validateSchemaStructure` runs on the SOURCE before conversion and on
the OUTPUT after; all four (plus non-schema anyOf entries, array-without-items,
permissive additionalProperties) throw `STRICT_SCHEMA_UNSUPPORTED`; the source
object is never mutated. Test: §D "R5".

## R6 — weaker duplicate mark validator

For the mark `{ lineageId: "not-a-lineage-format", headSequence: 3,
canonicalStateDigest: "not-a-digest" }`:
`validateSchematicCanonicalMark` → **null (invalid)** but
`isWellFormedProposalScope` → **true** — the proposal boundary had its own
weaker shape check and accepted marks the canonical validator refuses.

Closure: `isWellFormedProposalScope` delegates to
`validateSchematicCanonicalMark` (exact keys, `lin1-`/`eng1-` formats,
nonnegative safe-integer sequence) plus exact scope keys and a strict id
pattern. Test: §E "R6".

## R7 — capability not checked against the effective actor

A context whose ACTOR had `grantedCapabilities: []` (while discovery still
carried the grants) **sealed a proposal successfully** — the capability gate
read discovery, not the effective actor, and actor/discovery divergence was
never detected.

Closure: `ProposalInvocationService` verifies context integrity
(`verifyAgentContextIntegrity`: actor id/role/capability-set vs discovery,
tenant/project/branch, revision anchor) and the EFFECTIVE actor's capability;
divergence refuses with `context_integrity`, missing capability with
`unauthorized`. Test: §E "R7" + divergence matrix.
