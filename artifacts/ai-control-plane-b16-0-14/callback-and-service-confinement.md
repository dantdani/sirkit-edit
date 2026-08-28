# B16.0.14 §C/§J — Callback & service type confinement

## Callback inputs

| Route | Callback receives | Never receives |
|---|---|---|
| apply-authorization | `{ context, body, bytes, meta }` (uses `context` only) | Request, Headers, cookies, Authorization, raw body/stream, raw URL/origin, identity provider, membership repo, any request-like escape |
| assign/suggest | `{ body }` | same |

The selector-envelope callback keys are asserted EXACTLY
(`["body","bytes","context","meta"]`) and the serialized input is checked to
contain no `headers`/`cookies`/`url`/`signal`.

## Service confinement

`searchFootprints(input: FootprintSearchInput)` accepts only
`{ q, limit, padCount, smd }`. A structural gate proves the service source
declares no `: Request` / `: URL` / `: Headers` parameter, and constructs no
`URLSearchParams` / `new URL(` / `.origin` / `fetch(`.

## Structural tripwires (§J) — all green

| Tripwire | Gate |
|---|---|
| assign/suggest reintroduces `fetch` | route source has no `fetch(` |
| assign/suggest reads `request.url` / origin / host | route source has no `new URL(`/`req.url`/`.origin`/`x-forwarded-host`/`"host"` |
| shared service accepts Request/URL/Headers | service source has no such annotations/constructs |
| apply-authorization reverts to a raw handler | no `export async function POST`; ratchet TRANCHE_7 revert fails CI |
| selector-envelope callback receives Request | callback key-set asserted `{body,bytes,context,meta}` |
| membership lookup before a structurally-valid selector | malformed selector → `scope-malformed` WITHOUT invoking identity (no 401) |
| selector body role/actor becomes authoritative | resolved role = server-derived `pcb_editor`, not body `admin` |
| either route bypasses the canonical wrapper | both classify `canonical-wrapper` by exact provenance; fake/alias/barrel fail the classifier |
