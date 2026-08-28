# B09.2 — Truthful Resource Authority, Hard-Deadline Enforcement, and Provider-Boundary Closure

> **SUPERSESSION NOTE (B09.3, 2026-08-09).** Independent verification found
> four additional gaps after this stage: (1) context integrity did NOT
> cover lineage; (2) schema validation was container-shape only — many
> semantically invalid schemas still rendered; (3) the "narrow
> schematic-snapshot resource" below was FICTITIOUS — no such resource
> existed in the resource architecture; the gateway simply bypassed the
> registered read boundary (that bypass is now removed and boardless reads
> refuse); (4) catalog/manifest claims overstated runtime availability.
> See `artifacts/ai-control-plane-b09-3/` for the corrections. The
> counterexample record below is preserved as history.

Corrective stage over B09/B09.1. Seven pre-edit counterexamples were reproduced
against the unmodified B09.1 tree, each closed in production code, and each is
now a permanent regression test.

## Documents

| Document | Section | Content |
| --- | --- | --- |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | — | Exact R1–R7 reproduction outputs captured BEFORE any edit |
| [truthful-resource-authority.md](truthful-resource-authority.md) | A | No synthetic canonical authority; schematic-snapshot narrow path |
| [resource-authority-integrity.md](resource-authority-integrity.md) | B | authorityStatus integrity-pinned (envelope v2) and enforced |
| [hard-deadline-adversarial-results.md](hard-deadline-adversarial-results.md) | C | BOUNDARY race; adversarial deterministic-timer results |
| [provider-schema-validation.md](provider-schema-validation.md) | D | Structural schema validation pre + post normalization |
| [proposal-scope-capability-results.md](proposal-scope-capability-results.md) | E | Canonical mark validator reuse; effective-actor capability; integrity pin |
| [catalog-reconciliation.md](catalog-reconciliation.md) | F | Catalog truth fixes + evidence-path CI gate |
| [provider-recovery-integration.md](provider-recovery-integration.md) | G | Production run-consumer recovery proof |
| [validation-summary.md](validation-summary.md) | — | Full battery counts, CONFIRMED/INFERRED/UNKNOWN, B10 readiness |

## Invariants after B09.2

- Canonical project state is CLAIMED only when every constituent was supplied
  and validated. `board ?? createEmptyBoard()` substitution no longer exists;
  a missing/invalid board ⇒ `canonicalState: null`, `canonicalRevisionDigest:
  null`, explicit warnings, and `buildAgentResourceBundle` throws
  `CANONICAL_RESOURCE_UNAVAILABLE`.
- ~~Schematic inspection without canonical authority rides a narrow, versioned
  schematic-snapshot resource~~ **[CORRECTED by B09.3: that resource never
  existed — the path was an unregistered gateway bypass. It is removed;
  boardless schematic inspection now refuses `authority_unavailable` and
  the only read path is the registered B05/B05.1 canonical-state binding.]**
- Resource envelopes are v2: `authorityStatus` participates in the content
  digest AND the manifest; only `verified` is consumable
  (`resource_unverified` / `resource_unavailable` refusals); v1 replays fail
  explicitly as superseded.
- The run deadline is HARD: every awaited adapter/continuation/gateway
  operation is raced against the run boundary; late resolutions are
  discarded, late rejections never go unhandled, a pre-aborted request never
  calls the provider, and exactly one terminal event is emitted.
- Provider tool schemas are structurally validated before AND after strict
  normalization; the B09.2 hostile CONTAINER shapes throw
  `STRICT_SCHEMA_UNSUPPORTED` and the source is never mutated.
  **[B09.3: container-shape validation was insufficient — semantically
  invalid schemas (non-object roots, cross-type keywords, non-finite
  enum/const, unconstrained `{}`, multi-type unions) still passed; B09.3
  adds full semantic validation.]**
- Proposal scope validation reuses `validateSchematicCanonicalMark` (no weaker
  duplicate); the gateway verifies effective-actor capability and full
  actor/discovery integrity (`context_integrity` refusals); apply uses the
  captured scope branch, never a hardcoded "main"; proposal tool version is
  1.1.0 for the V2 contract.
- Every catalog `sourceEvidence` path exists (CI-gated), and the agent-exposed
  static registry remains EXACTLY eight tools. **[B09.3: further stale
  catalog/manifest claims survived this stage — the pcb.dimension header
  claim, `create_via` vocabulary, and the unconditional "resources
  assemblable" manifest reasons; all corrected with CI tripwires in B09.3.]**
- Provider-failure recovery is production code (`app/lib/agent/run-consumer.ts`)
  exercised directly by tests: Retry = new run; Switch selects the provider
  first; stale/cancelled/deadline runs recover nothing.

No B10 work was performed. No autonomous mutation exists. No live provider
credits were required (both accounts remain out of credits; live model turns
stay UNKNOWN).
