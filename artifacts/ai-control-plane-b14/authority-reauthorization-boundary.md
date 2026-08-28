# B14 §E — the reauthorization boundary

> **SUPERSEDED IN PART by B14.1** (see `../ai-control-plane-b14-1/`): the
> apply input's `reauthorize` was a STRUCTURAL interface any object could
> satisfy — an exact stale byte copy committed with zero server contact —
> and this document's "derives authority from the AUTHENTICATED server
> scope" claim was false (no authenticated server session exists; the
> endpoint read body scope). B14.1 replaces the seam with the branded
> one-shot `ReplacementReauthorizationChannel` (real same-origin transport,
> no injection) and an honest server-derived local scope boundary. Digest
> byte-match equality is CONTENT validation only — it never authenticated
> provenance. Historical text below is preserved unmodified.


## Approval-time sequence (what one Apply click does)

1. Capture the proposal artifact EXACTLY once (bounded, closed keys).
2. Authenticate its complete identity (`verifySealedReplacementProposalIntegrity`
   + whole-body digest) → `identityKey` (`sirkit.approved-replacement-identity.v1`).
3. Live authority: ready session, `stillCurrent()`, non-retired B12 interlock,
   live scope+lineage equal the sealed scope.
4. One-shot claim on the SHARED `ApprovedMutationRegistry`.
5. Durable journal + `durableIdempotencyEvidence` dispositions (B12.3–B12.5
   semantics — already-applied returns the ORIGINAL receipt only under full
   linkage; recovery-required otherwise).
6. Inside the serialized gateway at the head: currency verification →
   **fresh server-owned authority** via the reauthorization adapter →
   **published current/target pin facts re-resolved** → the plan is
   **RECOMPILED from the current canonical schematic by the SAME assembler**
   → the recompiled `operationDigest` and `impactDigest` must BYTE-MATCH the
   reviewed proposal (this also proves the authority resource and exact
   target remain valid: the deterministic grant id — over scope, canonical
   revision, derived target assets, and consumed resource digests —
   participates in the operation) → a FRESH runtime
   `VerifiedReplacementAuthority` is minted and retained →
   `journal.prepare` → exactly ONE `schematic.replace-component` canonical
   transaction (`idempotencyKey` = proposalId, chain-protected receipt
   commitment in `provenanceCandidateId`, head/base preconditions re-checked
   in the session queue, the EXECUTOR verifies the registered branded grant
   and retires it on acceptance) → postconditions → `markCommitted`.
7. Adoption through the existing coordinator → `markAdopted` → receipt →
   `finalizeReceipt` BEFORE claiming verified success.
8. The grant is retired on EVERY terminal path (`finally`); failure paths
   release or poison per B12 semantics.

## The same-origin endpoint (`/api/replacement-authority`)

READ/PROVE ONLY — it executes no command, opens no session, writes nothing.

- Derives authority from the AUTHENTICATED server scope via the B13.2
  resolver + loader (full-scope, fail-closed) and the cancellable pin reads
  (request-abort + deadline settled).
- REFUSES browser asset identities BY NAME (unknown body keys 400). The
  TARGET revision is derived server-side from the durable record's
  exactAuthority; the only browser-supplied identifier is
  `currentAtomicPartRevisionId` — a published-facts LOOKUP KEY whose result
  is validated against the sealed proposal by the recompile byte-match.
- Returns ONLY the allowlisted bounded result
  `{ok, records, candidates, currentPinFacts, targetPinFacts}` (asserted
  key-exact in tests); 503 fail-closed without a durable source.
- Only the PRIVATE trusted UI adapter
  ([replacement-reauthorization.ts](../../app/lib/project/replacement-reauthorization.ts))
  turns a response into the runtime-capability path; provider/model code has
  no route to it (the agent toolset carries no such tool, and the gateway
  refuses every non-read/propose class).

## Why forged responses cannot authorize

The response is DATA. A forged/drifted response changes the fresh records or
pin facts → the recompiled plan/grant differ → the operation/impact digests
no longer byte-match the reviewed artifact → `verification-failed`, zero
mutation (tests 31–33). A "branded-looking" JSON grant is inert: the planner
requires `instanceof VerifiedReplacementAuthority` and the executor requires
the REGISTERED instance (R5/R6).
