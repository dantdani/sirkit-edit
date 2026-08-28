# B16.0.22 §A — pre-edit observed realities (reproduced BEFORE any edit)

All were observed by running the §A suite against the RAW handlers first
(first run: 56/59; the three failures below were EXPECTATION errors on my
side, corrected to the observed reality — no production behavior was touched
to make a pin pass).

## 1. assignment-queue GET with unknown `itemId` → 200 `{ item: null }`, not 404 — RECORDED

`assignmentService.get` returns `null` for an unknown item and the route
serializes it (`{ ok:true, state, item:null, boardChanged:false }`). My
expected 404 was wrong; the pin now records the real contract. **CONFIRMED**
(pre = post).

## 2. DB-less environment: assignment-queue GET terminals were 422 `AQ_INTERNAL_ERROR` — ENVIRONMENT, NOT CONTRACT

`getDurableWorkflowRepository()` returns a Postgres-backed repository even in
tests; without a database the raw list/get paths failed fast into the
`AQ_INTERNAL_ERROR` → 422 fallback. That is an environment artifact, not the
route contract, so the §A pins intercept `DurableAssignmentQueueRepository`
prototype methods and pin the REAL envelopes (list page 200, item-null 200).
**CONFIRMED**.

## 3. physical-bindings GET as viewer (real repo, no DB) → 422 — ENVIRONMENT, NOT CONTRACT

Same class as #2 (`PostgresPhysicalBindingRepository.load` fails fast). The
shared GET pin asserts only "past authorization" (never 401/403); the
contract pins use prototype spies. **CONFIRMED**.

## 4. `content-length` IS settable on undici `Request` — the declared-length branch IS testable

Verified `new Request(..., { headers: { "content-length": "2000000" } })`
keeps the header. The historical assignment-queue declared-length shortcut
(413 `AQ_API_PAYLOAD_TOO_LARGE`, zero pulls) was reproduced verbatim
pre-migration, then superseded by the canonical reader's identical-status
shared envelope ([query-projection-deltas.md](query-projection-deltas.md)).
**CONFIRMED**.

## 5. pcb-sync duplicated `boardId` query key → 422 `PS_API_UNKNOWN_FIELD` — reproduced verbatim pre-migration

Superseded by deterministic first-value-wins
([query-projection-deltas.md](query-projection-deltas.md)). **CONFIRMED**.

## No fail-open found

No latent fail-open was found in this tranche's eight methods: every
authorization, role, scope, ceiling, and validation gate behaved fail-closed
as documented. The two supersessions above are envelope/dispatch
normalizations, not fail-opens. **CONFIRMED**.
