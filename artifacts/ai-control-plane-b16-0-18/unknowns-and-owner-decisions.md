# B16.0.18 — Unknowns & owner decisions

## Decisions taken (documented)

1. **Deadline 30_000 verified** as the `scopedTrustedJson` reader default
   (this family also passes no `deadlineMs`). **CONFIRMED**.
2. **§E applied up front** — the propose route's error-boundary split and the
   schema-derived output validator shipped WITH the migration, per the mandate,
   instead of waiting for a corrective. The resulting 503→422 reclassification
   of local failures is an intentional, mandated contract change (recorded in
   [superseded-claims.md](superseded-claims.md)). **CONFIRMED**.
3. **No schema additions needed** — unlike B16.0.17.2's tool, the CD-6 tool
   schema already declared complete bounds (min/max lengths + maxItems on every
   node), so the validator derives everything with zero schema edits.
   **CONFIRMED**.
4. **Sourcing pin correction** — an empty body takes the non-`normalize` path
   (fail-closed 503); the required-field 400 pin sends
   `{"operation":"normalize"}`. Recorded, not normalized away. **CONFIRMED**.
5. **Two disclosed test-only cleanups** — the adapter test's fake-client mocks
   were reworked for lint/brace hygiene after first runs; behavior identical.

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN.**
- **Remaining migration: 49 raw methods** (baseline 52) — spice family, chat,
  replacement-authority, full-flow and misc routes, plus the 3 factory routes.
  **CONFIRMED**.
- Live-provider strict-mode enforcement rates remain UNKNOWN (zero credits);
  the local validator is the fail-closed guarantee regardless.

## Scope adherence

No live sourcing, purchasing, distributor calls, catalog ingestion, agent
mutation, automatic selection, or approval was added. Protected original
untouched. B16.0.19 / B16.1 / MCP / multi-agent / provider expansion NOT
started.
