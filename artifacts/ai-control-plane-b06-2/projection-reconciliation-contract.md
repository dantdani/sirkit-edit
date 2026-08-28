# B06.2 — Projection Reconciliation Contract

> **Corrected by B06.3**
> (`artifacts/ai-control-plane-b06-3/lineage-authentication-contract.md`):
> this record claimed foreign-lineage marks were already rejected, but the
> table below never compared `mark.lineageId` with the durable envelope
> lineage (which store commits DROPPED at the time) — a foreign mark whose
> sequence and digest equaled the envelope head returned
> `rebase-local-newer`, and `resumeHead()` could adopt a mark's lineage.
> B06.3 makes the envelope the exclusive, integrity-bound lineage authority,
> authenticates every mark against it, migrates legacy envelopes, and turns
> the missed case into an explicit conflict.

Replaces the B06.1 rule `mark.headSequence >= envelope.headSequence`, which
let an unverified high-sequence marker make an arbitrary projection
overwrite the durable canonical head.

## Mark validation (untrusted input)

`schematicCanonicalMark` is validated STRUCTURALLY at both boundaries — the
SavedProject loader (`lib/persistence.ts`, no blind cast of arbitrary JSON)
and the session (`validateSchematicCanonicalMark` in
`schematic-projection.ts`):

- object shape; `lineageId` matching `lin1-[0-9a-f]{8,}`;
- `headSequence` a non-negative safe integer;
- `canonicalStateDigest` matching `eng1-[0-9a-f]{8,}`.

Malformed marks are DROPPED — downgraded to untrusted projection data, never
a lever over the canonical head.

## Position verification

A validated mark still proves nothing by itself. It is verified against the
durable envelope's ACTUAL history: `envelopeSequenceDigests` extracts the
canonical digest at every committed sequence (genesis =
`transactionLog[0].transaction.baseRevision`; sequence k =
`transactionLog[k-1].resultingRevision`), and the mark must name the exact
digest at its claimed position. ~~A foreign-lineage or fabricated mark
cannot.~~ (B06.3 correction: position verification alone did NOT stop a
foreign mark that copied the head's sequence and digest — lineage
authentication was added in B06.3.)

## Decision table (`decideProjectionReconciliation`, pure, evidence-pinned)

| # | Condition | Decision |
|---|---|---|
| 1 | projection digest == canonical head projection | **resume** head |
| 2 | mark == exact current head (sequence AND digest), projection differs | **rebase-local-newer** — provably later legacy edits; documented rebase path (prior envelope quarantined) |
| 3 | mark verifiably names an OLDER log position | **recover-canonical** (verified-older-mark) — head wins; projection preserved as backup; UI adoption handshake required |
| — | mark absent/malformed, projection differs | **recover-canonical** (untrusted-projection) — an unverifiable projection cannot outrank durable history; it is preserved, never adopted |
| 4 | mark sequence AHEAD of the envelope | **conflict** (mark-ahead-of-envelope) — store rollback or fabrication; preserve BOTH, explicit recovery required, overwrite neither |
| 5 | same sequence/wrong digest, or older sequence at no recorded position | **conflict** (mark-digest-mismatch / mark-position-unverifiable) — divergent or foreign lineage; fail closed, canonical head intact |

## Conflict handling

A `projection-conflict` puts the session in `conflicted`: canonical
mutations are structurally rejected, the projection stays visible, and the
UI offers an explicit choice:

- **Keep my local schematic** — the durable envelope is quarantined
  (recoverable), then a fresh lineage starts from the projection.
- **Use canonical history** — the projection is saved to
  `SavedProject.schematicProjectionConflict` first, then the canonical state
  is adopted through the readiness handshake.

Nothing is auto-overwritten in either direction.

Evidence: `recovery-fixtures.json` (generated from the same pure decision
function; CI-pinned). Tests: `__tests__/b06-2-authority-hydration.test.ts`
§2 and the updated B06.1 §4.
