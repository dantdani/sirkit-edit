# B16.0.17 — Unknowns & owner decisions

## Owner decisions taken (documented)

1. **Deadline 30_000 discovered, not invented (CONFIRMED)** — `scopedTrustedJson`
   passes no `deadlineMs`; the reader default has always applied.
2. **`schematicCompilerScopeFromContext` delegates to `flatScopeOf`; `scopedJson`
   retained (CONFIRMED)** — nothing weakened or deleted.
3. **Boundary suite spies the domain validators permissive (INFERRED →
   acceptable)** — the REAL validators, graph semantics, and the
   denies-direct-AI-transaction invariant stay covered by the unchanged
   standing `routes.test.ts` (real `readyGraph()` graphs) and the domain suite.
4. **Unknown-semantic-ID failure surfaces via `providerErrorResponse`
   (RECORDED historical behavior)** — the REAL
   `normalizeSchematicChangeProposal` throws
   `CD8_AI_PROPOSAL_REFERENCE_INVALID`, which the route's catch normalizes into
   the provider-error envelope (non-200, no proposal). The pin records this
   as-is rather than reclassifying the error; whether that throw should map to
   a dedicated 422 instead of the provider-error path is an owner decision for
   a future stage (changing it now would alter a pinned contract).
5. **Route-level fake-timer deadline pin omitted (INFERRED)** — the 30 s
   bounded-reader deadline is the shared reader's already-pinned contract; the
   pre-aborted pin covers the route-level abort path (same rationale as
   B16.0.16).

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN**.
- **Remaining migration: 59 raw methods** (baseline 62) — spice family, chat,
  replacement-authority, full-flow and other families, plus the 3 factory
  routes. **CONFIRMED**.

## Scope adherence

Work confined to `sirkit-edit`; protected original untouched; no provider
credits; no live network/DB; no KiCad semantic importer; no
graph/parser/layout/proposal/transaction redesign. B16.0.18 / B16.1 / MCP /
multi-agent / provider expansion NOT started.


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
