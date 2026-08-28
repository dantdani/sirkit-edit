# B14 §H — providers, discovery, trace, replay

- **Gateway allowlist**: `ProposalInvocationService` matches EXACTLY two
  proposal bindings (Tier-1 and replacement), each by exact tool id +
  propose class + proposal-artifact side effects + bound-proposal status.
  Everything else refuses; mutate/destructive/release classes remain
  non-executable through the agent gateway.
- **One proposal per run, regardless of kind**: the loop's class-generic
  `proposalIssued` single-flight covers both proposal types — a second
  propose-class call in the same run refuses `proposal_exists`.
- **Provider parity**: `renderOpenAiResponsesTool` /
  `renderAnthropicAgentTool` produce byte-identical strict schemas for the
  replacement declaration (`additionalProperties: false`).
- **Withholding**: the tool is withheld without the canonical head mark
  (propose-class rule) and without the B13 `component-authority-records`
  resource (B14 rule), with the exact truthful reasons in the run warnings;
  dynamic discovery excludes it with its standard reasons
  (channel/lineage/authority) like every other tool.
- **`proposal_ready` union**: the event's `proposal` is the discriminated
  `SealedAgentProposal` (`SealedTier1Proposal | SealedReplacementProposal`,
  discriminated on `schema`); the page routes each kind to its own review
  boundary. The tool-result text to the model stays bounded and explicitly
  states nothing changed.
- **Traces**: replacement proposals record ONLY `proposalId` +
  `operationDigest` (as the bounded `proposalDigest`) through the existing
  `tool_invocation` normalization — args/output as digests, no authority
  records, pin tables, component blobs, or credentials (proven: the
  finalized trace contains neither asset ids nor plan content).
- **Apply is absent everywhere**: no apply tool exists in the registry, the
  catalog's destructive command keeps `toolExposure: "none"`, and provider
  schemas never carry it.

## The eleventh tool + regenerated artifacts (justification)

The static agent-exposed set grew 10 → 11 (the new tool is genuinely
callable under its required resources — proven through the REAL `/api/chat`
run). Consequences, all regenerated THROUGH GENERATORS (nothing
hand-edited):

- registry digest changed → every replay-capsule trace digest shifted →
  `artifacts/ai-control-plane-b11/` (pins/results/matrix) regenerated,
  byte-stable ×2 — final pins sha256 `e66dd9e06f48a658…`;
- `artifacts/ai-control-plane-b09/` (exposed-tool manifest, activation
  audit, provider parity, loop fixtures) regenerated — "11 statically
  exposed tools (28 registered)";
- `artifacts/ai-control-plane-b04/` (tool-registry renders) and the B01
  action/toolability matrices regenerated (new propose action
  `schematic.replace-component-propose` + the `/api/replacement-authority`
  route claim);
- thirteen suites' TEN → ELEVEN count/set assertions updated; per-run
  toolset assertions unchanged (no legacy context carries both a head mark
  and component authority, so existing expected toolsets are identical).

B05/B05.1 read-replay artifacts are UNCHANGED (`f18e47e0…` — the new tool
has no read binding), and the PCB foundation hashes are untouched.
