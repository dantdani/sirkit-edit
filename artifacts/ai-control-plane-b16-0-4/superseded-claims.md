# B16.0.4 §E — Truthful supersessions (nothing deleted)

This stage **refines** earlier claims rather than erasing them. The prior
artifacts remain on disk and truthful for their own scope; the notes below say
exactly what B16.0.4 strengthens.

## Supersedes B16.0.2 — the `BOUNDED_CONSUMERS` allowlist claim

- **B16.0.2 said:** the 11 body-consuming routes are bounded (enforced by a
  hand-maintained `BOUNDED_CONSUMERS` allowlist).
- **B16.0.4 says:** *all* production `app/api` handlers are bounded — **49**
  routes migrated, **0** direct unbounded reads remain — and the allowlist is
  **deleted** in favour of an automatic filesystem-discovery gate
  ([body-coverage-gate.md](body-coverage-gate.md)). The narrower "11 routes"
  coverage claim is superseded by "every route, enforced without an allowlist".
- **Still true from B16.0.2:** the bounded reader's mechanism (ceiling,
  deadline, abort, latch) and its unit tests are unchanged and relied upon.

## Supersedes B16.0.1/B16.0.3 — file-level authorization detection

- **Earlier stages said:** each protected route authorizes (detected at file
  granularity — the boundary appears somewhere in `route.ts`).
- **B16.0.4 says:** each protected **exported method** proves its own
  **load-bearing, dominant** boundary — method-scoped, sibling-proof,
  ignored-result-proof, late-boundary-proof — across all **121** protected
  methods with **zero** rejects, kept honest by 10 negative tripwires
  ([method-scoped-authorization-proof.md](method-scoped-authorization-proof.md),
  [authorization-tripwires.md](authorization-tripwires.md)). File-level
  detection is superseded by method-level proof.

## Refines B16.0.3 — the replacement-authority success test

- **B16.0.3's** successful-path test tolerated `[200, 503]` and therefore never
  executed its binding assertions.
- **B16.0.4** requires **exact 200** with an unconditional nonce / component /
  trusted-scope binding assertion, driven by a real durable aggregate
  ([replacement-authority-exact-200.md](replacement-authority-exact-200.md)).
  The B16.0.3 authentication-ordering assertions in the same file are unchanged
  and still pass.

## Not changed / not claimed

- **B16.1, MCP, multi-agent orchestration, manufacturing/provider expansion, and
  new AI-tool exposure were NOT started** — out of scope by the stage's STOP
  CONDITION. See [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md).
- No provider credit was spent and no live database was contacted or mutated in
  producing or validating this stage.
- The B16.0's withdrawn "B16.1 may proceed" verdict remains withdrawn; this stage
  makes no readiness claim about B16.1.
