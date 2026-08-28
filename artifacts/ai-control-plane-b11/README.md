# B11 — Provider-Neutral Run Tracing, Deterministic Replay, and Evaluation Foundation

> **PARTLY SUPERSEDED BY B11.1 AND B11.2.** B11's capsule/context validation,
> trace secret scanning, recorder totality, and validator bounds were all
> strengthened after adversarial reproduction. Current state:
> [../ai-control-plane-b11-2/](../ai-control-plane-b11-2/README.md).

B11 adds an observability/evaluation boundary around the EXISTING
single-agent runtime. It exposes no new tools, executes no mutations,
authorizes no manufacturing release, adds no MCP, adds no second agent, and
changes no provider fallback policy. Static agent exposure remains exactly
NINE tool ids.

## Documents

| Document | Content |
| --- | --- |
| [pre-edit-observability-gaps.md](pre-edit-observability-gaps.md) | The six discovery findings + the pre-edit exposure audit |
| [run-trace-contract.md](run-trace-contract.md) | `sirkit.agent-run-trace.v1`: fields, bounds, closed vocabularies |
| [redaction-and-retention-policy.md](redaction-and-retention-policy.md) | Denylist, sanitizer, sink policy, retention as an owner decision |
| [deterministic-replay-contract.md](deterministic-replay-contract.md) | Capsule vs trace; what replay verifies; determinism sources |
| [evaluation-case-matrix.csv](evaluation-case-matrix.csv) | Generated: 19 permanent cases, advertised tools, outcomes |
| [evaluation-results.json](evaluation-results.json) | Generated: deterministic scored report (digest-pinned) |
| [replay-trace-pins.json](replay-trace-pins.json) | Generated: committed per-case trace digests (drift detection) |
| [provider-trace-parity.md](provider-trace-parity.md) | OpenAI/Anthropic normalized parity + cited official docs |
| [validation-summary.md](validation-summary.md) | Battery counts, gates, UNKNOWNs, verdict |

## What B11 added

- **`app/lib/agent/trace.ts`** — the versioned run-trace contract: exact
  keys, bounds, closed vocabularies, a secret-shaped-content denylist, a
  deterministic sanitizer, and a validator that refuses unknown keys,
  unknown vocabulary, oversized fields, post-terminal events, and any
  document containing secret-shaped text.
- **`app/lib/agent/trace-recorder.ts`** — the injectable recorder + sink
  boundary. Identity is frozen at construction; recording is passive (no
  method throws to the caller); exactly one `run_started` and one terminal
  record; post-terminal appends are refused and classified; totals are
  computed from the recorder's own ledger. `AgentTraceSink` is the storage
  interface with an in-memory reference implementation — durable retention
  is deliberately NOT introduced.
- **`app/lib/agent/replay-capsule.ts`** — the distinct sanitized fixture
  contract (`sirkit.agent-replay-capsule.v1`) plus the provider-free replay
  engine over the real registry, discovery, context-integrity boundary,
  gateway, normalized loop, scripted adapter, and recorder.
- **`app/lib/agent/evaluation.ts` + `evaluation-cases.ts`** — versioned
  case/report schemas, deterministic scoring, and the 19 permanent cases
  covering the 16 required behaviors.
- **Production wiring** — `loop.ts` mirrors normalized events into an
  optional recorder (passive; wrapped so a recorder defect can never change
  authorization or outcomes); `app/api/chat/route.ts` constructs one
  recorder per run and finalizes/validates the trace.
- **`scripts/generate-b11-artifacts.ts`** — the ONE deterministic
  generator; byte-stable across runs (verified by diffing three runs).

## Two findings the harness produced immediately

1. **Proposal sealing was clock-dependent** in replay (`Date.now()` via the
   gateway's default clock), so a proposal run's trace digest was not
   reproducible. Replay now injects its deterministic clock into the
   gateway, making sealed proposal identity reproducible.
2. **Cycle detection caps identical calls at `maxIdenticalCalls`** before
   invocation, so a repeated-call run traces two invocations, not five. The
   evaluation matrix now records that real behavior instead of an assumed one.
