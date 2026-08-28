# B16.0.8 §B — Safe metadata & header policy

## What a callback can ever see

| Channel | Content | Bound |
|---|---|---|
| `meta.method` / `meta.pathname` | request method + URL pathname | always present; no query/host secrets |
| `meta.query` (opt-in `query: true`) | frozen `Record<string,string>` | ≤64 keys; ≤2048 chars per value; first value wins (no arrays); absent without the flag |
| `meta.headers` (opt-in `safeHeaders`) | frozen record of EXACTLY the allowlisted names | ≤2048 chars per value; undeclared headers structurally absent |
| `params` (opt-in `routeParams`) | frozen record of the DECLARED dynamic params | ≤512 chars; missing/invalid → 400 before the callback |
| `signal` (opt-in `exposeAbortSignal`) | the request `AbortSignal` | exposes no headers/body/identity — cancellation only |

## What can never be allowlisted

`validateSafeHeaderAllowlist` THROWS at wrapper construction (not at request
time) for: `cookie`, `set-cookie`, `authorization`, `proxy-authorization`,
`x-sirkit-worker-secret`, and any header name matching
`/secret|token|cookie|auth|credential|session|password|key/i`. A route author
cannot even express a wrapper that would leak a credential header.

## Structural unavailability (proven)

[`b16-0-8-wrapper-capabilities.test.ts`](../../app/lib/auth/__tests__/b16-0-8-wrapper-capabilities.test.ts)
proves: secret-name allowlists throw; an allowlisted non-secret header is
projected while undeclared headers (and `cookie`) are absent from the frozen
projection; callback input key-sets contain no `request`/`headers` object;
the worker principal can never be a human actor; query and params records are
frozen and bounded; `signal` appears only when declared.
