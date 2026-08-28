# B12 — regression matrix

> **SUPERSESSION NOTE (B12.1).** Rows below claiming "the applied schematic
> reflects the exact proposed edit" and "any single tampered field fails"
> overstated coverage: the former asserted a command result no production
> surface displayed, and the latter covered 4 mutations while three forgery
> classes passed (counterexamples R1/R3). Both suites were updated to the
> corrected B12.1 contract; see
> `../ai-control-plane-b12-1/regression-matrix.md`. Preserved as historical
> evidence.


Every permanent B12 test and the requirement / reproduction it locks. **32
tests across two files, all passing.**

## `b12-approved-mutation.test.ts` — the service (19 tests)

Real `SchematicEditorSession` + `InMemoryAtomicProjectStore`; deterministic
clock (`SEAL_NOW = 1_700_000_000_000`, harness clock `SEAL_NOW + 1000`).

| Test | Locks |
| --- | --- |
| sealing a proposal does not touch schematic, revision, or head | R1 |
| cancel produces no receipt and no committed audit event | R2 |
| apply commits exactly one canonical transaction and emits a verified receipt | R3, §A, §D |
| undo restores the exact pre-apply schematic digest and lineage | R8 |
| the applied schematic reflects the EXACT proposed edit | §A (exact ops, no reinterpretation) |
| concurrent apply of the same proposal converges on ONE transaction | R4, §C |
| a sequential replay returns an idempotent already-applied result with the ORIGINAL receipt | R4, §C |
| a failed preflight does NOT consume the proposal | §C (release, not consume) |
| an unverifiable commit poisons the identity so it can never retry into a double commit | §C (poison-on-unverifiable) |
| a not-ready session refuses without consuming the proposal | R6, §C |
| refuses each stale/altered/expired/foreign class with a controlled code and mutates nothing | R5 |
| a head-advanced proposal is stale — a real edit between seal and apply refuses | R5, §D |
| a throwing command build refuses with a controlled code, no receipt | R7 |
| a rejected canonical command surfaces its message, no receipt, no consume | R7, §C |
| records the lifecycle with controlled codes only | §E |
| a refusal records a controlled code, never raw exception text | §E |
| rejects malformed and hostile receipts with bounded issues, never throwing | §B (totality) |
| a real receipt validates, and any single tampered field fails | §B (soundness) |
| the receipt contains no schematic, prompt, or unrestricted content | §B (exposure) |

## `b12-boundary-and-e2e.test.ts` — boundary + end-to-end (13 tests)

| Test | Locks |
| --- | --- |
| static agent exposure is exactly NINE read/propose tools, and apply is not among them | §G.1 |
| the apply command has NO tool exposure and a destructive tier | §G.1 |
| no apply/approval descriptor appears in a fresh provider tool declaration set | §G.1 |
| the agent gateway executes ONLY read/propose classes — a mutate/destructive tool id is refused | §G.1 |
| no API route, agent runtime, tool registry, provider adapter, or approved-mutations service imports the internal channel | §G.2 |
| the approved-mutations service itself never imports the channel or its factory | §G.2 |
| the engineering barrel does not export the internal channel | §G.2 |
| top-level approval/approved/authority/interactiveChannel claims refuse | R9 |
| nested scope-level approval/interactiveChannel lookalikes refuse | R9 |
| the trace is deeply frozen and re-finalization returns the same document | R10 |
| (openai) scripted run → approval commits once → exact edit lands → undo restores → nothing mutates before apply | §H |
| (anthropic) scripted run → approval commits once → exact edit lands → undo restores → nothing mutates before apply | §H |
| normalized OpenAI and Anthropic runs produce equivalent sealed operations, no live provider used | §H (provider-neutral) |

## Coverage map — every requirement has a permanent test

| Requirement | Tests |
| --- | --- |
| R1 receiving mutates nothing | 1 |
| R2 canceling mutates nothing | 1 |
| R3 one verified transaction | 1 |
| R4 one-shot / concurrency | 3 |
| R5 stale/altered/expired/foreign fail closed | 2 |
| R6 not-ready refuses | 1 |
| R7 command failure cannot claim applied | 2 |
| R8 exact undo | 1 |
| R9 no serialized claim authorizes | 2 |
| R10 finalized trace immutable | 1 |
| §A shared approved-execution service | e2e + exact-ops |
| §B versioned receipt | 3 |
| §C one-shot / concurrency contract | 5 |
| §D postcondition verification | 2 |
| §E separate execution audit | 2 |
| §F production UI integration | `page.tsx` (`applyTier1Proposal`, receipt panel) |
| §G agent/tool boundary | 7 |
| §H end-to-end, no paid provider | 3 |
