# B16.0.21 §A — Pre-edit reproductions (CONFIRMED)

## §D fail-open — reproduced VERBATIM before editing

```
human            passes transition gate: true
ai               passes transition gate: false
automated_engine passes transition gate: true   <-- fail-open recorded
```

The `full-flow/transition` gate was `actorKind === "ai"` → 403; the other
non-human kinds in the `ActorKind` union (`automated_engine`,
`import_adapter`, `system_migration`) passed. Mitigating fact (same as
B16.0.20): `resolveTrustedRequestContext` mints `actorKind: "human"` for every
session principal, so no HTTP caller could present a non-human actor — a
latent defense-in-depth defect. Corrected to `actorKind !== "human"` with the
SAME 403 response; all four non-human kinds pinned refused post-fix.

## §A parity pins (56, GREEN FIRST RUN, kept green post-migration)

Shared classes ×8: 401 / foreign+revoked 403 / viewer 403 / production
cross-origin 403 with **0 body pulls** / 415 / 400 `AUTH_INVALID_JSON` /
**64,000,001 → 413, exactly 64 MB → under-ceiling 400** / pre-aborted 400
`AUTH_BODY_ABORTED` / exact empty-body refusals.

## Exact empty-body refusals (RECORDED)

| Route | Refusal |
|---|---|
| fb/problem | **409** (no required-field 400 exists — the compiler refuses incomplete inputs; recorded as-is) |
| fb/propose | 400 `typed CD-11 proposal required` |
| fb/resources | 400 `exact device, demands, variant, and modes required` |
| ff/propose | 400 `typed CD-13 proposal required` |
| ff/run | 400 `typed product brief and requested outcome required` (+ `autonomyTier must be 0..4`) |
| ff/transition | 400 `typed run transition required` |
| re/problem | 400 `valid requestedReleaseLevel required` |
| re/propose | 400 `typed CD-12 proposal required` |

## Stable authority pins (pre = post)

fb/problem + re/problem: non-human → exact 403 human-compiler messages with
compile NEVER invoked; compiled actor FORCED human with trusted identity;
compile-ok → 200 / not-ok → 409 (spied verdicts). ff/run: non-human → exact
403; valid → **201** with `authoritativeEngineeringArtifactsCreated: false`;
autonomyTier bounds pinned. ff/transition: ai → exact 403; malformed run →
fail-closed 409 `CD13_RUN_SHAPE_INVALID` (the route's pre-existing typed-catch
behavior, preserved); unknown lifecycle state → 400. Proposals ×3:
deterministic, attacker `proposedBy` IGNORED (trusted context only),
`requiresHumanReview`/`requiresDeterministicPolicy`/`externalSideEffects:false`
flags pinned. fb/resources: deterministic solve+validate certificate.
