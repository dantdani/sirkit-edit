# B15.3 — changed files (exact paths)

## New production modules

- `app/lib/pcb/proposal/pcb-propose-tool-handler.ts` — the ONE agent-facing
  handler (strict {intent, operations}; server-derived authority; calls
  `createSealedPcbEditProposal` only). The file the B15.2.2 tripwire named.
- `app/lib/engineering/pcb-edit-approval.internal.ts` — the branded one-shot
  `PcbEditApprovalIntent` (module-private registry, burn-before-validate).
- `app/lib/engineering/approved-pcb-mutation-journal.ts` — the PCB durable
  journal (CAS store, monotonic states, closed validation, honest checksum).
- `app/lib/engineering/approved-pcb-mutation-journal-idb.ts` — the
  production IndexedDB store (strict durability, array keys, size cap).
- `app/lib/engineering/approved-pcb-mutations.ts` — the apply service (the
  full ordered ritual + recovery dispositions) + the PCB in-flight registry.
- `app/lib/project/pcb-edit-approval-controller.internal.ts` — the trusted
  controller (mint intent → apply → retire in finally); page.tsx +
  PcbEditor-gated.
- `app/components/pcb/PcbProposalReviewDialog.tsx` — the pure review surface.

## Production edits

- `app/lib/pcb/proposal/sealed-pcb-edit-proposal.ts` — **added**
  `PcbValidationPolicy`, `resolvePcbValidationPolicy`, the `validationPolicy`
  field in `SealedPcbEditProposal` + `PCB_EDIT_PROPOSAL_KEYS`, and the
  integrity-pinned policy validation in `validateProposalShape`.
- `app/lib/pcb/proposal/pcb-edit-proposal-sealer.internal.ts` — seals + the
  recomputed `validationPolicy`.
- `app/lib/pcb/proposal/pcb-edit-proposal-service.ts` — takes
  `validationPolicy: {presetId}` (no caller rules); resolves + seals it.
- `app/lib/project/pcb-proposal-events.ts` — **added**
  `receivePcbProposalReadyEvent` (typed + verified event discriminator).
- `app/lib/agent/contracts.ts` — `pcb_proposal_ready` event, `pcb-proposal`
  outcome kind, `pcbProposalBasis` on `AgentRunContext`, `AgentProposalArtifact`.
- `app/lib/agent/gateway.ts` — the PCB propose branch (`invokePcbEdit`), the
  third allowlisted id, the distinct outcome mapping.
- `app/lib/agent/loop.ts` — the PCB toolset gate + the `pcb-proposal`
  emission branch (distinct event, safe result text).
- `app/lib/agent/context.ts` — `pcbProposalBasis` shape validation +
  registry-known-preset check.
- `app/lib/agent/editor-context-bridge.ts` — `pcbProposalBasis` in the
  captured context + publisher read contract.
- `app/api/chat/route.ts` — `pcbProposalBasis` as an optional editor-context
  key, threaded into both assembly calls.
- `app/components/pcb/PcbEditor.tsx` — the review + human-gated apply
  (`pcbProposalDisableReason`, `applyPcbProposal`), the DRC-preset ref, the
  `pcbProposalBasis` capture, the dialog mount, new props.
- `app/page.tsx` — pending state, the `pcb_proposal_ready` event case, reset
  clearing, the three new PcbEditor props.
- `app/lib/engineering/tool-catalog.ts` — the `sirkit.pcb.propose-bounded-edit`
  descriptor (exposure 11→12).
- `app/lib/engineering/action-registry.ts` — `pcb.bounded-edit-propose` +
  `pcb.bounded-edit-apply` records.
- `app/lib/engineering/executor.ts` — `pcb.bounded-edit-apply` kernel
  operation binding (bounded vocabulary only).
- `app/lib/engineering/editor-adapter.ts` — additive `provenanceCandidateId`
  on `CanonicalCommitRequest` + `durableIdempotencyEvidence` for the PCB
  session.
- `app/lib/engineering/pcb-commit-gateway.ts` — additive
  `provenanceCandidateId` passthrough.

## Test edits (exposure pins 11→12)

`b04-tool-registry.test.ts` (exact id set + propose allowlist);
`b09-1-boundary`, `b09-2-closure`, `b09-3-closure`, `b12-boundary-and-e2e`,
and nine `b11-*` suites (`.size).toBe(12)`); `b15-2-core-closure` and
`b15-2-2-exact-outline-and-shape` §C (superseded to exactly 12 + one PCB
propose tool). The six B15 proposal-core suites also migrated their
`createSealedPcbEditProposal` fixtures from `rules: RULES` to
`validationPolicy: { presetId: DEFAULT_PRESET_ID }`.

## New tests

`app/lib/pcb/proposal/__tests__/b15-3-validation-policy.test.ts` (6),
`app/lib/agent/__tests__/b15-3-pcb-proposal-exposure.test.ts` (13),
`app/lib/engineering/__tests__/b15-3-approved-pcb-apply.test.ts` (18),
`app/lib/project/__tests__/b15-3-import-gates.test.ts` (8),
`app/lib/project/__tests__/b15-3-production-integration.test.tsx` (2).

## Regenerated artifacts (byte-stable across two runs)

b01 (toolability/route/fingerprint), b04 (registry/parity), b09 (agent
manifest), b11 (replay-trace-pins — new pin `aed49ee4402dd565`, legitimate
11→12 exposure drift).

## Not touched

The B15.2.x geometry/impact core, the schematic proposal/approval path, the
B12 schematic journal, provider adapters, manufacturing release, 3D control.
The protected original `C:/Users/robsa/sirkit` is at its exact 6-entry
baseline.
