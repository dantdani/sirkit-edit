# B16.0.13 §C — Callback & signal confinement

## Callback inputs

| Route | Callback receives | Never receives |
|---|---|---|
| from-brief, edit/assist, repair/agent | `{ body }` (context unused by these prompt-based advisory routes) | Request, Headers, cookies, Authorization, raw URL/origin, streams, caller-supplied membership |
| autoroute | `{ body, signal }` — `signal` is the WRAPPER-projected AbortSignal (`exposeAbortSignal: true`); an AbortSignal exposes no headers/body/identity | same |
| export/gerbers | `{ context, body }` — attribution derived ONLY from `engineeringExportAttribution(context)` | same |

## Signal replacement (autoroute)

Both historical uses of `request.signal` were replaced by the projection:

- the mid-pass pre-abort check (`if (signal!.aborted) return { …cancelled }`);
- the `runFreerouting({ …, signal: signal! })` process-cancellation handoff.

The projected signal IS the request's lifecycle signal handed over by the
wrapper, so cancellation semantics (abort during routing reaches
`runFreerouting`, cancellation settles once, late completion contained) are
byte-identical — proven by the standing autoroute suite's abort tests plus the
new pre-aborted pin (reader refuses `AUTH_BODY_ABORTED` with ZERO
runtime/runner calls, so a pre-aborted request can never spawn a process).

## Structural gates

- All 5 methods classify `canonical-wrapper` by exact provenance
  ([pcb-route-migration-manifest.csv](pcb-route-migration-manifest.csv));
  ratchet TRANCHE_6 pins make any revert fail CI.
- No helper was introduced to smuggle Request: the migrated files' only removed
  lines are the boundary prologue; `grep` confirms no remaining
  `request.`/`req.` use beyond the wrapper exports, and the §C flow gate over
  the whole tree stays green.
