# B16.0.21 — Unknowns & owner decisions

## Decisions taken

1. **Limits verified**: 64 MB / reader-default 30 s across all three families;
   named constants added to each `_scope.ts`. **CONFIRMED**.
2. **§D transition-gate correction** — reproduced verbatim, documented with
   the mitigating trusted-context fact, then narrowed to refuse ANY non-human
   actor (same 403 body). The historical error text ("LLM proposals cannot
   commit run transitions") was kept to preserve the pinned contract for the
   `ai` case; it now also covers the other non-human kinds. **CONFIRMED**.
3. **fb/problem's 409-on-empty-body recorded as-is** — the route has no
   required-field 400; the compiler's refusal is the historical contract.
   **CONFIRMED**.
4. **`trustedContext` rename in full-flow/run** — mechanical collision fix
   (the route's own `pinRunContext` result is named `context`); disclosed, no
   behavior change. **CONFIRMED**.
5. **No provider work in this tranche** — §F satisfied by absence and gated
   permanently. **CONFIRMED**.

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN.**
- **Remaining migration: 26 raw methods** (baseline 29) — the spice family,
  chat, replacement-authority, and misc routes, plus the 3 factory routes.
  **CONFIRMED**.

## Scope adherence

No firmware flashing, device access, external execution, MCP, multi-agent,
provider expansion, or manufacturing-release expansion. Protected original
untouched. B16.0.22 / B16.1 NOT started.
