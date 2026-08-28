# B16.0.8 — Pre-edit route contracts (pinned before migration)

Every tranche-1 method's observable contract was pinned in
[`app/api/__tests__/b16-0-8-tranche-parity.test.ts`](../../app/api/__tests__/b16-0-8-tranche-parity.test.ts)
and run GREEN against the PRE-migration handlers (24 pins, first run), then kept
green after migration. DB/catalog seams are mocked identically in both runs; no
live database is contacted.

| Method | Pre-edit contract highlights (all pinned) |
|---|---|
| GET /api/requirements/capabilities | 200; one embedded profile; `Cache-Control: public, max-age=300`; handler ignored the Request entirely |
| GET /api/parts/categories | 200 `{ok,categories}` + `public, max-age=3600` on success; db failure → 500 `{ok:false,error}` (pinned via mocked db seam) |
| GET /api/kicad/v1 (+categories.json, parts/[id]) | historical TOKEN boundary: unconfigured → 503 `{error}`; missing/wrong `Token` → 401 `Unauthorized`; discovery body `{categories:"categories.json",parts:"parts"}`; categories `[{id:"published",…}]`; parts/[id] strips a `.json` suffix and 404s `{error:"Part not found"}` on unknown ids; **tolerates trailing-slash URLs** (Stage 5 KiCad tests); never resolved the policy adapter at runtime |
| POST /api/constraints/explain | 2 MB/15 s bounded; `{}` → 400 "program and targetId are required"; text/plain → 415; oversize → 413; bad JSON → 400 AUTH_INVALID_JSON |
| POST /api/constraints/preview | same bounds; `{}` → 400 "board, projectId, and documents are required" |
| POST /api/parts/search | 200 KB/10 s; query>500 chars → 400 exact message; db failure → 500 `{ok:false}`; 413/415; `?includeGenerics=true` read from the URL |
| POST /api/assignment-queue/materialize | worker secret (Bearer, SIRKIT_WORKFLOW_WORKER_SECRET) FIRST: missing → 401 `AQ_SOURCE_WORKER_UNAUTHORIZED` with **no Cache-Control header** and **0 body pulls**; then 8 MB/30 s bounded JSON (415/400 reader codes); refresh errors → 422 `AQ_*` |
| POST /api/assignment-queue/revalidate | worker secret; 401 `AQ_REVALIDATION_WORKER_UNAUTHORIZED` **with no-store**; NO body read at all; dispatch bound to request signal |
| POST /api/engineering-effects | worker secret; 401 `DW_WORKER_UNAUTHORIZED` with no-store; NO body read; dispatch with signal; failure → 500 `DW_WORKER_FAILED` no-store |
| GET /api/footprint-resolution | session auth (authorizeRequest): anonymous → 401 AUTH_UNAUTHENTICATED; editor → 200 static capability JSON, no-store |
| GET /api/mapping-verification | same auth; 200 + `X-Sirkit-Mapping-Stage4` header + capabilities/versions |
| POST /api/requirements/compile | auth JSON 2 MB: anonymous 401; missing input → 400 "input is required"; scope mismatch → 403 "requirements compile scope mismatch"; 415/400 reader codes; success/422 by compiler (family suite) |
| POST /api/requirements/sources | auth JSON 1.6 MB (REVIEW_EDITORS): scope mismatch → 403 "requirements source scope mismatch"; 201 created (family suite) |

Unreachable branches noted: the `kind !== "authenticated"` 401 in the old
compile/sources handlers and the `API_UNAUTHENTICATED` branch in the `_scope`
GET helpers cannot be triggered for session-policy rows (authorizeRequest
returns authenticated or refuses); their replacement by the wrapper's
(equally unreachable) 403 branch is not an observable change.
