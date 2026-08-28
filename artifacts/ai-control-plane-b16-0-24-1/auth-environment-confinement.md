# B16.0.24.1 §2 — auth environment confinement (least privilege)

`exposeEnvironment` (full `process.env` pass-through) is REMOVED from the
wrapper module; its replacement is `exposeAuthRuntime` →
`projectAuthRuntime(environment)` in `app/lib/auth/mode.ts`.

- **Exactly three fields**: `{ mode, supabaseUrl, supabaseKey }` — the
  resolved auth mode, the Supabase URL, the selected publishable/anonymous
  key. Pinned: `Object.keys(projection)` is exactly those three. **CONFIRMED**.
- **Frozen; copied values only**: `Object.freeze` on an object of trimmed
  string COPIES — no reference to the source environment survives; a later
  mutation of the source cannot reach the projection (pinned), and the
  projection never mutates the source (before/after snapshot pinned).
  **CONFIRMED**.
- **No enumerable access to the original environment**: the callback input is
  the projection object itself; `route-handlers.ts` contains no
  `extra.environment = … process.env` pass-through (gate: the literal
  `exposeEnvironment` no longer appears anywhere in the module or route; the
  sign-out route's comment-stripped source contains no `process.env`).
  **CONFIRMED**.
- **Exact historical key selection preserved**: `PUBLISHABLE ?? ANON` (an
  explicitly-empty publishable key does NOT fall through to the anon key),
  then falsy→null normalization — pinned for all four combinations, so the
  503-unconfigured behavior is byte-identical to B16.0.24. **CONFIRMED**.
- **Sentinel-secret test**: with `SIRKIT_SENTINEL_DO_NOT_LEAK` (and an
  AWS-style key in the unit test) stubbed into the environment, the sentinel
  reaches NEITHER the projection, NOR any sign-out response body (local_dev
  200, production-unconfigured 503, cross-origin 403), NOR any
  console.error/log/warn call. **CONFIRMED**.
- **Deterministic test injection preserved** without a raw Next handler
  argument: the projection is built at REQUEST time from
  `opts.environment ?? process.env`, so `vi.stubEnv` injects declaratively
  (the migrated `b16-0-2-mode-diagnostics` suite passes unchanged).
  **CONFIRMED**.
- **Sole adopter**: sign-out is the only `exposeAuthRuntime` declarer; the
  b16-0-24 confinement gate now pins the option and the absence of the old
  pass-through. **CONFIRMED**.
