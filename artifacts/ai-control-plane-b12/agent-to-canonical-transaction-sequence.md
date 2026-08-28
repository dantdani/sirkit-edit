# B12 §H — agent → approval → canonical transaction, provider-neutral

> **SUPERSESSION NOTE (B12.1).** The sequence below ends at the service's
> command result; in production nothing adopted that result — the editor
> state and SchematicHistory never changed (counterexample R1), and the §H
> tests labeled `commandResult.state` "the displayed schematic" without any
> display occurring. Superseded by
> `../ai-control-plane-b12-1/production-ui-undo-evidence.md` (the
> coordinator-adopted sequence with real history and UI undo). Preserved as
> historical evidence.


The end-to-end proof runs the **real** production pieces — `runAgentLoop` +
`createAgentToolGateway` + `assembleAgentRunContext` + the real
`SchematicEditorSession` + the real `applyApprovedTier1Proposal` service — with
**no paid provider**. The only substitution is a scripted `ProviderAgentAdapter`
that returns a canned tool-call sequence, exactly as the B11 replay
infrastructure does. **No live provider call is made; no credits are spent.**

## The sequence

```
┌────────────┐   scripted adapter (openai | anthropic), no live call
│  MODEL     │   emits nine-tool read/propose calls, culminating in a
│  (loop)    │   schematic Tier-1 PROPOSE  ──────────────────────────┐
└────────────┘                                                       │
                                                                     ▼
                                                         proposal_ready event
                                                         (sealed sirkit.schematic-
                                                          tier1-proposal.v2)
                                                                     │
   the loop STOPS here — the model has no apply tool                 │
                                                                     ▼
┌────────────┐   a DIFFERENT actor: the human at the interactive root
│  HUMAN     │   holds the live SchematicEditorSession and clicks Apply
└────────────┘                                                       │
                                                                     ▼
                                          applyApprovedTier1Proposal(...)
                                          verify → claim → execute EXACT ops → §D → receipt
                                                                     │
                                                                     ▼
                                          committed: one canonical transaction,
                                          verified receipt, head advanced by one
                                                                     │
                          ┌──────────────────────┬───────────────────┘
                          ▼                       ▼
                   undo restores            replay ⇒ already-applied
                   the exact pre-apply      (ORIGINAL receipt, no
                   digest + lineage         second commit)
```

## What §H asserts (permanent tests)

For **each** provider shape (`openai` and `anthropic`):

- a scripted run through the production `runAgentLoop` seals a proposal and
  emits `proposal_ready`;
- **nothing mutates before apply** — the schematic, revision, and head are
  unchanged while the proposal sits awaiting approval;
- approval via `applyApprovedTier1Proposal` **commits once**: the **exact**
  proposed edit lands (verified against the resulting schematic), the receipt is
  `committed`/`verified`, the head advanced by exactly one;
- **undo restores** the exact pre-apply canonical digest and lineage;
- a **replay** returns `already-applied` with the original receipt — no second
  commit.

Plus the provider-neutrality assertion:

- **normalized OpenAI and Anthropic runs produce equivalent sealed
  operations** — equal `operationsDigest` — so the mutation path is identical
  regardless of provider shape, and **no live provider is used.**

## Why this is the real path, not a reimplementation

The stage requires the proof to exercise production code. The test drives the
same `runAgentLoop`, the same gateway that enforces the nine-tool read/propose
boundary, the same `assembleAgentRunContext`, the same
`SchematicEditorSession.execute`, and the same `applyApprovedTier1Proposal`
service that `page.tsx` calls. The scripted adapter replaces **only** the
network boundary — the thing that would cost credits — leaving every authority,
sealing, verification, execution, and postcondition check in the production
path.
