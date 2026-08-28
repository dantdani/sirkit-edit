# B16.0.6 — Superseded claims (nothing deleted)

B16.0.5's artifacts remain on disk; the claims below are corrected here.

## Supersedes B16.0.5 "the analyzer is conservative / fail-closed"

- **B16.0.5 said** (`unknowns-and-owner-decisions.md`): "The analyzer is a
  conservative, fail-closed static analysis … it cannot newly accept a hazard it
  modeled."
- **Independent verification proved otherwise**: it accepted a bare object
  negation (R1), an unawaited inline boundary (R2), forged/name-trusted readers
  (R3/R4), and it MISSED assignment aliases, body-stream forwarding, returned
  aliases, and any helper chain past depth four (R5–R8) — silently returning a
  CLEAN verdict at its depth limit and on unresolved flow. It was **fail-open**,
  not fail-closed.
- **B16.0.6 says**: the analyzer is now genuinely fail-closed for the modeled
  hazards — a boundary whose contract cannot be established is rejected, a sink
  is canonical only by exact provenance, request flow is enforced to a fixed
  point with cycles and unresolved flows rejected, and there is no traversal
  limit that can return clean. Its real guarantees are stated in
  [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md).

## Supersedes B16.0.5 "any `readBounded…` name is canonical"

- **B16.0.5** trusted `/^readBounded/`, `/^scoped…Json$/`, and bare matching
  identifiers as canonical readers.
- **B16.0.6** deletes all three. A canonical sink resolves to an exact module +
  exported symbol + original imported name; a local or non-canonically-imported
  function of the same name is rejected
  ([canonical-reader-provenance.md](canonical-reader-provenance.md)).

## Supersedes B16.0.5 "depth-four traversal proves transitive coverage"

- **B16.0.5**'s `bodyReadsFrom` followed helpers to depth 4 and returned CLEAN
  beyond it.
- **B16.0.6** replaces bounded-depth taint with the fail-closed request-flow
  architecture ([request-and-stream-flow-enforcement.md](request-and-stream-flow-enforcement.md)):
  a Request may only reach a canonical sink; a helper that receives it is proven
  safe to a fixed point (cycles / unresolved ⇒ reject). Chain length is
  irrelevant.

## Preserved from B16.0.5 (partially accepted, unchanged)

- 415-before-body-pull; zero-pull media refusal; exact wrapper module provenance;
  raw-Request removal from wrapper callbacks; the original B16.0.5 counterexample
  closures (polarity, wrapper laundering, the taint forms it did cover). Tests
  that assert these still pass in this stage's full run.

## Not changed / not claimed

- No provider credits spent; no live database contacted or mutated.
- Exactly **12** exposed tools, replay pins, authoritative hashes, and
  internal-only manufacturing release unchanged.
- **B16.1, MCP, multi-agent, manufacturing integration, provider expansion,
  migrations, and new tool exposure were NOT started.**
- **R9 live-Supabase remains UNKNOWN.**
