# B16.0.5 — Pre-edit counterexamples (recorded, current tree)

Every counterexample independently reported was reproduced against the
CURRENT analyzer/routes BEFORE any B16.0.5 edit. Verbatim outputs below.
Reproduction harnesses: `scripts/_b16-0-5-repro.ts` (analyzer) and
`app/api/__tests__/_b16-0-5-pre.test.ts` (real-route media type) — both
disposable, deleted after recording; the permanent regressions live in the
B16.0.5 gate/behavioral suites.

## A — Authorization analysis (`analyzeMethodBoundary`)

| ID | Counterexample | Required | PRE-EDIT actual |
|---|---|---|---|
| C1 | `const a = await authorizeRequest(req); if (a.ok) return ok; <durable work>` (WRONG polarity — unauthorized falls through) | REJECT | **`ok:true` via guard-first ("authorizeRequest → authorized.ok refused")** — ACCEPTED (defect) |
| C1b | `if (!other.ok && authorized) return 400; <durable work>` (refuses an UNRELATED binding) | REJECT | **`ok:true`** — ACCEPTED (defect) |
| C1c | authorization only inside `if (header === null) { … }`, then unguarded `getDb().select()` | REJECT | `ok:false` — "a durable/provider call (getDb.select) precedes the authorization boundary" (already closed, recorded for completeness) |
| C2 | `import { authenticatedJsonRoute } from "./evil"` | REJECT | **`ok:true` via wrapper** — ACCEPTED (defect: wrapper recognized by local name only, module never resolved) |
| C2b | `import { evil as authenticatedJsonRoute } from "@/app/lib/auth/route-handlers"` (re-export/alias laundering) | REJECT | **`ok:true` via wrapper** — ACCEPTED (defect: original export name never checked) |

## B — Body-consumption analysis (`directBodyReads`)

Each MUST be detected; PRE-EDIT the analyzer found what is shown.

| ID | Bypass form | PRE-EDIT `directBodyReads` |
|---|---|---|
| C3a | Request forwarded to a local helper `parse(request)` that calls `r.json()` | **`[]` — MISSED** |
| C3b | Destructured method `const { json } = request; json.call(request)` | **`[]` — MISSED** |
| C3c | Property extraction `const j = request.json; j.call(request)` | **`[]` — MISSED** |
| C3d | Nested alias `const wrap = { r: request }; wrap.r.json()` | **`[]` — MISSED** |
| C3e | `request.json.call(request)` | **`[]` — MISSED** |
| C3f | Element access `request["json"]()` | **`[]` — MISSED** |
| C3g | Clone laundering `request.clone().json()` | **`[]` — MISSED** |
| C3h | Closure capture over a non-conventional param `incoming.text()` | `["incoming.text"]` — detected (direct member call) |

## C — Media-type enforcement (real routes)

Driven against the real exported handlers (no provider credit, no live DB):

| Route | Input | PRE-EDIT actual | Required |
|---|---|---|---|
| `POST /api/parts/search` (public) | `text/plain` + invalid JSON | `400 AUTH_INVALID_JSON` | `415 AUTH_MEDIA_TYPE_UNSUPPORTED` before the first body pull |
| `POST /api/bom` (public) | `text/plain` + **valid** JSON | **`200`, body pulled 1×** (accepted past the reader) | `415` before any body pull |
| `POST /api/bom` (public) | **missing** Content-Type + valid JSON | **`200`** | `415` before any body pull |
| `POST /api/architecture/candidates` (auth) | `text/plain` + garbage | `400 AUTH_INVALID_JSON` | `415` after auth, before any body pull |

## Conclusion

The B16.0.4 security verdict was **not** sound: wrong-polarity and
unrelated-binding guards were accepted, wrapper recognition was name-only
(`./evil` and aliased-symbol laundering both passed), taint-blind body
detection missed 7 of 8 bypass forms, and no JSON route enforced 415. B16.0.5
closes each item; post-edit results are recorded in
[post-edit-results.md](post-edit-results.md).
