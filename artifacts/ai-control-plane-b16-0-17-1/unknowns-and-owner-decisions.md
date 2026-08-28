# B16.0.17.1 — Unknowns & owner decisions

## Decisions taken (per the corrective mandate)

1. **Unknown semantic IDs → 422 `CD8_AI_PROPOSAL_REFERENCE_INVALID`**
   (CONFIRMED) — a deterministic local refusal, replacing the old conflation
   with the provider-error envelope. This is an intentional, mandated contract
   correction (the old behavior was itself the product of the defect).
2. **Malformed provider tool output → 422 `SCHEMATIC_PROPOSAL_OUTPUT_INVALID`**
   (CONFIRMED) — with bounded field-name diagnostics; never an incidental
   TypeError, never a provider classification.
3. **Blank-rationale split** (RECORDED) — a whitespace-only rationale passes
   the schema's `minLength: 1` (structural) but fails `normalize`'s trim check,
   so it surfaces as `CD8_AI_PROPOSAL_REFERENCE_INVALID` rather than the
   structural code. Both are deterministic local 422s; the split mirrors the
   schema-vs-normalize division of labor and is pinned as such.
4. **Validator derives constraints from the schema literal** (CONFIRMED) — one
   source of truth; the fixture is additionally schema-checked inside the
   suite, so no independently drifting shape exists.

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN.**
- Remaining migration: **59 raw methods** (baseline 62) — unchanged by this
  corrective stage.
- The provider-side `strict: true` tool mode should make structurally invalid
  output rare in production; the validator is the fail-closed guarantee for
  when it is not. No live-provider behavior was measured (no credits spent) —
  the real-provider frequency of malformed output remains UNKNOWN.

## Scope adherence

Only `agent-tools.ts` (additive validator), the propose route's error
boundary, the two test files, and artifacts changed. No prompt/schema/config/
inventory/exposure change. `C:\Users\robsa\sirkit` untouched. B16.0.18 / B16.1
NOT started.
