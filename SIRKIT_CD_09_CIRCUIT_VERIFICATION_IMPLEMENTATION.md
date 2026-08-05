# Sirkit CD-09 Circuit ERC, Application Rules, Requirement Coverage, and Safety Verification

Date: 2026-07-18  
Branch: `codex/cd-09-circuit-verification`  
Specification SHA-256: `E8608581A7DDB93EBCD0CC8735EA424203D8D397C7730D57D79815D19A2BF853`  
Protected working copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`  
Protected original: `C:\Users\robsa\sirkit` (unchanged)

## Outcome

Sirkit now has a fail-closed CD-09 verification foundation whose only electrical input is an approved CD-08 semantic graph. It compiles an explicit rule × target × variant × operating-context denominator before evaluation, executes an independent full oracle, preserves applicability separately from engineering result, gives findings semantic identities, and aggregates currency, coverage, parity, waivers, and readiness without converting unknowns into passes.

The implementation does not certify the current project. The production CD-08 state has no human-approved candidate or independently certified KiCad semantic round trip; CD-08 is itself blocked by CD-07. Therefore the formal entry verdict remains `BLOCKED BY CD-8`.

## Baseline audit and migration decision

| Existing path | Audit result | CD-09 decision |
|---|---|---|
| `lib/erc.ts` | Deterministic but consumes the legacy Build logical netlist, uses coarse pin types/role heuristics, and treats warnings as non-blocking without an explicit denominator. | Preserved for legacy feedback; never used as CD-09 authority or readiness evidence. |
| `/api/schematic/review`, `/api/schematic/cross-verify` | LLM and secondary-parser review are advisory and may skip or disagree. | Corroborating/proposal-only; cannot alter physical result or verdict. |
| `app/lib/constraints/*` | Useful typed state/waiver patterns, but scoped primarily to PCB/manufacturing constraints. | Reused as design precedent only; CD-09 has separate circuit-rule contracts and stricter waiver rules. |
| `app/lib/pcb/readiness/*` | Explicitly states that PCB fabrication readiness does not prove circuit function. | Kept separate. CD-09 does not weaken or overwrite PCB readiness. |
| `app/lib/schematic-compiler/*` | Supplies exact stable components, pins, nets, endpoints, variants, provenance, and round-trip evidence. | Required as the sole verification authority through a digest-pinned CD-08 handoff. |

## Implemented architecture

- `app/lib/circuit-verification/types.ts` separates applicability, engineering result, severity, workflow state, waiver state, currency, requirement coverage, parity, and readiness.
- `problem.ts` verifies the complete CD-1 through CD-8 digest chain and requires one current human-approved CD-08 candidate, valid graph, complete structural report, sync contract, and semantically equivalent independent round trip.
- `registry.ts` provides a versioned, evidence-linked, human-approved deterministic rule registry. Draft rules never enter the readiness denominator.
- `contexts.ts` uses a bounded declarative selector DSL and materializes every required rule instance, including explicit not-applicable, unknown, unsupported, and missing-input records.
- `oracle.ts` independently recomputes the full denominator. Each evaluator is isolated, but failures remain counted as blocking internal errors.
- `identity.ts` derives finding identity from rule revision, variant, context kind, semantic anchors, and reason—not coordinates, references, display net names, or message wording.
- `incremental.ts` computes conservative impact, treats incremental output as provisional, and makes any full/incremental mismatch blocking.
- `coverage.ts`, `waiver.ts`, and `readiness.ts` keep requirement implementation/verification/satisfaction distinct; require narrow expiring independent waivers; preserve the underlying physical result; and prohibit release on gaps, unknowns, staleness, or mismatch.
- `workflow.ts` and `agent-tools.ts` permit AI triage/remediation proposals only. AI cannot mutate the graph, waive a finding, resolve evidence, or approve readiness.
- `native.ts` classifies KiCad native ERC as corroborating evidence only.

## Product, API, and storage surfaces

- `/circuit-verification?project=<project-id>` shows the real `BLOCKED BY CD-8` gate. Once prerequisites exist, the user can explicitly approve the foundational registry and run the full oracle without modifying schematic or PCB state.
- The workspace exposes the denominator, all rule results, applicability, semantic anchors, findings, variants/contexts, currency, parity, coverage gaps, and waiver counts.
- Four scoped APIs compile the problem, execute the full oracle, aggregate readiness, and use the provider-neutral AI router for typed remediation proposals only.
- `lib/persistence.ts` stores CD-09 state/history and archives it whenever CD-1 through CD-8 changes. Imported CD-09 state requires an explicit project-fork migration.
- `drizzle/0017_cd09_circuit_verification.sql` adds immutable signoff, problem, registry, denominator, oracle, finding, waiver, parity, and readiness records.

## Verification evidence and honest limitations

- Focused CD-09/API plus benchmark-governance suites: 41 tests passed.
- Complete Sirkit suite: 174 files passed, 1,185 tests passed, 9 skipped, zero failed.
- TypeScript, focused ESLint, and the production build passed. The build emits `/circuit-verification` plus all four scoped CD-09 APIs; five unrelated existing Turbopack file-tracing warnings remain.
- The governed benchmark manifest validates at 51 packages with zero diagnostics, including three new CD-09 packages.
- All 94 specified corpus classes have immutable metadata hashes and are honestly marked `manifest_only`; they are not claimed as licensed golden or expert-reviewed evidence.
- Foundational deterministic rules cover graph integrity, exact binding, variant projection, pin dispositions, endpoint reciprocity, atomic NC, basic pin contention/input drive, rail source binding, explicit ties, hierarchy binding, round-trip currency, and requirement traceability.
- The complete manufacturer application-rule library, connector/test/protection catalog, voltage/current threshold database, native KiCad oracle automation, full operating-mode model, licensed golden corpus, and independent expert signoff remain incomplete. Required category gaps stay visible and prevent `READY`.

## Formal verdict

### `BLOCKED`

Primary blocker: `BLOCKED BY CD-8`. The CD-09 safety architecture, gate, explicit denominator, full oracle, workflow, persistence, UI, migration, and governed manifest exist, but no approved production CD-08 handoff, complete application-rule evidence library, certified native-tool corroboration, licensed corpus, or expert signoff exists. No readiness or safety claim is made.
