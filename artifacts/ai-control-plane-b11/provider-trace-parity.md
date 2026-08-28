# B11 — provider trace parity

## Scope decision: no provider-specific metadata is evaluated

The B11 trace is **provider-neutral by construction**. It records only the
normalized provider label (`openai` | `anthropic`) and the normalized model
identifier the adapter already reports on each step. It captures **no**
provider-specific metadata and **no** provider request identifiers —
no OpenAI `response.id`, no `x-request-id`, no Anthropic `message.id` or
`request-id` header, no rate-limit headers, no system fingerprint.

Consequently the stage's conditional documentation requirement ("use
official current OpenAI and Anthropic primary documentation **if**
provider-specific metadata or request identifiers are evaluated") is **not
triggered**, and no provider request behavior was changed to collect extra
metadata — the adapters are byte-for-byte unchanged in this stage.

**Recorded honestly:** this artifact therefore cites no provider
documentation pages, because no claim in B11 depends on one. The
provider-shape claims that DO exist (flat OpenAI Responses function tools;
Anthropic strict tools; `disable_parallel_tool_use`; reasoning/thinking
blocks never leaving the adapter) were established and cited in the B09 and
B09.1 artifacts and are unchanged here.

**PROPOSED (not implemented):** capturing provider request identifiers
would materially improve upstream incident correlation. It requires (a)
verifying the current official response/header field names for both
providers against primary documentation, (b) an owner decision about
storing a provider-side correlator alongside project identity, and (c) a
redaction review — request ids are low-sensitivity but are still an
external identifier. B11 deliberately defers all three.

## Normalized parity that IS evaluated

Case `e03-valid-board` (OpenAI) and case `e14-parity-anthropic`
(Anthropic) script **equivalent normalized turns**: the same tool calls in
the same order against the same context. `normalizeTraceForParity` strips
run/trace identity, clocks, provider label, and model label, and the two
normalized traces must be **deeply equal**:

- identical scope and context digests;
- identical event sequence (`run_started` → `step` → `tool_invocation` ×2 →
  `step` → `terminal`);
- identical tool ids, versions, operation classes, `argsDigest`,
  `outcomeClass`, `status`, `verification`, and `outputDigest`;
- identical terminal outcome, step/tool counts, and usage;
- identical warnings and recorder diagnostics.

At the same time the traces stay truthfully distinct where they must be:
`trace.provider` differs and the two full trace digests differ. Both
assertions are permanent tests (`B11 §D`).

This is the parity property the control plane actually needs: the same
engineering situation produces the same auditable normalized record
regardless of which provider drove it, while the record never pretends the
two runs were the same run.
