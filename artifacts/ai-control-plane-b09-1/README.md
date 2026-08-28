# AI Control Plane — B09.1: Agent Boundary Integrity and Runtime Recovery Closure

Corrective stage over the accepted B09 structure. The provider-neutral
loop, the B05/B05.1 read service, the trusted schematic session, the
canonical executor, the explicit review/apply flow, the B07/B08 ownership
rules, and the no-fallback rule are all preserved unchanged in shape;
nine verifier findings are closed (see `verifier-findings-closure.md`).

## Closures (1–9)

1. **Scope/lineage-sealed V2 proposals** — `sirkit.schematic-tier1-proposal.v2`
   seals `{tenantId, projectId, branchId}` + the authoritative session head
   mark `{lineageId, headSequence, canonicalStateDigest}` into the artifact
   AND its identity digest. `sealTier1Proposal` requires the scope;
   `verifySealedTier1Proposal` requires the CURRENT expected scope/head
   (new codes: `wrong-version`, `foreign-scope`, `stale-head`); V1 is never
   interpreted as V2. The page seals/verifies with the ready
   `SchematicEditorSession`'s mark; the chat route receives the mark as a
   sealing LABEL only; missing/malformed/not-ready marks fail the proposal
   tool closed (declaration withheld + invocation refused) while reads
   continue. The verification-to-execution race is closed INSIDE the
   session's serialized queue (`expectedHeadMark` precondition,
   `EXPECTED_HEAD_MARK_MISMATCH`). One producer/consumer format everywhere
   — page edit-flow, agent gateway, review/apply, all tests. Adversarial
   proof: b09-1-boundary §1 (cross-project byte-identical, cross-branch,
   foreign lineage, head-advance-and-return replay, tampered scope fields,
   V1/malformed/stale/altered/expired, exactly-once apply + exact undo,
   receive/cancel mutate nothing).
2. **Deep PCB working-copy validation** — `assembleAgentRunContext` runs
   the REAL `validatePcbBoardStructure` (and treats validator throws as
   invalid). Invalid boards never yield `board-present` state or verified
   envelopes; the sealed canonical envelope then carries the empty
   substitute, board tools are undiscoverable, and schematic-only chat
   continues with a safe warning (b09-1-boundary §2).
3. **Provider-failure recovery UI** — NDJSON `run_failed provider_*`
   (except `provider_cancelled`) now dispatches the SAME owned global
   failure event via the new shared `dispatchAiProviderFailure`
   (ai-preferences; the legacy JSON path delegates to it — one dispatch
   truth). The existing Retry / Use-other-provider card reappears; retry
   is a NEW `send()` run; stale owners dispatch nothing and stale retry
   closures are inert (b09-1-recovery, 4 tests). Live provider behavior
   remains UNKNOWN (no funded accounts); deterministic tests authoritative.
4. **Fail-closed strict wire subset** — `validateWireSubset` (recursive
   keyword allowlist: type/description/properties/required/
   additionalProperties/items/enum/anyOf/const/title) runs inside
   `toStrictSchema`; `minItems`/`maxItems`/`maxLength`/`minimum`/`pattern`/
   `oneOf`/… are rejected, never forwarded or weakened.
   `buildAgentToolDeclarations` throws on explicit incompatibles;
   `buildRunToolset` excludes with a safe diagnostic; the EXPOSURE GATE
   proves a future `agentExposed:true` descriptor with a wire-incompatible
   schema cannot reach the model. Two catalog schemas moved their length
   bounds into server-side validation (B05 input limits still bound them:
   2000 items / 10k chars); the proposal's 1–20 op bound stays in
   `parseOps`.
5. **Run deadline during awaits** — the loop owns an AbortController
   composing the caller signal with a deadline timer; the composed signal
   reaches provider start, continuation, and gateway calls. Deadline vs
   external cancellation stay deterministically distinguishable; timers/
   listeners are cleaned on every exit (finally). Five fake-adapter tests,
   all sub-second.
6. **Event order + provenance** — `run_started` is always the first event,
   exactly once; context warnings follow it (route passes them through
   `contextWarnings`). The gateway invocation contract carries the ACTUAL
   selected provider; proposal provenance records `openai`/`anthropic`,
   never `"agent"`; opaque continuation state never appears in events/
   artifacts (asserted).
7. **Catalog truth** — create-via/zone-edit/dimension reconciled with B08
   reality at 1.1.0: canonical interactive implementations exist (commit
   gateway → CanonicalExecutor; dimension is implemented and `active`, no
   longer draft/"missing") while explicitly distinguishing that NO agent
   tool adapter exists (callability stays closed, agentExposed:false).
   The nonexistent `app/lib/agent/proposal-gateway.ts` evidence path is
   replaced by `app/lib/agent/gateway.ts`. Manifests/audits regenerated;
   the exposed count remains EXACTLY 8.
8. **B04 provider-contract supersession** — `tool-provider-adapters.ts` is
   now a clearly deprecated compatibility wrapper delegating to
   `app/lib/agent/provider-tools.ts` (the ONE rendering truth): flat
   OpenAI Responses shape + strict Anthropic shape; incompatible schemas
   fail closed; the parity artifact is regenerated as
   `sirkit.provider-schema-parity.v2` with a visible supersession note.
   No duplicated conversion/name-mapping logic remains.
9. **Cleanup** — unused imports removed; every claimed B09/B09.1 file
   lints with zero errors AND zero warnings; the premature
   `producerVersion: "b09.1"` label became the stable assembler version
   `"1.1.0"`; the eight-tool exposure invariant is pinned by the b04
   tripwire; no new dependencies/migrations/MCP/multi-agent/mutation
   tools/fallback/release behavior.

## Validation

See `validation-report.md` for exact counts.
