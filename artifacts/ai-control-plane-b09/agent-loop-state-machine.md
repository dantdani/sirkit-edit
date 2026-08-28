# B09 — Agent Loop State Machine

```
 idle ─ run_started ─▶ toolset-build (fresh discovery over run context;
        │               agent-exposed ∩ active ∩ callable ∩ strict-compatible;
        │               collision-checked names; throw → run_failed toolset_invalid)
        ▼
     model-step (adapter.start / adapter.continueWith)
        │  text → text_delta
        ├─ no tool calls ──▶ run_completed (final text, steps, calls, usage)
        ├─ steps ≥ maxModelSteps ──▶ run_failed max_steps
        ├─ deadline exceeded ──▶ run_failed deadline
        ├─ signal aborted ──▶ run_failed cancelled
        ▼
     tool-batch (STRICTLY sequential, provider order, every call answered):
        for each call:
          resolve provider name ──✗──▶ unknown_tool error result (+warning)
          budget check ──✗──▶ budget_exhausted error result
          parse/size-check args ──✗──▶ invalid_input error result
          cycle check (id@version + canonical arg digest) ──✗──▶ repeated_call
          proposal single-flight ──✗──▶ proposal_exists
          tool_started → gateway.invoke (fresh discovery, full B05.1
            verification, deadline, signal) → tool_finished
            read ok      → {ok:true, revision, verification, output} (bounded)
            proposal ok  → proposal_ready event + summary result (never the
                           raw ops back to the provider beyond counts)
            blocked      → {ok:false, status:proposal_blocked, blockers}
            refused      → {ok:false, status, diagnostics} (redacted)
          abort/deadline recheck after every call
        ▼
     continueWith(continuation, results) ──▶ model-step
```

Invariants: no recursion; no concurrent proposal calls; a provider retry
can never re-execute a sealed proposal (single-flight per run); every
result is bounded redacted JSON with explicit ok/status; no cross-provider
fallback anywhere in the loop; provider errors surface as
`run_failed provider_<reason>` with the existing classification.
