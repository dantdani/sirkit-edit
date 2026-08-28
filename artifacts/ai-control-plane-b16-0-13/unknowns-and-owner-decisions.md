# B16.0.13 — Unknowns & owner decisions

## Excluded routes (documented incompatibilities, NO escape hatch added)

1. **`/api/pcb/apply-authorization`** — reads a strictly bounded body-selector
   envelope BEFORE trusted-context resolution (the B16.0.1 §F membership
   reauthorization protocol). `authenticatedJsonRoute` authorizes before the
   body, so this surface needs the dedicated selector-envelope wrapper variant
   (specified since B16.0.7) before it can migrate.
2. **`/api/pcb/assign/suggest`** — derives an internal fetch origin from the
   raw request URL; migrating it first requires extracting that into a
   service-boundary (config-derived origin), or the callback would need raw-URL
   capability. Deferred to its own tranche with that extraction.
3. **`/api/pcb/qualify` and `/api/pcb/release`** — the manufacturing
   qualification/release authority chain; excluded per the mandate and
   untouched (internal-only invariants proven in the full run).

None of these gained an escape hatch; they remain raw, in the baseline, and
gated by the standing analyzer/boundary gates.

## Documented behaviors preserved (not silently altered)

- **Gerbers kind-guard branch** — the old in-route 401 `unauthenticated`
  non-authenticated-kind branch is unreachable under the authenticated policy
  row; the wrapper's uniform 403 `AUTH_UNSUPPORTED_PRINCIPAL` replaces it (same
  pattern as tranches 4–5; observable in no pinned contract).
- **Advisory routes ignore trusted context** — the three provider routes never
  consumed identity; their callbacks take `{ body }` only. Adding scope
  cross-checks would be a new contract, not a migration.

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN**.
- Remaining migration: **81 raw methods** (baseline 84) — spice family, chat,
  replacement-authority, calculation/schematic-compiler/full-flow and other
  `_scope` families, the four excluded PCB routes, and the factory routes.

## Scope adherence

Work confined to `sirkit-edit`; protected original untouched; no provider
credits; no live FreeRouting/KiCad; no DB writes; no prompt/provider changes;
B16.0.14 / B16.1 / MCP / multi-agent / agent-tool expansion NOT started.
