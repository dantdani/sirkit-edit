# B12 — first controlled agent-originated mutation execution

> **SUPERSESSION NOTE (B12.1, 2026-08-12).** Independent verification found
> four failures in the implementation this document describes: the
> production UI/history did NOT adopt approved commits (the service
> bypassed the coordinator), an altered proposal with a retained
> proposalId/scope inherited the original receipt, three receipt-forgery
> classes validated cleanly, and project retirement mid-commit durably
> advanced the retired store. The corrected contracts live in
> `../ai-control-plane-b12-1/`. This document is preserved as historical
> evidence of the B12 design.


**Approved schematic Tier-1 application.** The one production path by which an
agent-originated, sealed Tier-1 schematic proposal crosses an explicit,
independent human-approval boundary into **exactly one** verified canonical
transaction — with a structured receipt, postcondition verification, and exact
undo/replay evidence.

## The invariant this stage buys

> The model proposes. A human, holding a live trusted session, approves. The
> shared service *verifies, executes once, and proves* — it never approves, and
> the model can never call it.

Three parties, strictly separated:

| Party | Capability | What it can NEVER do |
| --- | --- | --- |
| **Model** (provider-facing) | emit a sealed Tier-1 proposal via nine read/propose tools | call apply; mint a session or the interactive channel; approve; fabricate authority |
| **Human** (interactive root) | hold a live `SchematicEditorSession`; click "Apply exact proposal" | be impersonated by a serialized client claim |
| **Service** (`approved-agent-mutations.ts`) | verify the sealed proposal, submit exactly it once, verify postconditions, mint a receipt | approve; import the channel; reinterpret/repair/compile the operations; commit twice |

## In scope (exactly)

- `schematic_set_component_properties` and `schematic_delete_component`, carried
  inside a sealed `sirkit.schematic-tier1-proposal.v2` proposal.
- One canonical command id: **`schematic.edit-tier1-apply`**, submitted only by
  the shared service, only from the interactive composition root.

## Explicit non-goals (unchanged, not started)

No auto-/model-approved application. No general mutation tools. No
replacement / PCB / manufacturing / MCP / multi-agent / sandbox tools. No
provider-config change and no paid provider call. **B13 is not started.**

## Artifacts in this folder

| File | §/R | Contents |
| --- | --- | --- |
| [pre-edit-reproductions.md](pre-edit-reproductions.md) | R1–R10 | verbatim pre-edit outputs and the one real defect (R4) |
| [approved-execution-contract.md](approved-execution-contract.md) | §A/§D | the shared verify→execute→prove workflow, step by step |
| [execution-receipt-schema.md](execution-receipt-schema.md) | §B | `sirkit.approved-agent-mutation-receipt.v1` field-by-field |
| [approval-and-authority-boundary.md](approval-and-authority-boundary.md) | §G/R9 | who may approve; why no serialized claim can |
| [concurrency-and-idempotency-matrix.md](concurrency-and-idempotency-matrix.md) | §C | the one-shot registry state machine and every race |
| [scope-hydration-recovery-matrix.md](scope-hydration-recovery-matrix.md) | §D | scope pinning, reload/replay, poison-on-unverifiable |
| [agent-to-canonical-transaction-sequence.md](agent-to-canonical-transaction-sequence.md) | §H | the end-to-end provider-neutral sequence, no paid provider |
| [regression-matrix.md](regression-matrix.md) | tests | every permanent B12 test → the requirement it locks |
| [validation-summary.md](validation-summary.md) | — | full battery, hashes, flake classification, confidence |

## Source of truth

- Service: [`app/lib/engineering/approved-agent-mutations.ts`](../../app/lib/engineering/approved-agent-mutations.ts) (450 lines)
- UI integration (§F): [`app/page.tsx`](../../app/page.tsx) — `applyTier1Proposal`, `cancelTier1Proposal`, the `proposal_ready` handler, the receipt panel
- Tests: [`b12-approved-mutation.test.ts`](../../app/lib/engineering/__tests__/b12-approved-mutation.test.ts) (19), [`b12-boundary-and-e2e.test.ts`](../../app/lib/engineering/__tests__/b12-boundary-and-e2e.test.ts) (13)
