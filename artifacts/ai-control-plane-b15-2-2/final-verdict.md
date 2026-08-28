# B15.2.2 — final verdict

**Stop condition MET.** R22 and R23 fail closed permanently, every required
gate passes, exposure remains exactly 11, and the raw-sealer allowlist is
unchanged.

## Closures

| # | Defect | Closure | Test |
| --- | --- | --- | --- |
| **R22** | roundrect containment ran through ROUNDED `outlinePolygon` chord vertices, which can bulge outside the true arc — a genuinely off-board point (`{x: 96305, y: 18039657}` on an 80×80 mm / r=20 mm roundrect) was accepted, so the documented "conservative-exact" property was FALSE in the dangerous direction | one shared exact outline authority: BigInt corner-circle `dx² + dy² ≤ r²` for roundrect, exact bbox for rect, the proven BigInt algorithm for polygon; no trigonometry, no chords, no rounding in any authoritative accept decision; explicit + tested convexity invariant for rect/roundrect segments | §A R22–R22e, including a ~9,900-point fuzz proving exact agreement with the existing true `pointInOutline` authority |
| **R23** | `scope`, `base`, `actor`, `effectiveActor`, `discovery`, `provenance`, and the operations were never type- or value-checked, so any body with a recomputed checksum verified `ok:true` | complete closed nested validation performed BEFORE any digest is recomputed or trusted — exact key sets, types, bounds, permitted values, unique bounded minted ids, and every operation through the canonical `parseBoundedEditRequest` in canonical normalized form | §B R23a–R23f |

## Validation

14/14 new · 78/78 across the four prior B15 suites · 174/174 direct battery
including B08 canonical/authority, B11.5 exposure, and B14.4/B14.5 AST
gates · **full suite 2866 passed / 20 skipped / 0 failures** (2886; 323
files passed / 3 skipped) · `tsc --noEmit` 0 errors · scoped ESLint clean ·
`git diff --check` clean · pins byte-identical · protected original at its
6-entry baseline.

One intermittent failure appeared in the first full run
(`assignment-queue-panel.test.tsx`). It was reproduced in ISOLATION rather
than assumed: 1 failure in 3 solo runs, then 6 consecutive solo passes — so
it is intermittently flaky in isolation, **not** a load artifact, and it
touches none of this stage's modules. It was deliberately NOT repaired and
is recorded for separate triage. Details in
[validation-evidence.md](validation-evidence.md).

## Classification

**CONFIRMED** — the R22 and R23 reproductions and both closures, each backed
by green permanent tests; the seal allowlist unchanged with its negative
tripwire naming the exact future handler filename; exposure exactly 11.
**INFERRED** — the convexity invariant used for rect/roundrect segment
containment (mathematically sound, documented in the module, and permanently
tested, but it is an invariant rather than a per-call computation).
**PROPOSED** — none for this stage. **UNKNOWN** — the pre-existing unrelated
flake and the items in [unknowns.md](unknowns.md).

## Architectural statement preserved

The whole-body proposal digest remains an **integrity checksum** — never
authenticity, never mutation authority. Human approval capability and live
reauthorization remain the authority. B15.2.2 closed a STRUCTURAL validation
hole, not an authentication one.

**Not started:** registry exposure, gateway/loop, `pcb_proposal_ready`,
review UI, approval/apply, durability/recovery, B15.3, B16, MCP,
multi-agent orchestration, manufacturing release. Stopped for independent
verification.

---

## SUPERSESSION NOTE (B15.2.3, 2026-08-20)

The R23 closure row above says the nested validation was "complete". It was
complete for scope/base/actor/effectiveActor/discovery/provenance/
operations — but the IMPACT certificate remained structurally fail-open:
`impact.schema` needed only to be "a string", unknown nested impact keys
were accepted, and any JavaScript number (NaN, ±Infinity, fractions,
negatives) passed, with no bounds, canonical order, or arithmetic checks.
R24a/b/c (mutated impacts with recomputed public checksums) verified
`ok:true`. Closed in B15.2.3 —
`../ai-control-plane-b15-2-3/final-verdict.md`.
