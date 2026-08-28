# B16.0.12 — Unknowns & owner decisions

## Documented behaviors preserved (not silently altered)

1. **KiCad HTTP-library routes bypass the policy adapter** (historical,
   B16.0.8-documented): `kicadLibraryRoute` runs ONLY the constant-time token
   boundary — the external KiCad client protocol (trailing-slash URL shapes)
   is incompatible with the exact-path policy lookup. Unchanged this stage;
   the category route now shares that audited variant.
2. **`/api/parts/[id]` malformed-id 200 `{part:null}`** — historically a
   soft-null, not a 404 (unlike footprints' 404). Preserved and pinned;
   normalizing it is a client-visible change for a future owner decision.
3. **Volatile export/preview tokens** — the kicad-pcb writer's per-element
   random UUIDs and the placement engine's per-run `runId`/`elapsedMs` are
   historical; parity is pinned modulo exactly those tokens. Making the writer
   UUID-deterministic would change file bytes for every consumer — owner
   decision if ever desired.
4. **Wrapper query bounds now clip beyond-bounds inputs** (2,048-char values /
   64 keys) before route code — previously unbounded strings could reach
   route-level checks. In-bounds behavior identical; the clip is the intended
   §D hardening.

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN** (no live services
  contacted).
- Remaining migration: **86 raw methods** (baseline 89) — spice, pcb
  mutation/provider, chat, replacement-authority, calculation,
  schematic-compiler, full-flow, and other families; chat +
  replacement-authority still need their dedicated streaming/selector wrapper
  variants; SPICE process and manufacturing-release routes are deliberately
  excluded until their own tranches.

## Scope adherence

Work confined to `sirkit-edit`; `C:\Users\robsa\sirkit` untouched; no live
DB/embedding/provider/external calls; no provider credits; no prompt/provider
changes; B16.0.13 / B16.1 / MCP / multi-agent NOT started.
