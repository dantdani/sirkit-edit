# B16.0.5 — Post-edit results (all counterexamples fail closed)

Same harnesses as [pre-edit-counterexamples.md](pre-edit-counterexamples.md),
re-run against the CORRECTED analyzer/routes. Every reported bypass now fails
closed; the permanent regressions live in
[`app/lib/auth/__tests__/b16-0-5-analyzer-hardening.test.ts`](../../app/lib/auth/__tests__/b16-0-5-analyzer-hardening.test.ts)
and [`app/api/__tests__/b16-0-5-media-type-and-wrapper.test.ts`](../../app/api/__tests__/b16-0-5-media-type-and-wrapper.test.ts).

## A — Authorization analysis

| ID | Counterexample | PRE-EDIT | POST-EDIT |
|---|---|---|---|
| C1 | wrong polarity `if (a.ok) return ok` | ✅ accepted (defect) | **❌ REJECT** — "authorization result of authorizeRequest is IGNORED (no reachable `if (!authorized.ok) return`)" |
| C1b | unrelated binding `if (!other.ok && a)` | ✅ accepted | **❌ REJECT** — same (the compound/wrong-token test is not a refusal) |
| C1c | partial-branch guard + unguarded durable read | ❌ reject | ❌ REJECT (unchanged) |
| C2 | `authenticatedJsonRoute` from `./evil` | ✅ accepted | **❌ REJECT** — "factory authenticatedJsonRoute module not resolvable" |
| C2b | `import { evil as authenticatedJsonRoute }` from canonical | ✅ accepted | **❌ REJECT** — "factory evil not found in app/lib/auth/route-handlers.ts" |
| — | canonical `if (!a.ok) return a.response` | (n/a) | ✅ PASS (real routes unaffected — all 121 protected methods still pass) |

## B — Body-consumption analysis (`directBodyReads`)

| ID | Bypass | PRE-EDIT | POST-EDIT |
|---|---|---|---|
| C3a | helper forwarding `parse(request)` | `[]` MISSED | **detected** `request.json` |
| C3b | destructured method `const {json}=request` | `[]` MISSED | **detected** |
| C3c | property extraction `const j=request.json` | `[]` MISSED | **detected** |
| C3d | nested alias `{ r: request }` | `[]` MISSED | **detected** |
| C3e | `request.json.call(request)` | `[]` MISSED | **detected** |
| C3f | element access `request["json"]()` | `[]` MISSED | **detected** |
| C3g | clone `request.clone().json()` | `[]` MISSED | **detected** |
| C3h | direct member `incoming.text()` | detected | detected |
| — | `request.body!.getReader()` | detected | detected |
| — | canonical `readBoundedJsonObject(request, …)` | not flagged | not flagged (sanctioned sink) |

## C — Media-type enforcement (real routes)

| Route | Input | PRE-EDIT | POST-EDIT |
|---|---|---|---|
| `POST /api/parts/search` | text/plain + invalid JSON | 400 AUTH_INVALID_JSON | **415 AUTH_MEDIA_TYPE_UNSUPPORTED** |
| `POST /api/bom` | text/plain + valid JSON | **200, 1 body pull** | **415, 0 body pulls** |
| `POST /api/bom` | missing Content-Type | **200** | **415** |
| `POST /api/architecture/candidates` | text/plain | 400 | **415** (after auth, before body pull) |

The permanent §C suite additionally proves, for every family
(architecture, interfaces, power, schematic, pcb-ai, spice-ai, spice-compile,
requirements, bom, public-misc, chat, replacement-authority, worker):
text/plain → 415 no-store with **0** counted body pulls; missing Content-Type
→ 415 with 0 pulls; `application/json; charset=utf-8` accepted past the media
gate.

## D — Wrapper integrity

The `authenticatedJsonRoute` callback now receives exactly
`{ context, body, bytes, meta }` — asserted in the §D test — with **no**
`request`, `headers`, `cookie`, or `authorization`, and `meta` limited to the
non-secret `{ method, pathname }`.

## Analyzer soundness preserved

The corrections are strictly TIGHTENING (more rejections), never loosening: all
**121** protected methods still prove a load-bearing boundary (the canonical
`if (!a.ok) return` and the factory/worker forms are unchanged), and the §C
body gate still reports **0** offenders across production routes.
