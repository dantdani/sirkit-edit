# B16.0.6 §C — Canonical reader identity by provenance, never by name

## The defect (R3/R4)

B16.0.5 trusted a body sink by NAME:

```
/^readBounded/           → readBoundedEvil() qualified (R3)
/^scoped[A-Za-z0-9]*Json$/
a bare identifier matching a known reader name → a LOCAL readBoundedJsonObject qualified (R4)
```

So a forged prefix or a local function with the exact canonical name bypassed
the body gate entirely.

## The fix — an exact provenance allowlist

Those three name rules are **deleted**. A sink is canonical ONLY when it resolves
to an exact module + exported symbol
([`CANONICAL_REQUEST_SINKS`](../../app/lib/auth/__tests__/_boundary-analysis.ts)):

| Module | Symbols |
|---|---|
| `app/lib/http/bounded-json.ts` | `readBoundedJsonBody`, `readBoundedJsonObject`, `isJsonContentType` |
| `app/lib/http/bounded-stream.ts` | `readBoundedStream` |
| `app/lib/auth/authorize.ts` | `authorizeRequest`, `scopedTrustedJson` |
| `app/lib/auth/request-security.ts` | `requireSameOrigin`, `requireJsonContentType` |
| `app/lib/auth/trusted-request-context.ts` | `resolveTrustedRequestContext` |
| `app/lib/auth/route-handlers.ts` | `authenticatedJsonRoute`, `authenticatedRoute`, `workerJsonRoute`, `publicJsonRoute` |

`resolvesToCanonicalSink(callee)` requires: the callee is IMPORTED (a local /
undeclared name never qualifies — closes R4), its **original** exported name
(the `propertyName` of an aliased import — closes alias laundering) is in the
module's symbol list, AND `resolveLocalModule` resolves the specifier to the
exact canonical path (closes `./evil` and R3's non-canonical module). Node
builtins (e.g. `node:crypto`) match by specifier.

## Family (scoped) helpers are canonical BY COMPOSITION, not by name

The scoped families (`scopedPcbSyncJson`, `bomScope`, `spiceRunScope`, …) are not
in the allowlist. They qualify only because `safeRequestConsumer` proves — by
following their resolved definition — that their request parameter flows solely
into a canonical sink (they call `scopedTrustedJson`/`authorizeRequest`). This is
provenance + composition, never a name pattern. A forged `scopedEvilJson` that
read the body directly would fail this check.

## Proof

- R3 (`readBoundedEvil`) and R4 (local `readBoundedJsonObject`) → violations.
- The REAL `readBoundedJsonObject` imported from `bounded-json.ts` → 0 violations.
- On-disk fixture: importing `readBoundedJsonObject` from a NON-canonical module
  path → violation (provenance, not name).

See [request-and-stream-flow-enforcement.md](request-and-stream-flow-enforcement.md)
for how the request is prevented from reaching a non-canonical sink at all.
