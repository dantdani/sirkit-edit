# B16.0.19 §C — Circuit-knowledge authority (CONFIRMED / by construction)

The migration touched only boundary prologues (plus the propose hardening);
the source-evidence chain is byte-identical, covered by the standing
routes/domain suites (green unchanged).

| Rule | Status |
|---|---|
| source evidence + exact locations remain pinned | UNCHANGED — `sourceBundle.sourceLocations` serialized verbatim into the prompt; `validateRecipeSourceBundle` gate unchanged |
| unreferenced evidence cannot enter a claim | CONFIRMED — `validateClaimPromotion` traceability gate → 422 `proposal references evidence outside the pinned source bundle` (route code unchanged; adversarial ref-bound tests added) |
| no unstated conventional knowledge | UNCHANGED — the system prompt forbids it; the claim carries only supplied evidence refs |
| proposed claims remain quarantined/untrusted | CONFIRMED — `confidence: "low"`, `authorityAssessment: "unknown"`, `authority: "proposal_only"`, `publicationEligible: false` (all gate-asserted literals) |
| conservative confidence/authority assessment | CONFIRMED — hardcoded low/unknown, caller and provider cannot raise them |
| compose/compile cannot silently promote | UNCHANGED — they operate on supplied recipes/bundles and return compiled artifacts; promotion remains the separate human-authority path |
| applicability cannot convert unknown → pass | UNCHANGED — applicability evaluation logic untouched (domain suite) |
| no route claims approval/publication | CONFIRMED — gate scans; `publicationEligible: false` pinned |
