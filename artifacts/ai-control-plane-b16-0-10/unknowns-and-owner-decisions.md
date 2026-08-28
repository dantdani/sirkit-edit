# B16.0.10 — Unknowns & owner decisions

## Pre-existing loosenesses documented (preserved, NOT silently altered)

1. **`/api/schematic` response idiosyncrasy** — the historical success response
   is the BARE netlist object (no `ok` envelope), errors use `{ error }` with no
   `ok:false`, and no `Cache-Control: no-store` is set on any of its responses.
   This is a legacy contract the client depends on; the mandate forbids casual
   normalization, so it is preserved exactly and pinned. **Owner decision:**
   whether a later stage should normalize it to the `{ ok, … }` + no-store
   convention (a client-visible contract change).
2. **No scope cross-checks in the schematic family** — unlike the design-family
   routes, these prompt-based routes carry no body project/branch fields to
   cross-check. Authorization still binds each call to the authenticated
   project selector; there is simply no body-side scope to validate. Preserved
   as-is (adding one would be a new contract, not a migration).
3. **`build-multi` planner fallback** — on a non-provider planner failure the
   route logs a warning and silently falls back to the single build loop
   (historical). Preserved; pinned indirectly by the single-block valid path.

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN** (no live DB contacted —
  all identity via injected seams).
- The remaining migration: **110 raw methods** (baseline 113 incl. 3 factories'
  entries) across spice, bom, pcb, chat, calculation, and other families —
  future tranches; the high-risk streaming routes (chat, replacement-authority)
  still need their dedicated wrapper variants before migrating.

## Scope adherence

Work confined to `sirkit-edit`; `C:\Users\robsa\sirkit` untouched (its dirty
files still predate these sessions); no provider credits; no DB writes; no
prompt or provider-configuration changes; B16.0.11 / B16.1 / MCP / multi-agent /
manufacturing-release exposure NOT started.
