# Stage 5 Prerequisite Gate

## Verdict

BLOCKED

Stage 5 qualification code may be developed behind a default-off flag, but it cannot become production authority. The four prerequisite implementation reports all retain `BLOCKED` verdicts.

## Contract evidence

| Stage | Versioned producer consumed by Stage 5 | Verified local behavior | Unmet production condition |
|---|---|---|---|
| 1 | `sirkit.physical-binding.v1`, readiness policy `1.0.0` | Stable component identity, immutable physical candidates, selected-binding precedence, typed package/footprint/mapping references | No qualified durable project transaction/restart proof for live project bindings |
| 2 | resolver `2.0.0`, default policy `1.0.0` | Fixed authority order; `passive_policy` reserved at rank 6; default source disabled; no cache | Depends on Stage 1 durability; production API intentionally cannot opt into Stage 5 |
| 3 | safe PCB-sync plan/apply contracts | Dependency-bound plan lifecycle and stale-plan rejection; tests prove policy invalidation changes plan state but not board | No durable trusted project snapshot/plan/board/audit transaction and crash recovery |
| 4 | mapping verifier `4.0.0` | Stage 5 accepts only `verified`, approved, current, active, conflict-free `exact_part`, `package_family`, or `curated_pair` results with exact digests | No atomic catalog + Stage 1 mapping publication/restart qualification |

Evidence files:

- `SIRKIT_FOOTPRINT_BINDING_STAGE_01_IMPLEMENTATION.md`
- `SIRKIT_FOOTPRINT_BINDING_STAGE_02_IMPLEMENTATION.md`
- `SIRKIT_FOOTPRINT_BINDING_STAGE_03_IMPLEMENTATION.md`
- `SIRKIT_FOOTPRINT_BINDING_STAGE_04_IMPLEMENTATION.md`
- `docs/physical-binding-stage-02-handoff.json`
- `docs/footprint-resolver-stage-03-handoff.json`
- `docs/pcb-sync-stage-04-handoff.json`
- `docs/mapping-verification-stage-05-handoff.json`

## Safe decision

The implementation is qualification-only, uses in-memory trusted providers/repositories, is not mounted in the legacy editor, and defaults to `SIRKIT_PASSIVE_POLICY_STAGE5=off`. The Stage 2 default policy and legacy schematic-to-PCB behavior remain unchanged. The smallest unblock action is a durable transaction spanning published policy revision, Stage 1 project binding reference, audit/idempotency, and Stage 3 invalidation, followed by isolated PostgreSQL apply/rollback/process-restart tests.
