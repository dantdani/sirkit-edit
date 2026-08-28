# B16.0.5 — Superseded claims (nothing deleted)

B16.0.4's artifacts remain on disk. The claims below are **corrected** here;
the B16.0.4 files are annotated by this note, not removed.

## Supersedes B16.0.4 `final-verdict.md` — "all stop conditions MET"

- **B16.0.4 said:** every protected method proves a load-bearing boundary;
  sibling/ignored/late authorization fails; the security verdict is complete.
- **Independent verification proved otherwise**, and B16.0.5 confirms and closes
  it:
  - the analyzer accepted **wrong-polarity** (`if (a.ok) return`) and
    **unrelated-binding** guards — unauthorized execution could continue;
  - wrapper recognition was **name-only** — `./evil` and
    `import { evil as authenticatedJsonRoute }` both passed;
  - body-read detection was **taint-blind** — 7 of 8 forwarding/aliasing forms
    were missed;
  - **no** JSON route enforced 415;
  - the audited wrapper still passed the **raw `Request`** to its callback.
- **B16.0.5 says:** authorization refusals must be POLARITY-CORRECT and
  load-bearing; approved wrappers resolve to the exact canonical module and
  exported symbol; body reads are found through transitive request taint; every
  JSON route returns 415 before the first body pull; wrapper callbacks receive
  no raw Request/headers/body. B16.0.4's "all MET" verdict is **WITHDRAWN** and
  superseded by [final-verdict.md](final-verdict.md).

## Supersedes B16.0.4 `method-scoped-authorization-proof.md`

The claim "a name-based AST scan proves dominance" was overstated: a name scan
cannot prove polarity or resolve module identity. The corrected model
([method-scoped-authorization-proof.md](method-scoped-authorization-proof.md))
adds polarity-correct refusal recognition and canonical module/symbol
resolution, and points routes wanting a by-construction guarantee at the audited
wrapper.

## Supersedes B16.0.4 `bounded-body-migration.md` / `body-coverage-gate.md`

The "0 direct unbounded body reads" claim was true only for the direct-member
form the old detector could see. It is **re-established on a sound basis**: the
taint engine ([request-body-boundary-matrix.csv](request-body-boundary-matrix.csv))
follows request flow through aliases, destructuring, property extraction,
containers, call/apply, element access, clone, and imported helpers — and still
reports **0** offenders across production routes.

## Refines B16.0.4 `unknowns-and-owner-decisions.md` — the 415 "owner decision"

- **B16.0.4 said:** not retrofitting 415 is an owner decision because it changes
  accepted client behavior.
- **Corrected:** unsupported-content-type rejection is REQUIRED by the stage
  contract, not optional. B16.0.5 enforces 415 at the bounded-reader chokepoint
  (default on) and on the two streaming JSON routes; the behavior change is
  intended and its test fallout was fixed by sending the correct
  `application/json` header (never by weakening an assertion).

## Not changed / not claimed

- No provider credit spent; no live database contacted or mutated.
- Exactly **12** exposed tools, replay pins, authoritative hashes, and
  internal-only manufacturing release are unchanged (asserted by the preserved
  B16.0.1 / B04–B12 gates in the full run).
- **B16.1, MCP, multi-agent, manufacturing integration, provider expansion, and
  new tool exposure were NOT started.**
- **R9 live-Supabase remains UNKNOWN.**
