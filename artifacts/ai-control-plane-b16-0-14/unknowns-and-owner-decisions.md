# B16.0.14 — Unknowns & owner decisions

## Recorded historical behaviors (preserved, not silently changed)

1. **apply-authorization rejects text/plain** — determined empirically (415
   `body-unsupported-media-type`), not assumed. The selector-envelope wrapper
   preserves the exact legacy code via its declarative refusal contract rather
   than emitting the generic `AUTH_MEDIA_TYPE_UNSUPPORTED`.
2. **Selector-envelope ordering is NOT "auth before body"** — membership is
   keyed by the in-body selector, so identity/membership/role authorization
   necessarily follow selector extraction. Documented truthfully; only CSRF and
   bounded parsing precede the body.
3. **assign/suggest internal >500-char query** — pre-migration a model query
   over 500 chars produced an HTTP 400 round-trip surfaced as
   `search failed (400)`; post-migration the direct service call has no 500-char
   cap, so such a query would run the search. This path is not reachable by the
   pinned flows (the model emits short lookup queries) and is a benign
   consequence of removing the HTTP hop — the public route's own 500-char guard
   is unchanged for external callers. Flagged here rather than papered over.

## Still excluded (unchanged from B16.0.13)

- `/api/pcb/qualify` and `/api/pcb/release` — the manufacturing
  qualification/release authority chain; untouched, internal-only invariants
  proven in the full run.

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN** (identity/membership via
  injection seams only; no live services contacted).
- Remaining migration: **79 raw methods** (baseline 82) — spice family, chat,
  replacement-authority, calculation/schematic-compiler/full-flow and other
  `_scope` families, qualify/release, and the factory routes.

## Scope adherence

Work confined to `sirkit-edit`; protected original untouched; no provider or
embedding credits; no live DB; no network; no prompt/provider changes;
B16.0.15 / B16.1 / MCP / multi-agent NOT started.
