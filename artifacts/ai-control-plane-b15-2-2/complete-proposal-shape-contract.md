# B15.2.2 §B — complete closed proposal validation

`validateProposalShape` in `sealed-pcb-edit-proposal.ts`, called FIRST in
`verifyInner` — before any digest is recomputed or trusted.

## What was wrong

Verification checked the top-level key set, the tool identity, the digests,
the TTL window, and the impact's field shapes — but never the types or
permitted values of `scope`, `base`, `actor`, `effectiveActor`,
`discovery`, `provenance`, or the OPERATIONS. Any body whose public
checksum was recomputed passed, including `scope: {tenantId: 7, projectId:
null, branchId: [], boardInstanceId: {}}` and
`operations: [{kind: "evil_operation", …}]` (R23).

## What is validated now

Exact key sets (no unknown keys at ANY authoritative nested boundary),
types, bounds, and permitted values for:

- `proposalId` (bounded identifier, `pprop-` prefix) and `nonce`;
- `scope` — all four fields bounded identifiers;
- `base` — `canonicalResource {resourceId, contentDigest}`,
  `pcbRevisionId`, `boardDigest`, `historyHead {sequence: non-negative safe
  integer, label: null | bounded string}`, `lineageId`;
- `intent` + `operations` — **through the canonical
  `parseBoundedEditRequest`**, so every sealed operation is proven to be a
  SUPPORTED operation, and the sealed array must equal its canonical
  normalized form (not merely "is an array");
- `operationsDigest` / `candidateDigest` / `impactDigest` — bounded digest
  strings;
- `mintedObjectIds` — bounded array, well-formed identifiers, **unique**;
- `impact` — the exact schema literal and closed nested shapes
  (`validateImpactShape`);
- `tool` — must be the ONE identity permitted to seal;
- `actor` / `effectiveActor` — exact keys, bounded identifiers;
- `discovery` / `provenance` — exact keys, bounded strings, `runId` null or
  bounded identifier;
- `createdAt` / `expiresAt` — finite non-negative safe integers;
- `approvalTier` — the exact permitted literal.

Totality is preserved: the whole verifier remains wrapped in a fail-closed
exception boundary, and `isPlainRecord` rejects exotic prototypes, so
revoked proxies, throwing getters, cycles, and hostile arrays refuse rather
than throw (§B R23e).

Digest recomputation happens **only after** structural validation succeeds.

## The architectural statement is unchanged

The whole-body proposal digest is an **integrity checksum** — it proves the
body was not altered after sealing. It is **not authenticity and not
mutation authority**. Human approval capability and live reauthorization
remain the authority. This closure fixes a STRUCTURAL hole; it does not turn
the checksum into a signature.

## Evidence

All three R23 artifacts refuse with recomputed checksums (§B R23a–R23c),
plus unknown nested keys, out-of-range numbers, duplicate minted ids
(§B R23d), totality (§B R23e), and — importantly — the genuine proposal
still verifies, so the validation is not over-strict (§B R23f).

---

## SUPERSESSION NOTE (B15.2.3, 2026-08-20)

The claim above that `validateImpactShape` enforced "the exact schema
literal and closed nested shapes" was an OVERSTATEMENT, proven false in the
dangerous direction by R24: the impact check accepted ANY string as
`impact.schema` (not the exact compile-schema literal), accepted UNKNOWN
keys at every impact nested boundary, accepted ANY JavaScript number (NaN,
±Infinity, fractions, negatives), and never bounded arrays/strings or
checked the producer's canonical order and arithmetic. Three mutated impact
certificates with recomputed public checksums verified `ok:true`
(R24a/b/c, reproduced verbatim in
`../ai-control-plane-b15-2-3/pre-edit-counterexamples.md`).

B15.2.3 replaced it with the closed impact-certificate contract aligned
with the authoritative producer — see
`../ai-control-plane-b15-2-3/closed-impact-contract.md`. The rest of this
document (scope/base/actor/discovery/provenance/operations validation and
the architectural statement) stands as written.
