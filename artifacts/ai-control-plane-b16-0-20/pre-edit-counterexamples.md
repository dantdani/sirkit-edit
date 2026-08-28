# B16.0.20 §A/§C — Pre-edit reproductions (CONFIRMED)

## §C ambiguity — reproduced VERBATIM before editing

Direct condition probe:

```
human + pcb_editor  passes gate: true
ai    + pcb_editor  passes gate: false
ai    + automation  passes gate: true   <-- AMBIGUITY
```

Live end-to-end probe through the RAW route (scope-override seam):

```
PRE-EDIT ai+automation → status=400 error=provider, pinned environment, lowering manifest, and content digests are required
```

The AI+automation actor got PAST the 403 gate to the required-field check —
while `ai + pcb_editor` was correctly refused 403 with
"AI cannot execute simulation campaigns". The intended contract per the
route's own message is "AI cannot execute"; the `&&` condition contradicted
it. Context: `resolveTrustedRequestContext` mints `actorKind: "human"` for all
session principals, so the flaw was unreachable via the HTTP boundary — a
latent defense-in-depth defect, not an exploited hole. Corrected per §C
([human-ai-authority-separation.md](human-ai-authority-separation.md)).

## §A parity pins (44, GREEN FIRST RUN, kept green post-migration)

Shared classes ×6: 401 / foreign+revoked 403 / viewer 403 / production
cross-origin 403 with **0 body pulls** / 415 / 400 `AUTH_INVALID_JSON` /
**64,000,001 → 413, exactly 64,000,000 → under-ceiling 400** / pre-aborted 400
`AUTH_BODY_ABORTED` / exact required-field errors with ZERO domain work
(compile/authorize/readiness spies never called).

## Exact required-field refusals (RECORDED)

| Route | Refusal (400) |
|---|---|
| denominator | `complete denominator inputs are required` |
| execute | `provider, pinned environment, lowering manifest, and content digests are required` |
| measure | `run, authoritative waveform, measurements, assertions, and scope are required` |
| problem | `CD-8, CD-9, model registry, testbench registry, providers, and obligation IDs are required` |
| propose | `typed proposal input is required` |
| readiness | `pinned problem, registries, provider/environment, and applicability results are required` |

## Stable behavior pins (pre = post)

problem: non-human → exact 403 "AI may propose CD-10 inputs but may not
compile an authoritative problem" with compile never invoked; verdict mapping
BLOCKED BY CD-9 → 409 / ok → 200 / other → 422; the compiled actor FORCED
human with trusted identity. execute: ai+pcb_editor → exact 403; denied
authorization → 409 "authoritative execution denied"; authoritative → **501**
with the exact blocked-runner error. denominator/readiness foreign scope →
403 exact messages. propose: unknown kind → 400; valid → `requiresHumanReview:
true` with `proposedBy` from trusted context (attacker `proposedBy` ignored).
measure: deterministic evaluation, no authorization/runner involvement.
