# B16.0.15 — Unknowns & owner decisions

## Owner decisions taken (documented, reversible)

1. **Deadline discovered, not invented** — `scopedTrustedJson` passed no
   `deadlineMs`, so the reader default `30_000` has always applied. Adopted
   `deadlineMs: 30_000` explicitly. **CONFIRMED**.
2. **Forbidden-key check kept in-callback** — the canonical wrapper's
   `forbiddenBodyKeys` option appends `(<key>)` to the message, which would
   change the historical response. To preserve byte-identity, the check is done
   in the callback via `pcbSyncForbiddenAuthorityRefusal` (same `jsonError`
   bytes). **CONFIRMED**.
3. **No `exposeAbortSignal`** — the routes never consumed `request.signal`;
   pre-abort protection comes from the bounded reader refusing before the
   callback. Adopting the signal would add unused capability. **INFERRED →
   CONFIRMED** by the pre-aborted pin.
4. **Route-boundary suite uses spied durable/expensive seams** — the full
   expensive success path (live FreeRouting, real digests, real persistence) is
   NOT re-run here; it stays covered by the unchanged real qualification + MFG01
   suites (§D/§E/§J directive). **CONFIRMED**.

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN** — identity/membership via
  injection seams only; no live services contacted. **UNKNOWN**.
- **Remaining migration: 77 raw methods** (baseline 80) — spice family, chat,
  replacement-authority, calculation/schematic-compiler/full-flow and other
  families, plus the 3 factory routes. This stage completes the PCB family; the
  broader migration is **not** complete. **CONFIRMED**.

## Scope adherence

Work confined to `sirkit-edit`; protected original untouched; no provider
credits; no live routing process; no live DB writes; no network; no
prompt/provider/tool-exposure changes; manufacturing release remains
internal-only. B16.0.16 / B16.1 / MCP / multi-agent / provider expansion NOT
started.
