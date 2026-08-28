# B16.0.24.1 — pre-edit counterexamples (the three verified defects)

## 1. Unbounded raw-file buffering (simulate)

`app/api/simulate/route.ts` line 281 (pre-edit):

```ts
rawText = (await readFile(rawPath, "utf8")).slice(0, MAX_RAW_BYTES);
```

Counterexample: a raw artifact of N bytes (N ≫ 20 MB, e.g. a pathological
ngspice run streaming gigabytes into `result.raw` within the 10 s window)
caused `readFile` to allocate and decode ALL N bytes before the slice — a
memory allocation proportional to attacker-influenceable output, inside the
request path. Worse, the silent `.slice` TRUNCATED oversized output and then
PARSED the partial text, so a truncated artifact could yield a
plausible-looking (wrong) result instead of a refusal. **CONFIRMED defect;
corrected in §1.**

## 2. Full-environment exposure (sign-out)

`route-handlers.ts` (pre-edit): `if (opts.exposeEnvironment)
extra.environment = opts.environment ?? process.env;`

Counterexample: ANY unrelated server secret (AWS keys, DB URLs, sentinel
values) was enumerable by the public sign-out callback — one accidental
`JSON.stringify(env)` in a future diagnostic away from a leak. The callback
genuinely needs three values (mode, Supabase URL, key). **CONFIRMED defect
(over-privilege, no observed leak); corrected in §2.**

## 3. Unproven Supabase success branches

No test mocked `@supabase/ssr` or `next/headers`; every tested auth path
returned BEFORE the SSR client. The sign-in-success, sign-out-success,
callback-exchange, cookie-write, and uniform-401 behaviors were design claims
labeled CONFIRMED/INFERRED without executable evidence. **CONFIRMED coverage
gap; closed in §3 with fake clients (22-test suite, green first run).**
