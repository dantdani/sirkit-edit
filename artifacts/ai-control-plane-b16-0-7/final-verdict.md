# B16.0.7 — Final verdict

## Verdict: **INCOMPLETE — the stop condition is NOT met.**

The stop condition requires that "ordinary protected/body-consuming routes
cannot express handwritten authorization or raw Request handling at all, and the
canonical wrappers enforce ordering at runtime." That requires migrating the
**150 raw handlers (of 153 methods across 142 route files)** to canonical
wrappers, adding four new wrapper variants, and enabling the hard structural
gate. That migration was **not performed** in this stage, and this document says
so plainly rather than claiming completion.

## What IS delivered and verified

| Deliverable | Status | Evidence |
|---|---|---|
| R1–R11 reproduced pre-edit, closed, permanent tests | **DONE** | [pre-edit-counterexamples.md](pre-edit-counterexamples.md) / [post-edit-results.md](post-edit-results.md); `b16-0-7-analyzer-hardening.test.ts` (15 pass) |
| — R1 work between auth and refusal → REJECT | done | dominance walk checks the gap statements |
| — R2/R3 work/body-read inside the refusal branch → REJECT/flag | done | branch-work check on awaited + inline guards |
| — R4 unawaited async boolean binding → REJECT | done | await required for async boolean bindings |
| — R5–R11 aggregate/constructor/iterator/property-write escapes → REJECT | done | value-reference context + new-arg + for-await + property-write checks |
| Wrapper-adoption classifier + structural gate + NEGATIVE TRIPWIRE (raw exported POST detected) | **DONE** | `b16-0-7-wrapper-adoption-gate.test.ts` (5 pass) |
| Adoption inventory `route-wrapper-matrix.csv` (byte-stable ×2) | **DONE** | 0/153 adopted — honest baseline |
| No production regression | **DONE** | full bounded-fork suite **3386 pass / 0 fail / exit 0**; tsc 0; eslint 0; git clean; 4 generators ×2 stable |
| Preserved invariants (415/no-store/zero-pull, 12 tools, replay pins, hashes, internal-only release) | **DONE** | green within the full run |

## What is NOT delivered (the remaining mandate)

1. **Route migration**: 150 raw handlers → canonical wrappers (0 migrated).
2. **New wrapper variants**: authenticated streaming JSON, public streaming
   input, non-JSON bounded, selector-envelope.
3. **§C header-selector migration** for body-scope routes.
4. **Hard structural gate cutover** (`EXPECT_FULL_ADOPTION = true`).
5. **§E type-checker Request-confinement** across all production route-reachable
   modules (the AST/flow gate enforces the route surface today).
6. **§F full behavioral matrix** for the new wrapper variants.

The migration plan, sequencing, and rollback are in
[migration-and-rollback.md](migration-and-rollback.md); the decisions the owner
must make (staging, variant design, gate cutover) are in
[unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md).

## Why partial delivery instead of a forced migration

Migrating 142 route files' runtime in one pass — while the stage simultaneously
demands zero functional regression — carries a high risk of shipping a broken or
subtly-changed API surface. The truthful-evidence rule (§H) outranks the
completion pressure: the R1–R11 security closures are delivered and verified;
the architectural migration is scoped, inventoried, gated, and explicitly
pending. B16.0.4–B16.0.6's overclaiming is not repeated here.

## Out of scope / preserved

No provider credits; no live DB writes; `C:\Users\robsa\sirkit` untouched;
B16.1 / MCP / multi-agent / manufacturing integration / provider expansion /
migrations / new tool exposure NOT started; R9 UNKNOWN.

**Stopping for independent verification of the delivered portion and owner
direction on the migration.**
