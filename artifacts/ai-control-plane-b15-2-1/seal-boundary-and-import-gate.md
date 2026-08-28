# B15.2.1 §E — the closed, non-forgeable seal boundary (R21)

## What was wrong

`sealPcbEditProposal` and `assemblePcbEditProposal` were PUBLIC exports of
`sealed-pcb-edit-proposal.ts`, and both accepted a caller-created structural
`CompiledPcbEditForSeal`. A `CompiledPcbEditForSeal` is only a TypeScript
shape — nothing proved the compiler produced it. So a fabricated object with
attacker-computed digests, a matching partial impact, and no minted ids
sealed and verified `ok:true`.

## The closure — three modules

1. **`sealed-pcb-edit-proposal.ts` (public, read-only).** Keeps the types,
   constants, `verifySealedPcbEditProposalIntegrity`, and
   `isPcbEditProposalExpired`. It NO LONGER exports any sealer or assembler.
   The verifier now STRUCTURALLY validates the full nested proposal —
   `validateImpactShape` checks every `BoundedEditImpactReport` key with the
   right type, and the identity fields are type-checked — BEFORE any digest
   is trusted, so a partial impact cannot verify merely because its digest
   matches (§E R21c).

2. **`pcb-edit-proposal-sealer.internal.ts` (module-private raw sealer).**
   Holds `rawSealPcbEditProposal`, which recomputes every certified pin
   (operations digest over the sealed base identity, impact digest,
   candidate/impact equality, minted-id membership) and refuses an
   inconsistent compiled object before minting. It is import-gated.

3. **`pcb-edit-proposal-service.ts` (the ONE high-level entry).**
   `createSealedPcbEditProposal({ payload, board, rules, scope, base,
   … })` runs `compileBoundedPcbEdit` INTERNALLY and seals only that exact
   successful result. There is no parameter for a pre-compiled object, so a
   caller cannot inject fabricated digests — a hostile payload is compiled
   for real (and refuses). `base.pcbRevisionId`/`boardDigest` are DERIVED
   from the board so the operations digest always recomputes at verify time.

## The AST import/export gate

The permanent suite (b15-2-1 §E) uses the B14.4 gate helpers to prove:

- `moduleImportOffenders(files, ".../pcb-edit-proposal-sealer.internal",
  {sealer.internal, service})` is empty — NO production module imports the
  raw sealer except the service (approved importer set of exactly two);
- the public module's source exports no `sealPcbEditProposal`,
  `assemblePcbEditProposal`, or `rawSealPcbEditProposal`;
- a NEGATIVE tripwire: an injected `app/lib/agent/evil.ts` importing the raw
  sealer trips the gate (proves the gate actually fires).

`B15.3` may extend the approved set through the official gate update when the
tool handler becomes a legitimate importer.

## R21 pinned

- the public module exports no raw sealer/assembler (§E R21a);
- the only mint path compiles internally; a hostile payload cannot produce a
  verifying artifact (§E R21b);
- a matching-digest PARTIAL impact does not verify (§E R21c);
- the internal raw sealer refuses an inconsistent compiled object
  (defence in depth, b15-2-core-closure R16b);
- verification remains total on revoked proxies, throwing traps, and cycles
  (b15-2-core-closure R16c).

---

> **SUPERSEDED IN PART (B15.2.2).** The claim that the verifier performs
> "full nested-shape validation" before trusting digests was too strong: it
> validated the impact report and a few identity fields only. `scope`,
> `base`, `actor`, `effectiveActor`, `discovery`, `provenance`, and the
> OPERATIONS were unchecked, so a malformed proposal with a recomputed
> checksum verified. Complete closed validation — exact key sets, types,
> bounds, permitted values, and every operation through the canonical
> bounded parser — now runs BEFORE any digest is recomputed. The import-gate
> content of this document stands, and B15.2.2 adds a standing assertion
> that the approved importer set must NOT grow in B15.3. See
> `../ai-control-plane-b15-2-2/complete-proposal-shape-contract.md`.
