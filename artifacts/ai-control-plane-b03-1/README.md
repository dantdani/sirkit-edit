# B03.1 — B03 Hardening: Verified Replay, Trusted UI Channel, Exact-Head Reload

Closes the three gaps B03 verification found, without migrating anything new
and without touching agent tools, providers, prompts, schemas, or
manufacturing-release authority.

## 1. Canonical undo/redo cannot be forged

`pcb.undo-redo-canonical` is now rejected by generic
`CanonicalExecutor.execute()` (`unverified_replay`). The only execution path
is `CanonicalExecutor.executeUndoRedo(request)`: the request references a
durable transaction (id + direction + lineage identity + expected head +
expected semantic source/result digests + unique idempotency key) and can
never carry operations. The EXECUTOR loads the durable record, verifies
scope, position, and digests — including a pure dry-run proving the record's
own inverse/forward operations reproduce the expected state — before any
mutation, then applies those operations as a new provenance-linked audited
transaction. Verification runs in the SEMANTIC state domain
(`semanticStateDigest`, derived zone-fill lifecycle normalized), the
operation model's exact-invertible domain; records without semantic digests
fail closed to the documented rebase rule. Durable change sets now record
`baseSemanticStateDigest`/`resultSemanticStateDigest` at creation.

## 2. Trusted UI authority cannot be caller-spoofed

The B03 rule "actorKind human + provenance ui ⇒ destructive approval" is
gone. Destructive-tier approval now requires EITHER an independent
`approve_proposal` approval (B02 rule — the only path for api/ai/worker and
any channel-less executor) OR the `InteractiveUiChannel` capability injected
at executor construction by the editor-session composition. The channel is a
branded, non-serializable class instance scoped to shipped reversible UI
behavior; caller-supplied fields can only narrow the grant. Interactive
track/via/zone delete behavior is unchanged and remains undoable. Release
tier stays categorically blocked. See `security-boundary.md`.

## 3. Reload restores the exact canonical head

Every committed canonical transaction mirrors the full integrity-chained
persistence envelope to a durable store (IndexedDB in the browser).
`PcbCanonicalHead` v2 adds the durable `lineageId`. On reload, a
seven-step verification (envelope integrity chain, tenant/project/branch,
claim↔envelope head equality, board lineage digest, board semantic revision)
either reopens the transaction service AT THE EXACT HEAD — same sequence,
head transaction, digest, and full durable log, with the lineage continuing —
or falls closed to a fresh sequence-zero lineage that is never described as a
continuation. Stale, corrupt, partial, foreign, and mismatched envelopes are
rejected with recorded reasons; legacy projects open unchanged and opening
never writes persistence. See `head-persistence-contract.md`.

## Verification

`npx vitest run app/lib/engineering/__tests__/b03-1-hardening.test.ts` — 20
deterministic tests covering the required negatives: forged generic replay,
missing/cross-project/cross-lineage references, wrong direction/position,
smuggled replay operations, digest mismatches, duplicate replay idempotency,
forged human/ui fields, api/ai/worker approval gating, channel-scoped delete,
release-tier blocking, replay rollback atomicity, exact-head restoration,
corrupt/foreign/mismatched envelope rejection, legacy compatibility, and
channel non-serializability. B01 registry gates (matrices regenerated), B02
kernel, B03 adapter, and the full repo suite remain green.
