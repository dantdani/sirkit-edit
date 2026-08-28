# B16.0.13 — Changed files

## Migrated routes (boundary prologue → canonical wrapper; business logic byte-preserved)

1. `app/api/pcb/ai-rules/from-brief/route.ts` — `authenticatedJsonRoute` 16 MB/45 s
2. `app/api/pcb/edit/assist/route.ts` — `authenticatedJsonRoute` 16 MB/45 s
3. `app/api/pcb/repair/agent/route.ts` — `authenticatedJsonRoute` 16 MB/45 s
4. `app/api/pcb/autoroute/route.ts` — `authenticatedJsonRoute` 16 MB/60 s +
   `exposeAbortSignal: true`; both `request.signal` uses → the projected
   `signal` (the ONLY non-prologue lines touched)
5. `app/api/pcb/export/gerbers/route.ts` — `authenticatedJsonRoute` 16 MB/60 s;
   the in-route kind-guard branch removed (wrapper-enforced);
   `engineeringExportAttribution(authorized.context)` →
   `engineeringExportAttribution(context)`

No limit changed — autoroute and gerbers were already 16 MB/60 s; the advisory
routes keep 16 MB/45 s.

## Tests

- `app/api/__tests__/b16-0-13-tranche-parity.test.ts` — NEW; the 36-pin §A
  suite (five work fakes; run green pre-migration, kept green post; one guessed
  autoroute error string corrected against the recorded pre-edit output).
- `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` — `TRANCHE_6`
  pins; `BASELINE_MAX` 89→84; `MIGRATED_FLOOR` 64→69.

## Regenerated through sanctioned generators only

- `_raw-route-baseline.json` — 89→84 (5 removed, 0 added).
- wrapper + b16-0-4 matrices ×2, byte-stable; tranche manifest extracted here.

## Explicitly NOT changed

`app/lib/llm/*`, `app/lib/prompts.ts`, PCB tool schemas,
`app/lib/pcb/autoroute/*` (runner/runtime/DSN/SES),
`app/lib/pcb/fab/*` (bundle/native/presets/readiness), the repair tool
service, `/api/pcb/apply-authorization`, `/api/pcb/assign/suggest`,
`/api/pcb/qualify`, `/api/pcb/release` (excluded routes untouched), provider
config, tool exposure, replay pins, hashes. `C:\Users\robsa\sirkit` untouched.
