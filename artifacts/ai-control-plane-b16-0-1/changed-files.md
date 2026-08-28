# B16.0.1 — changed files (this stage only)

The repo carries every stage since the single base commit as uncommitted work;
this list is B16.0.1's own surface, grouped by section.

## New production modules
- `app/lib/auth/route-policy.ts` — the exact method-aware policy table (153 rows over 142 route files) + CSV renderer
- `app/lib/auth/authorize.ts` — the ONE authorization adapter (`authorizeRequest`, `authorizeActor`, `scopedTrustedJson`, `flatScopeOf`)
- `app/lib/engineering/proposal-authorization.ts` — the schematic-family §E binding
- `app/lib/project/membership-reauthorization.ts` — the family-neutral §F transport + evaluator
- `app/lib/project/pcb-apply-reauthorization.ts` — PCB face of §F (rewritten to delegate)
- `app/lib/project/session-identity.ts` — interactive session identity for client-side sealing
- `app/api/pcb/apply-authorization/route.ts` — the ONE narrow reauthorization endpoint
- `app/api/auth/signin/route.ts`, `app/api/auth/callback/route.ts`, `app/signin/page.tsx` — §H
- `scripts/generate-b16-0-1-artifacts.ts` — sanctioned CSV generator

## §A/§B/§C — route migration (identity headers → 0, roles + CSRF automatic)
- 15 `_scope.ts` families rewritten onto the adapter (pcb-sync, physical-bindings, assignment-queue, calculation, component-selection, circuit-knowledge, circuit-verification, schematic-compiler, model-simulation, firmware-bringup, release-engineering, full-flow, mapping-verification, footprint-resolution, passive-policy)
- 19 inline CD-stage routes (architecture ×5, interfaces ×6, power ×6, requirements ×2)
- 13 provider-credit AI routes (pcb/edit/assist, pcb/repair/agent, pcb/assign/suggest, pcb/ai-rules/from-brief, schematic ×8, spice/ai)
- 5 local-store routes (bom/snapshot, bom/notifications, spice/runs, spice/runs/[id], spice/models/import)
- 3 GET routes gained `await` on the now-async scope helpers
- Production defect fixes found during migration verification: `app/api/mapping-verification/_scope.ts` (restored forbidden-key list), `app/api/passive-policy/_scope.ts` (restored the authoritative-key regex screen), `app/api/full-flow/transition/route.ts` (total run validation — typed 409 instead of a crash)

## §D — verified actor
- `app/lib/agent/contracts.ts` (AgentActor sources/membershipRevision/authClass), `app/lib/agent/context.ts` (`VerifiedRunPrincipal`, `buildRunActor`), `app/api/chat/route.ts` (CSRF + role policy + verifiedActor threading)

## §E/§F — membership binding + reauthorization (all three families)
- Tier-1: `app/lib/engineering/schematic-proposals.ts` (v3), `approved-agent-mutations.ts` (reauth + receipt v2 + linkage/recovery guards), `approved-mutation-journal.ts` (authorization entry field, receipt coherence, immutability), `app/page.tsx` (schema constant, sealing binding, apply reauthorizer)
- Replacement: `replacement-proposals.ts` (v2), `replacement-proposal-assembler.ts`, `replacement-approval.internal.ts` (intent binding), `approved-replacement-mutations.ts` (receipt v2 + commitment + recovery), `app/lib/project/replacement-approval-controller.internal.ts` (§F), `app/lib/project/replacement-proposal-events.ts` (schema constant)
- PCB: `app/lib/pcb/proposal/sealed-pcb-edit-proposal.ts` (explicit v2 + binding + legacy code), `pcb-edit-proposal-sealer.internal.ts`, `pcb-edit-proposal-service.ts`, `pcb-propose-tool-handler.ts`, `app/lib/engineering/pcb-edit-approval.internal.ts` (intent binding), `approved-pcb-mutations.ts` + `approved-pcb-mutation-journal.ts` (journal/receipt/commitment/recovery), `app/lib/project/pcb-edit-approval-controller.internal.ts` (§F), `app/components/pcb/PcbEditor.tsx` (reauthorizer wiring)
- `app/lib/agent/gateway.ts` (binding derivation + threading), `app/lib/agent/loop.ts` (schema constant)

## §G — `app/lib/auth/mode.ts` (production-first resolution, escape hatch removed)

## §I + registry/coverage
- `app/lib/auth/route-coverage.ts` (derives from the policy table; legacy backlog EMPTY)
- `app/lib/engineering/action-registry.ts` (3 new routes + 2 action records + schema-string mention)
- Regenerated committed artifacts through sanctioned generators: `artifacts/ai-control-plane-b01/*` (registry matrices), `artifacts/ai-control-plane-b16-0/auth-route-coverage.csv`, `artifacts/ai-control-plane-b11/{replay-trace-pins.json, evaluation-results.json, evaluation-case-matrix.csv}` (only the e10 proposal-trace pin + derived digests), `artifacts/ai-control-plane-b16-0-1/exact-route-authorization-policy.csv`

## New permanent test suites (B16.0.1)
- `app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts` (23)
- `app/lib/auth/__tests__/b16-0-1-route-authorization.test.ts` (12)
- `app/lib/agent/__tests__/b16-0-1-verified-actor.test.ts` (4)
- `app/api/auth/__tests__/b16-0-1-signin.test.ts` (7)
- `app/api/chat/__tests__/b16-0-1-chat-authorization.test.ts` (4)
- `app/lib/project/__tests__/b16-0-1-apply-reauthorization.test.ts` (extended)
- `app/lib/engineering/__tests__/b16-0-1-tier1-authorization.test.ts` (15)
- `app/lib/engineering/__tests__/b16-0-1-replacement-authorization.test.ts` (14)

## Updated test files (contract-following, never weakened)
- 13 route-family suites (first repair pass), 3 lib-level API suites
  (footprint-resolver, physical-binding, requirements), ~30 b06/b09–b15
  suites across the three families (authorization fixtures, stub
  reauthorizers, schema constants, EXTENDED mutation matrices), the B16.0
  trusted-context test (stricter mode expectations), `b14-route-replacement`
  (v2 constant)

## Supersession notes added
- `artifacts/ai-control-plane-b16-0/{final-verdict.md, README.md, identity-and-approval-lifecycle.md, trusted-request-context.md}`
