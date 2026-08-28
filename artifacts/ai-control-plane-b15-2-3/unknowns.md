# B15.2.3 — unknowns and honest limits

1. **The array/string ceilings are producer-DERIVED, with two judgment
   calls.** `maxArrayEntries = 4096` is exact for the largest derivable
   producer path (`ruleChanges`: 16 ops × 64 net ids × 4 rule fields). Two
   paths have no compile-time constant bound: `affectedNetIds` via a
   footprint operation's pad nets (bounded by the footprint's distinct nets
   on the LIVE board), and `resolvedViolationIds` (bounded by pre-existing
   DRC errors a 16-op edit resolves). A genuine board whose single footprint
   spans >4096 distinct nets, or a 16-op edit resolving >4096 pre-existing
   DRC errors, would refuse verification — judged beyond any physical
   artifact, but recorded here rather than assumed away. If one ever
   appears, the ceiling must be re-derived from the producer, not deleted.

2. **`affectedLayers` board membership is NOT verified here** (INFERRED
   safe): verification is board-free, so entries are held to the bounded
   identifier contract only; membership is enforced at compile time and
   re-established at the serialized apply position, which recompiles from
   the live board. Likewise layer identifiers sourced from board data
   (`existing.layer`) are assumed to satisfy the identifier pattern — every
   operation-sourced layer provably does (parser contract), and a genuine
   `set_net_class_rule`/`update_track` fixture passes in-suite.

3. **TOCTOU on proxy-backed impacts is refusal-only, not prevention.** The
   validator snapshots arrays before checking entries, but the LATER digest
   recomputation reads the live object again; a proxy that answers
   differently across reads can only cause a digest mismatch (refusal) or
   must behave like plain data (validated). What it can never do is make an
   UNVALIDATED shape verify. Downstream authority never rests on this
   object: the apply path recompiles and byte-matches digests.

4. **`delta === afterPercent − beforePercent` relies on IEEE-754
   determinism** (CONFIRMED sound): the producer computes exactly this
   expression on exactly these operands, and IEEE double subtraction is
   deterministic across conforming engines, so the verifier's recomputation
   is bit-identical. Documented in the module.

5. **Percent integrality is deliberately NOT required.** The producer emits
   `Math.round(x·1000)/10` — one-decimal values like 66.7. Requiring
   integers would refuse genuine artifacts; requiring exact one-decimal
   representability would over-fit float representation. Finite ∈ [0,100]
   is the honest contract.

6. **Everything downstream of the sealed core remains unbuilt** (H–K:
   registry exposure, gateway/loop, `pcb_proposal_ready`, review UI,
   approval/apply, durability/recovery). The tool stays unexposed at
   exactly 11 agent tools; the raw-sealer allowlist is unchanged at two
   modules and must not grow in B15.3.
