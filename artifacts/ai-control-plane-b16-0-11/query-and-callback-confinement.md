# B16.0.11 §C/§E — Query & callback confinement

## Callback inputs (all 12 methods)

| Method group | Callback receives | Never receives |
|---|---|---|
| public ×6 | `{ body, bytes, meta }` | Request, Headers, cookies, Authorization, raw URL, streams, identity |
| diff / snapshot POST / notifications PATCH+DELETE | `{ context, body, bytes, meta }` | same |
| notifications GET | `{ context, meta }` with `meta.query` — the wrapper's **bounded, frozen** projection (`unreadOnly` read as `meta.query?.unreadOnly === "true"`) | raw URL objects (`new URL(req.url)` is gone) |
| snapshot GET | `{ context, meta }` | same |

## §E — the bomScope bypass path is gone

`bomScope(request)` held raw-Request + boundary-call capability outside the
canonical wrappers. It is REMOVED. [`_scope.ts`](../../app/api/bom/_scope.ts)
now exports only:

- `bomOwnershipScope(context)` — a pure, Request-free projection;
- `BOM_FORBIDDEN_BODY_KEYS` (preserved);
- `bomNotFound` (preserved).

Repository-wide search confirmed no remaining consumer of the old helper (the
only textual mentions left are boundary-analyzer test fixtures that synthesize
sources by name, which never resolve to this module).

## The permanent gate

[`b16-0-11-bom-confinement-gate.test.ts`](../../app/lib/auth/__tests__/b16-0-11-bom-confinement-gate.test.ts)
pins forever:

1. all 12 BOM methods classify `canonical-wrapper` by exact provenance;
2. no BOM route file contains `bomScope` (import or call);
3. `_scope.ts` is Request-free — no boundary import, no `(request: Request)`
   parameter, no exported `bomScope`, and the three preserved exports present;
4. no BOM route constructs `new URL(req.url)` — query data flows only through
   `meta.query`;
5. re-introduction of the old helper name fails the gate.

Combined with the ratchet's TRANCHE_4 pins (a revert to a raw handler fails CI)
and the standing fake-wrapper/alias/shadowing tripwires, ordinary BOM routes
can no longer express handwritten authorization or raw Request handling.
