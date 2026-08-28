# B16.0.22 §G — replacement-authority (highest risk), item by item

The route is READ/PROVE ONLY (derives fresh server-owned authority + published
pin facts; executes no command, writes nothing). All pins pre = post.

| §G requirement | verdict | evidence |
|---|---|---|
| authorization completes BEFORE the body is consumed and BEFORE any authority source resolution | **MET** | 401/403 pins with `loadRunComponentAuthority` pass-through spy uncalled + cross-origin zero-pull pin |
| exact 16,384-byte ceiling / 10 s read deadline | **MET** | wire-byte 413 pin at 16,385; standing b14-3 deadline suite green through the wrapper |
| EXACT historical refusal envelopes (plain `{ok:false,error}`; aborted → 408) | **MET** | byte-exact `toEqual` pins for over-limit/aborted/UTF-8/JSON/array — via the `replacement-authority-v1` legacy contract |
| strict 4-key body allowlist; browser authority/asset identities refused | **MET** | `unexpected request key "targetAtomicPartRevisionId" — browser-supplied authority and asset identities are refused` pinned byte-exact |
| nonce REQUIRED, `^[A-Za-z0-9]{16,128}$`, echoed EXACTLY | **MET** | four malformed-nonce pins + happy-path `binding.nonce === NONCE` |
| scope is optional CROSS-CHECK only; smuggled scope → 403; never selects data | **MET** | scope-key/mismatch/omitted pins; loader receives TRUSTED scope (spy args) |
| target identity derived SERVER-SIDE from the durable record | **MET** | unchanged callback logic (`exactAuthority.atomicPartRevisionId`); body cannot name targets (allowlist) |
| no forging: response binding echoes nonce + component + TRUSTED scope | **MET** | happy-path `toEqual({ nonce, componentInstanceId, scope: trustedScope })` |
| no leaks: allowlisted bounded result only; 503 fail-closed without a source | **MET** | 503 "no durable authority source is configured" pin with loader uncalled |
| replay/one-shot semantics unchanged | **MET** | the nonce is correlation/replay defence for the exchange (never server authentication — B14.2 §C); the endpoint holds no nonce state, and the standing B14.2 suite (`b14-route-replacement`, 8/8) passes unchanged |
| abort signal only via declared input | **MET** | `exposeAbortSignal: true`; code-scan gate: no `request.signal` |

## Deltas (documented, none behavioral at the wire for real callers)

1. The non-authenticated-kind guard historically returned **401** ("an
   authenticated project member is required"); the wrapper returns **403
   AUTH_UNSUPPORTED_PRINCIPAL**. The branch is UNREACHABLE on this policy row
   — see [unreachable-branch-notes.md](unreachable-branch-notes.md).
2. A LYING oversize `Content-Length` on a small body is now refused 413
   (declared-length precheck in the shared reader) instead of being read and
   validated; strictly fail-closed hardening, and the envelope is the exact
   historical 413 text via the legacy contract. **RECORDED**.
