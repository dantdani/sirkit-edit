# B16.0.5 §A — Corrected method-scoped authorization proof

The B16.0.4 analyzer proved *presence and ordering* of a boundary but not its
*polarity* or the *identity* of the wrapper module. B16.0.5 closes both, in
[`app/lib/auth/__tests__/_boundary-analysis.ts`](../../app/lib/auth/__tests__/_boundary-analysis.ts).

## 1. The refusal must be POLARITY-CORRECT and load-bearing

`bindingIsRefused` and `inlineBoundaryGuard` no longer accept "an `if` that
references the binding and terminates". They require the condition to be a
canonical NEGATION of the authorization token, so the terminating branch fires
exactly when authorization did NOT succeed:

- `!<binding>.ok`, `<binding>.ok === false`, `<binding>.ok !== true`
- `!<binding>` / `<binding> === false` (boolean bindings and inline boundary calls)

A compound (`&&`/`||`) or a wrong-polarity test (`<binding>.ok`,
`<binding>.ok === true`) is **rejected** (fail closed). This is what defeats:

- **C1** `if (authorized.ok) return ok; <work>` — the unauthorized path fell
  through; now REJECT (the boundary result is "IGNORED").
- **C1b** `if (!other.ok && authorized) return 400` — refuses an unrelated
  binding via a compound; now REJECT.

The canonical `if (!authorized.ok) return authorized.response` and the worker
`if (!authorizedSecret(req)) return …` still PASS.

## 2. Dominance over ALL body/durable/provider/process/mutation work

Unchanged in intent, strengthened in reach: the guard-first walk rejects any
forbidden call sequenced before the boundary, and the body-read check is now the
taint engine (§B), so a body read forwarded through a helper before the boundary
is caught too. **C1c** (guard only inside a conditional branch, then an
unguarded `getDb().select()`) is rejected.

## 3. Wrappers and factories resolve to the EXACT canonical module + symbol

`isCanonicalWrapper` accepts `export const POST = authenticatedJsonRoute(…)`
only when:

1. the local callee is imported under its **original** exported name (the
   `propertyName` of `import { orig as local }` — an aliased `evil as
   authenticatedJsonRoute` fails here), AND
2. that original name is in `APPROVED_ROUTE_WRAPPERS`, AND
3. the import specifier resolves to the **exact** canonical path
   `app/lib/auth/route-handlers.ts` (a `./evil` module fails here), AND
4. the canonical module actually **declares** an exported function of that name
   (a re-export barrel fails here).

Anything else falls through to FACTORY analysis using the **original** imported
name, so a laundered import resolves the real symbol (`evil`) — which does not
exist in the canonical module — and REJECTS. This defeats:

- **C2** `authenticatedJsonRoute` from `./evil` → REJECT (module not canonical);
- **C2b** `import { evil as authenticatedJsonRoute }` → REJECT (`evil` not found);
- a same-named local wrapper → REJECT (not imported);
- a non-canonical re-export barrel → REJECT (fixture-proven).

## Soundness posture

Every change is a TIGHTENING — it can only turn a former PASS into a REJECT,
never the reverse. Confirmed empirically: all **121** protected methods still
pass (the §A gate loop over the real tree is green), and the negative tripwires
in [`b16-0-5-analyzer-hardening.test.ts`](../../app/lib/auth/__tests__/b16-0-5-analyzer-hardening.test.ts)
fail closed. The audited wrapper remains the strongest option because it makes
polarity, dominance, AND raw-request isolation true by construction (§D).
