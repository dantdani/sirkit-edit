# B16.0.24 §J — the exact factory allowlist

Exactly THREE approved DI-factory method/route pairs remain non-canonical.
Pinned in `b16-0-8-migration-ratchet.test.ts` as `APPROVED_FACTORIES`; the
frozen `_raw-route-baseline.json` is EXACTLY these three rows and nothing else.

| method | route | factory |
|---|---|---|
| POST | /api/mapping-verification | `createMappingPostHandler` |
| POST | /api/passive-policy | `createPassivePolicyPostHandler` (its GET is already canonical `authenticatedRoute`) |
| POST | /api/pcb-sync | `createPcbSyncPostHandler` (its GET is already canonical `authenticatedRoute`) |

These are legitimate dependency-injection composition roots
(`export const POST = createX(service, ...)`); the mandate directs NOT to force
them into wrappers. New ratchet assertions (all green):

- `inv.rawHandlers === []` — EXACTLY zero raw handlers.
- `inv.factories === APPROVED_FACTORIES` — the factory set equals exactly these
  three; a NEW factory fails CI.
- baseline is EXACTLY these three rows (`length === 3`).
- `inv.legacy.length === 3` and `inv.wrappers.length >= 150`.

**CONFIRMED.**
