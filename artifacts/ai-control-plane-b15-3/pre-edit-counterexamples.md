# B15.3 — pre-edit discovery and reproductions

## Discovery (10 mandated items), recorded before editing

1. **Agent exposure was exactly 11, no PCB proposal tool.** `grep -c "agentExposed: true" app/lib/engineering/tool-catalog.ts` = 11; the exact 11 ids were the two revision inspectors, schematic inspect + two schematic propose tools, board-inspect, drc-run, connectivity-verify, selection.inspect, component-authority.inspect, manufacturing.readiness-inspect. No `sirkit.pcb.*propose*` mutation/apply tool existed.
2. **`SealedAgentProposal` did NOT carry the PCB proposal.** `contracts.ts:18` — `SealedTier1Proposal | SealedReplacementProposal` only; `AgentRunEvent` had `proposal_ready` carrying `SealedAgentProposal`, no `pcb_proposal_ready`.
3. **The loop recognized only the two schematic families.** `loop.ts:360` discriminated `schema === "sirkit.schematic-replacement-proposal.v1"` and read `baseSchematicDigest`/`impacts` — fields a PCB proposal does not have.
4. **A fabricated `pcb_proposal_ready`-like object could not mutate.** Probe: `receivePcbProposalEvent({ proposal: { schema: "sirkit.pcb-bounded-edit-proposal.v1", evil: true } })` returned an object (safe narrowing only), and `verifySealedPcbEditProposalIntegrity` refused it `{ok:false, code:"malformed", detail:"…unknown field (evil)."}`; the board revision was unchanged. Receiving/displaying grants nothing — confirmed.
5. **No provider/route/gateway/loop module imported `commitPcbCandidate`.** `grep commitPcbCandidate app/api` = none; all production importers were in-editor PCB surfaces (`app/components/pcb/*`, `app/lib/pcb/repair/transaction.ts`, `app/lib/pcb/ai/pcb-tool-service.ts`).
6. **`PcbEditor` owns the live board + PCB history.** `useReducer` board state; `bindCanonicalEditorSession` wraps the history; the only inbound coupling was the READ-ONLY editor-context pull publisher — no inbound agent-event apply path existed.
7. **No PCB approval controller or PCB durable apply journal existed.** `Glob **/*pcb*{approval,journal,apply}*` = none.
8. **The raw-sealer allowlist was exactly two modules** (`pcb-edit-proposal-sealer.internal.ts`, `pcb-edit-proposal-service.ts`), with the standing B15.2.2 §C tripwire naming `pcb-propose-tool-handler.ts` as the future handler.
9. **The proposal did not let the provider supply authority-bearing state** — the B15 core already derived `base.pcbRevisionId`/`boardDigest` from the board; but exposure had never wired a handler.
10. **THE GATE — the sealed proposal did NOT pin the validation policy.** Probe output, recorded verbatim (disposable `b15-3-probe.test.ts`, deleted after capture):

```
PROBE_ITEM10 {"keys":["schema","proposalId","nonce","scope","base","intent","operations","operationsDigest","candidateDigest","impact","impactDigest","mintedObjectIds","tool","actor","effectiveActor","discovery","provenance","createdAt","expiresAt","approvalTier"],"hasValidationPolicyField":false,"identicalBodiesAcrossDifferentPresets":true,"bothVerify":[{"ok":true},{"ok":true}]}
PROBE_ITEM4 {"narrowedIsObjectOnly":true,"verifierRefusesIt":{"ok":false,"code":"malformed","detail":"The PCB proposal carries an unknown field (evil)."},"boardUntouched":true}
```

The **same board + payload sealed under `jlcpcb-2l` vs `oshpark-4l` produced BYTE-IDENTICAL verifying bodies** — the DRC preset (and its rules) that the impact evidence was computed under was provably UNPINNED. Per the stage's item-10 instruction, exposure was BLOCKED until this closed.

## Closure of the item-10 gate (before any exposure)

`sealed-pcb-edit-proposal.ts` gained `validationPolicy: { presetId, presetVersion, rulesDigest, compileSchema }` inside the identity-digested body, resolved from the ONE authority `resolvePcbValidationPolicy(presetId)` over the canonical in-repo preset registry. The service no longer accepts a caller `rules` object — it names a preset; the sealer and verifier both recompute the rules digest from the registry, so a proposal compiled under rules that no longer match its named preset refuses. Permanent regression suite `b15-3-validation-policy.test.ts` (6) proves: different presets no longer produce identical bodies; a forged rulesDigest / unknown preset / wrong version / foreign compile schema / cross-preset digest swap all refuse `malformed`; a smuggled `rules` object is inert. Only after this went green was `agentExposed: true` set.
