# B14.1 — changed files

## New production modules

- `app/lib/engineering/replacement-approval.internal.ts` — the branded
  one-shot `ReplacementApprovalIntent` (issue/consume/retire; module-private
  registry; import-boundary gated).
- `app/lib/project/replacement-approval-controller.ts` — the trusted
  interactive boundary: production proposal-event consumer + the ONLY apply
  invoker (issues the intent, constructs the production channel).

## Rewritten / edited production modules

- `app/lib/project/replacement-reauthorization.ts` — REWRITTEN: branded
  one-shot `ReplacementReauthorizationChannel`; zero-parameter production
  factory over the platform same-origin fetch; `consumeReplacementReauthorization`
  (instanceof + one-shot + nonce/lifetime provenance); gated test-only
  factory. The structural `ReplacementReauthorization` interface is gone.
- `app/lib/engineering/approved-replacement-mutations.ts` — the input now
  requires `approval` (consumed via the intent module at step 1b, refusing
  `approval-required` before any journal/canonical work) and
  `reauthorization` (consumed via the channel inside the serialized gateway,
  before `journal.prepare`); `approvalActor` documented as
  written-only-after-consumption; `ReplacementRefusalCode` gains
  `approval-required`.
- `app/lib/engineering/approved-agent-mutations.ts` — audit-entry code union
  widened by the one additive member (no behavioural change).
- `app/api/replacement-authority/route.ts` — honest scope boundary
  (server-derived local tenant/branch, 403 locator mismatch before the
  loader, server-constructed loader scope), UTF-8 byte bound, corrected
  header claims.
- `app/page.tsx` — the Apply handler delegates to
  `approveAndApplyReplacement`; the `proposal_ready` case delegates to
  `receiveReplacementProposalEvent` (the tested consumer); still exactly the
  14-problem lint baseline.

## Tests

- NEW `app/lib/engineering/__tests__/b14-1-approval-and-reauthorization.test.ts` (10).
- NEW `app/lib/project/__tests__/b14-1-production-integration.test.tsx` (3).
- UPDATED `b14-replacement-apply.test.ts` (controller-mirroring harness),
  `b14-route-replacement.test.ts` (honest scope + 2 new cases),
  `b14-replacement-review.test.tsx` (tripwire retarget).

## Artifacts

- NEW `artifacts/ai-control-plane-b14-1/` (9 documents).
- Supersession notes added to four B14 documents (historical text preserved):
  `authority-reauthorization-boundary.md`, `approved-replacement-execution.md`,
  `regression-evidence.md`, `final-verdict.md`.

## NOT changed

Tool catalog, action registry, tool bindings, provider adapters, agent
gateway/loop/contracts, journal schemas, receipt schemas, B03 interactive
channel, dependencies, provider configuration — the registry digest is
untouched, so NO generated artifact moved (b11 pins re-run byte-identical
`e66dd9e06f48a658…`; b05 `f18e47e0…`; PCB hashes `72ad7c77…`/`5501d810…`).
