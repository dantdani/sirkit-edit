# B09 — Provider Failure / Fallback / Retry Policy

- The selected provider is EXPLICIT (`provider` in the run request; chosen
  by the user's brain setting). The loop contains no fallback code path.
- No silent cross-provider fallback exists, before or after tools. (No
  current product setting enables automatic fallback; if one is ever
  added, it may act only BEFORE the first tool invocation — the loop
  structurally cannot restart after a tool result or proposal exists.)
- After any tool result or proposal artifact exists, a provider failure
  ends the run as `run_failed provider_<reason>` on the SAME run id.
- A user-requested provider switch is a NEW run with a NEW run id (the
  chat client issues a fresh request; runs are never resumed cross-provider).
- Failure classification is preserved end to end
  (`LLMProviderError.reason`): rate_limit, insufficient_quota,
  authentication, missing_credentials, model_access, timeout, network,
  overloaded, cancelled, bad_request, unknown — each surfaces as
  `run_failed` with reason `provider_<reason>` and the existing friendly
  message; the chat UI offers its existing explicit recovery actions.
- SDK-level retries: OpenAI client maxRetries=2 (transport-level,
  idempotent request replay only); a network retry can never re-execute a
  Sirkit tool (results are computed once per call id; proposal issuance is
  single-flight per run).
- Never surfaced: credential values, provider request/response bodies,
  stack traces, unbounded upstream diagnostics. Recorded: provider id,
  model name, run id, usage token counts.
