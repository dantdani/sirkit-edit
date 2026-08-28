# B11.6 — pre-edit counterexamples (R1–R5)

All five reproductions were run against **production code, before any B11.6
edit**, through a transient probe
(`app/lib/agent/__tests__/_tmp-b116-repro.test.ts`, deleted after capture).

---

## R1 — a top-level hostile board is returned as the projection

```json
{
  "threw": null,
  "projectBoardForReplay(proxy) === proxy": true,
  "caller-owned hostile object returned unchanged": true
}
```

`projectBoardForReplay(revokedProxy)` did not throw — B11.4's outer
`try/catch` caught the walker's throw — but the catch clause **returned the
raw input**: the caller-owned revoked proxy came back as the "projection".

## R2 — a nested hostile object survives projection

`board.outline.origin.x = hostileProxy` (a `get`-trap proxy), where the
descriptor expects a primitive:

```json
{
  "validateBoardShape reports x must be finite": ["board.outline.origin.x: must be a finite number"],
  "projectBoardForReplay returned a projected board (not the input)": true,
  "projected.outline.origin.x === hostileProxy": true,
  "reading the projected value executed the caller's get trap": true,
  "read threw through the proxy": "hostile get executed through the projection"
}
```

The walker carried the wrong-typed value **verbatim** for diagnostics — which
for an object value means carrying the caller's proxy. Reading the "projected"
value executed the caller's trap. A projection may preserve an invalid
primitive for diagnostic comparison; it must never preserve caller-owned
object identity or executable behaviour.

## R3 — the exported context projector throws

```
projectReplayContext(revoked)  →  TypeError: Cannot perform 'IsArray' on a proxy that has been revoked
```

## R4 — the exported captured-context validator throws

```
validateCapturedReplayContext(revoked)  →  TypeError: Cannot perform 'IsArray' on a proxy that has been revoked
```

Both entered through the unguarded `isRec` (`Array.isArray` throws on a
revoked proxy). `validateCapturedReplayContext` is exported, accepts
`unknown`, and documented an "independent assertion when called directly" — a
misleading public contract for a function that threw on its first line.

## R5 — the retained depth contract is ignored

```json
{
  "findNonPlainJsonPath({}, \"$\", 33)": null,
  "findNonPlainJsonPath({}, \"$\", 0)": null
}
```

The pre-B11.5 contract reported `exceeds maximum nesting depth` for
`depth > 32` at entry. B11.5's delegation to `scanPlainJson` silently
discarded the parameter — a retained, silently ignored **security-bound**
parameter.

---

## Root causes

| # | Root cause |
| --- | --- |
| R1 | B11.4's totality fix was an outer `try/catch` whose catch returned `raw` — exactly the "wrap the walker and return raw input" shape this stage forbids |
| R2 | the walker's diagnostic-carry (`{ value, issues }` with `value` = input) is correct for primitives but carries **identity** for objects; nothing captured before projecting |
| R3/R4 | `replay-context.ts` had its own unguarded `isRec`; the exported captured-only validator had no runtime enforcement and no total entry |
| R5 | the `depth` parameter was kept for signature compatibility but never threaded into the shared walk |

## Closures

| # | Closure |
| --- | --- |
| R1/R2 | §A capture-and-project: the public projector captures first and projects the **owned snapshot**; failure is an explicit `{ ok: false, issues }` — never the raw input; every value in every result is an owned frozen copy |
| R3 | §B `projectReplayContext` is capture-first and total, with the same discriminated result |
| R4 | §B `validateCapturedReplayContext` is runtime-enforced by the capture **ownership registry** (an unforgeable, trap-free `WeakSet` membership check): owned snapshots take the zero-copy fast path, everything else routes through capture-first |
| R5 | §C the depth parameter is threaded into the shared walk as its starting depth, counting against the same bound |
