# B16.0.20 — Unknowns & owner decisions

## Decisions taken

1. **Deadline verified** as the reader default 30_000. **CONFIRMED**.
2. **§C execute-gate correction** — reproduced verbatim (condition probe +
   live end-to-end probe through the raw route), documented with the
   mitigating trusted-context fact, then narrowed to refuse ANY non-human
   actor. No authority was widened; human+automation still passes the gate to
   input validation, matching the policy row. **CONFIRMED**.
3. **/propose left deterministic** — not converted to a provider-backed route
   (mandate); its input filtering is the historical typed pass-through, with
   `proposedBy` forced from trusted context (attacker field ignored, pinned).
   **CONFIRMED**.
4. **Verdict-path pins use pass-through spies** over the REAL
   compile/authorize/readiness functions, overridden only to select specific
   verdicts (BLOCKED BY CD-9, denied, authoritative) — full domain behavior
   stays covered by the unchanged domain suites. **CONFIRMED**.

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN.**
- **Remaining migration: 34 raw methods** (baseline 37) — spice family, chat,
  replacement-authority, full-flow and misc routes, plus the 3 factory routes.
  **CONFIRMED**.
- The sandbox image/executable + environment corpus for the authoritative
  runner remain UNVALIDATED — the 501 block stands until that independent
  validation happens (explicitly out of scope).

## Scope adherence

No runner implementation, subprocess/container/network execution, external
simulator calls, or provider expansion. Protected original untouched.
B16.0.21 / B16.1 / MCP / multi-agent NOT started.
