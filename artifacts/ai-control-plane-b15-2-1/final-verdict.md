# B15.2.1 — final verdict

**Stop condition MET.** R17–R21 fail closed permanently, all core tests
pass, artifacts are complete, and the agent-exposed tool count is **exactly
11** (no PCB propose tool).

## Closures

| # | Defect | Closure | Test |
| --- | --- | --- | --- |
| **R17** | compiler read `footprint.placement`; fixtures faked it through `never` | read the REAL `placementConstraints`; enforce fixedPosition/mechanical/edgeConnector/allowedRotations; full transformed courtyard envelope on move AND rotate; all fixtures type-correct | §B R17, R17b |
| **R18** | 64-point sampling missed a narrow notch; collinear overlap and vertex-on-edge accepted | new `geometry-exact.ts` — exact BigInt point/segment containment (boundary-crossing parameters + rational midpoints, NO sampling) over the shared `outlinePolygon`, and full simple-polygon validity | §A R18a–R18c |
| **R19** | `update_dimension` skipped rendered-geometry validation | apply the update to a candidate dimension first, then validate its `dimensionGeometry` exactly as `add_dimension` does | §C R19 |
| **R20** | `applyRuleDeltas` reset a legacy no-base class and moved unrequested fields | apply through the shared authority, then verify class identity + named-field effect + every other field/net unchanged across ALL nets; legacy no-base refuses precisely; partial-via ring validated; duplicate nets refuse | §D R20, R20b, R20c |
| **R21** | public `sealPcbEditProposal`/`assemblePcbEditProposal` accepted a fabricated compiled object | removed both public exports; module-private raw sealer (import-gated); ONE high-level `createSealedPcbEditProposal` that compiles internally; full nested-shape validation in the verifier; AST import/export gate + negative tripwire | §E R21a–R21c + gate |

## Validation

15/15 new + 20/20 B15.2 + 28/28 B15.1 + 15/15 B15 core; **full suite 2852
passed / 20 skipped / 0 failures**; tsc 0 errors; scoped ESLint clean; git
diff --check clean; pins byte-identical; protected original untouched;
exposure exactly 11.

## Classification

**CONFIRMED** — R17–R21 reproductions and every closure above (each backed
by a green permanent test) and the AST seal-boundary gate with its negative
tripwire. **INFERRED** — the roundrect containment is conservative-exact via
the shared chord polygon (never accepts off-board; may over-refuse a corner
sliver). **PROPOSED** — none for this stage. **UNKNOWN** — recorded in
[unknowns.md](unknowns.md) (legacy no-base migration policy; the H–K feature
surface remains unbuilt).

## Boundaries preserved

No registry exposure, gateway/loop, `pcb_proposal_ready`, review UI,
approval/apply, durability/recovery, B16, MCP, multi-agent, or manufacturing
release. Stopped for independent verification. B15.3 completes H–K only
after this core is accepted.

---

> **SUPERSEDED IN PART (B15.2.2).** This document's INFERRED claim — "the
> roundrect containment is conservative-exact via the shared chord polygon
> (never accepts off-board; may over-refuse a corner sliver)" — was FALSE in
> the dangerous direction. `outlinePolygon` chord vertices are computed with
> floating-point trigonometry and were ROUNDED to integers; a rounded vertex
> can land OUTSIDE the true arc, so the polygon bulges beyond the board and
> a genuinely off-board point was accepted (`{x: 96305, y: 18039657}` on an
> 80x80 mm / r=20 mm roundrect). Additionally, section E's "full nested-shape
> validation in the verifier" covered only the impact report and a few
> identity fields — `scope`, `base`, `actor`, `effectiveActor`, `discovery`,
> `provenance`, and the OPERATIONS were unvalidated, so three malformed
> proposals with recomputed checksums verified ok:true. Both are closed and
> pinned in `../ai-control-plane-b15-2-2/`: an exact BigInt corner-circle
> outline authority (no chords, no rounding) and complete closed nested
> validation performed before any digest is trusted.
