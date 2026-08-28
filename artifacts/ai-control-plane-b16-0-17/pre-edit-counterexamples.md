# B16.0.17 §A — Pre-edit behavioral pins (CONFIRMED)

[`app/api/__tests__/b16-0-17-tranche-parity.test.ts`](../../app/api/__tests__/b16-0-17-tranche-parity.test.ts)
was written against the PRE-migration raw handlers and run GREEN (**82/82**
after two pin-authoring corrections, both against recorded pre-edit output:
the propose tool name is `propose_schematic_semantic_changes`, and the
unknown-semantic-ID failure surfaces through the route catch as the normalized
provider-error envelope — see below). Kept green unchanged post-migration.

Spies: `llmRouter.generate`; `validateSchematicCompilationProblem` /
`validateSchematicGraph` / `validateSchematicProjectState` (permissive, to
isolate the boundary — REAL validators covered by the standing
`routes.test.ts` + domain suite); `create/applySchematicTransaction` (actor
capture); `normalizeSchematicChangeProposal` (pass-through over the REAL
implementation).

## Shared refusal classes ×10 (all pinned)

401 unauthenticated · 403 foreign/revoked membership · 403 production
cross-origin (ZERO body pulls) · 415 media · 400 `AUTH_INVALID_JSON` ·
**32,000,001 → 413** and **32,000,000 → 400 (under the ceiling)** ·
400 `AUTH_BODY_ABORTED` pre-aborted · exact required-field errors — all with
provider ZERO.

## Exact required-field refusals (RECORDED)

| Route | Refusal (400) |
|---|---|
| compare | `source graph, independently reparsed graph, and manifest ID are required` |
| diff | `base and candidate graphs are required` |
| export | `state is required` |
| graph/validate | `graph is required` |
| kicad/inspect | `KiCad source string is required` |
| layout | `graph and sheetInstanceId are required` |
| problem | `pinned CD-1 through CD-7 states, signoff, atomic snapshot, and variants are required` |
| propose | `problem, graph, and user request are required` |
| transaction | `state, base digest, idempotency key, reason, and operations are required` |
| variants | `graph is required` |

## Role split (RECORDED)

export + kicad/inspect are ALL-members (viewer admitted to the required-field
check); the other eight deny viewer 403.

## Recorded behavior — unknown semantic IDs (CONFIRMED)

The REAL `normalizeSchematicChangeProposal` throws
`CD8_AI_PROPOSAL_REFERENCE_INVALID`; the route's catch normalizes it through
`providerErrorResponse`, so the observed pre-edit behavior is a non-200
provider-error envelope with NO proposal emitted. Pinned as observed (the
deterministic validator runs and refuses; nothing is silently accepted) and
noted in [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md).

## Scope / actor / authority pins

graph/validate foreign project → 403 `graph scope mismatch`; problem foreign →
403 `schematic problem scope mismatch`; transaction actor CAPTURED from trusted
context (`u1`/`human`/`pcb_editor`, attacker body actor/role/session ignored)
with trusted tenant/project/branch; transaction foreign scope → 422 before any
transaction; export no approved candidate → 422 `NOT_RELEASED`; propose valid →
exactly-once (`maxTokens 4096`, `temperature 0`, forced toolChoice, exact
system prompt) with `proposal_only` + null mutations + `X-Sirkit-AI-Provider`;
no-tool-call → 422; provider failure → 503; scope mismatch → 422 provider-zero;
kicad/inspect quarantine + null semanticImport (parse fail stays 422
quarantined); compare diagnostic 422 with `none-certified` +
`NO_CERTIFIED_KICAD_SEMANTIC_ADAPTER`.


---

## ⚠️ SUPERSESSION NOTE (B16.0.17.1)

The unknown-semantic-ID claim in THIS document was **overstated and is
superseded**. Independent verification of B16.0.17 confirmed the pin's tool
input did NOT satisfy the SCHEMATIC_PROPOSAL_TOOL schema; the observed failure
was an incidental `TypeError: Cannot read properties of undefined (reading
'map')` — it never reached the known-ID validation and did not prove
`CD8_AI_PROPOSAL_REFERENCE_INVALID`. The corrected proof (real tool-contract
fixture, structural validation before normalization, deterministic local 422
codes, provider/local error-boundary separation) lives in
`artifacts/ai-control-plane-b16-0-17-1/` and the corrected suites
`b16-0-17-tranche-parity.test.ts` + `b16-0-17-1-proposal-validation.test.ts`.
The historical text above is retained as evidence and must not be read as a
valid proof.
