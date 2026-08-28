# B16.0.7 — Superseded claims (nothing deleted)

B16.0.6's artifacts remain on disk. The claims below are corrected here.

## Supersedes B16.0.6 "authorization dominance is proven"

- **B16.0.6 said**: the analyzer proves authorization dominates all
  body/durable/provider/process/mutation work.
- **Independent verification proved otherwise** (R1/R2): work placed BETWEEN the
  authorization and its refusal, or INSIDE the refusal branch, was accepted.
- **B16.0.7 says**: dominance now also requires nothing to run between the
  boundary and its refusal and the refusal branch to only refuse; and — more
  importantly — dominance is being moved to RUNTIME canonical wrappers rather than
  proven by an analyzer. See [authorization-and-body-ordering.md](authorization-and-body-ordering.md).

## Supersedes B16.0.6 "unresolved Request/body flow always rejects" and "the fixed-point analyzer covers Request escape"

- **B16.0.6 said**: unresolved flow rejects and the fixed-point analyzer covers
  Request escape.
- **Independent verification proved otherwise** (R5–R11): Request escapes into
  object/array/Map aggregates, constructors, async iterators, property writes, and
  aggregate returns produced ZERO violations.
- **B16.0.7 says**: those escape forms now fail closed (analyzer/flow gate), and
  the durable fix is confinement — raw `Request` may not appear in ordinary
  business modules at all once the wrapper migration lands. See
  [request-confinement-contract.md](request-confinement-contract.md).

## Supersedes B16.0.6 "B16.0.6 is complete"

- **B16.0.6's** final verdict claimed completeness of its analyzer-soundness
  goal. R1–R11 show it was not sound.
- **B16.0.7 does NOT claim completeness** either: it closes R1–R11 and establishes
  the wrapper architecture + adoption gate, but the mandatory route migration,
  new wrapper variants, hard structural gate, and type-checker confinement are
  NOT done. See [final-verdict.md](final-verdict.md).

## Preserved (B16.0.6 partially accepted, unchanged)

- Original R1–R8 closures; exact reader/wrapper provenance; B16.0.5 media-type,
  bounded-body and raw-Request-isolation behavior; all runtime behavior that
  passed. The prior hardening suites pass unchanged in this stage's run.

## Not changed / not claimed

- No provider credits; no live database writes; no production route source
  changed. Exactly 12 exposed tools, replay pins, authoritative hashes, and
  internal-only manufacturing release preserved. `C:\Users\robsa\sirkit`
  untouched. B16.1 / MCP / multi-agent / manufacturing integration / provider
  expansion / migrations / new tool exposure NOT started. R9 UNKNOWN.
