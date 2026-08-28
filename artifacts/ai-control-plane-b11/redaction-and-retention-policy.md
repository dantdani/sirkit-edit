# B11 — redaction and retention policy

> **EXTENDED BY B11.2.** The redaction policy described here was enforced by
> a SERIALIZED-form denylist, which quote escaping defeated (B11.2 R3/R4). It
> is now enforced by a recursive scan of original key names and string values,
> plus the serialized scan as an independent second net. See
> [../ai-control-plane-b11-2/recursive-redaction-results.md](../ai-control-plane-b11-2/recursive-redaction-results.md).

> **SUPERSESSION NOTE (B11.1).** The sink-failure policy below was INCOMPLETE: a sink could MUTATE the recorder's own events and finalized document (it received recorder-owned references), a `complete`-only failure was swallowed without any diagnostic, and a throwing sink factory aborted `POST /api/chat`. B11.1 adds deep-frozen independent snapshots, the full failure-classification vocabulary, factory fallback, and validate-before-persist. See artifacts/ai-control-plane-b11-1/hostile-sink-isolation.md.

## Redaction (deterministic, at record time AND at validation)

`sanitizeTraceText` replaces every secret-shaped match with `[redacted]`
and truncates to the field bound. Patterns: OpenAI-style `sk-…`,
Anthropic-style `sk-ant-…`, `Bearer <token>`, `api_key|authorization|
x-api-key|secret|password|credential|access_token: <value>`, and
`ENV_VAR=<long value>` dumps. `containsSecretShapedText` is applied to the
whole serialized document at validation, so a trace assembled by any other
path still refuses if it carries secret-shaped content.

Structural redaction matters more than pattern matching: the recorder's
API accepts identities, closed-vocabulary classifications, and DIGESTS —
there is no parameter through which a raw provider body, continuation
state, tool output, board, schematic, or user prompt could enter. The
`trace-recorder.ts` code (comments stripped) contains no
`continuation`/`encrypted_content`/`thinking` identifier, and this is a
permanent test.

## Sink failure policy

`AgentTraceSink` has two methods (`append`, `complete`), both allowed to
throw. The recorder wraps every sink call: a throw is classified as
`trace_sink_failure` in `recorderDiagnostics` and nothing else happens —
no raw error detail is retained, no exception reaches the loop, the run's
authorization and terminal result are unchanged, and no second terminal
event can be produced. The production loop additionally wraps each
recorder call in its own `try/catch`, so even a recorder-internal defect
is inert with respect to run behavior. Evaluation case `e16-recorder-safety`
proves this end-to-end with a sink that throws on every call.

## Retention — an explicit future owner decision

B11 introduces **no durable retention**:

- `InMemoryTraceSink` is the reference implementation; the production
  route uses `createAgentTraceSink()`, whose default factory returns a
  run-local in-memory sink.
- No database, file, or network write exists anywhere in the trace path.
- `setAgentTraceSinkFactory` is the single injection point a future owner
  would use to attach durable storage.

**Deferred to the owner, deliberately unanswered here:** whether traces
are persisted at all; retention duration; storage location and encryption;
who may read them; whether trace access is audited; and whether the
`argsDigest`/`outputDigest` inputs should additionally be salted per
tenant to prevent dictionary correlation. None of these should be decided
implicitly by shipping code.

## Runtime trace vs replay capsule

The runtime trace is digest-only and CANNOT reconstruct model output — the
contract says so explicitly and the tests assert the absence of board,
schematic, prompt, and tool-output content. Reconstruction is possible only
from a replay capsule, which is an authored/generated sanitized fixture
used by tests and evaluation. Nothing in the production route or loop
writes a capsule.
