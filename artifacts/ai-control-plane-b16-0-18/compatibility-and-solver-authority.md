# B16.0.18 §F — Compatibility & solver authority (CONFIRMED / by construction)

## /evaluate

Catalog validated first (`problemId, requirement, and catalog are required`
400 pinned); compatibility evaluation, reconciliation/offer evidence, and the
capability profile (`EMBEDDED_COMPONENT_SELECTION_PROFILE_V1`) untouched;
**no provider call** (the route never imports the router).

## /solve

Problem validation + trusted scope (foreign → 422, pinned); the BOM constraint
model (`createBomConstraintModel`), hard constraints, and the objective vector
flow unchanged into `solveJointBom`; deterministic `seed` behavior preserved
(`Number.isSafeInteger(body.seed) ? seed : 0`); the actor is built EXCLUSIVELY
from trusted context (source-identical to the pinned transaction pattern).
The solver produces candidates — it cannot purchase or approve parts (no
purchase surface exists; approval remains a human decision in project state).

## /alternative

Requires BOTH primary and alternative as independently produced
`PartCompatibilityEvaluation`s (400 otherwise, pinned); impact categories
(schematic/pcb/firmware/calculation/recipe/sourcing/qualificationCompliance)
pass through `createComponentAlternativePlan` unchanged; the plan is neither
equivalence nor approval (no approval field exists in the response; the
human-truth gate pins the propose/no-approval invariants family-wide).
