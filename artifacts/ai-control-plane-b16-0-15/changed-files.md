# B16.0.15 — Changed files

## Migrated routes (boundary prologue → canonical wrapper; business logic byte-preserved)

- `app/api/pcb/qualify/route.ts` — `scopedPcbSyncJson(request)` prologue →
  `authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ context, body }) => …)`;
  in-callback forbidden-key check + `pcbSyncScopeFromContext(context)`; the
  entire qualification/persistence body (from `stage3Repository.getBoard` on)
  unchanged. `maxDuration = 300` unchanged.
- `app/api/pcb/release/route.ts` — same prologue swap; the durable authority
  load, locator pinning, release-gate call, manifest/ZIP responses, headers,
  and error mapping all unchanged. `maxDuration = 300` unchanged.

## Shared helper (extended, NOT weakened)

- `app/api/pcb-sync/_scope.ts` — ADDED `PCB_SYNC_API_DEADLINE_MS = 30_000`
  (the discovered reader default), `PCB_SYNC_FORBIDDEN_BODY_KEYS`,
  `pcbSyncScopeFromContext(context)`, and `pcbSyncForbiddenAuthorityRefusal(body)`
  (Request-free; exact `jsonError` bytes). `scopedPcbSyncJson` and `pcbSyncScope`
  are UNCHANGED — `/api/pcb-sync` still uses them.

## Tests

- `app/api/__tests__/b16-0-15-tranche-parity.test.ts` — NEW; 23 behavioral pins
  (pre = post), all durable/expensive seams spied.
- `app/lib/auth/__tests__/b16-0-15-manufacturing-boundary-gate.test.ts` — NEW;
  10 structural + internal-only + negative-tripwire gates.
- `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` — `TRANCHE_8`
  pins; `BASELINE_MAX` 82→80; `MIGRATED_FLOOR` 71→73.

## Regenerated through sanctioned generators only

- `_raw-route-baseline.json` — 82→80 (2 removed, 0 added).
- wrapper + b16-0-4 matrices ×2, byte-stable; tranche manifest extracted here.

## Explicitly NOT changed (§H no-rewrite)

autonomous capability profile, placement algorithms, FreeRouting integration,
board-digest logic, RC01/RC02/RC03 definitions, release-gate validation,
manufacturing rule profiles, native Gerber/Excellon compiler, archive
construction/readback, durable workflow schemas, provider config, prompts, tool
registry exposure, PCB proposal/apply flows, database migrations, authoritative
hashes, replay pins. `C:\Users\robsa\sirkit` untouched.
