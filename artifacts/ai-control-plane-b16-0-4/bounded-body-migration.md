# B16.0.4 §B — Universal bounded request-body migration

## Goal

Eliminate **every** direct, unbounded request-body read
(`request.json()`, `.text()`, `.arrayBuffer()`, `.blob()`, `.formData()`,
`request.body.getReader()`) from all production `app/api/**/route.ts` handlers.
An unbounded read lets a never-settling or oversized body hang or exhaust the
handler *before* any per-route limit applies.

## The one bounded reader

All reads now go through
[`app/lib/http/bounded-json.ts`](../../app/lib/http/bounded-json.ts)
(over the proven `bounded-stream.ts`), which enforces, on every call:

- a real **wire-byte ceiling** (`maxBytes`, counted as the stream is consumed;
  consumption stops at the first byte over — 413 `AUTH_PAYLOAD_TOO_LARGE`);
- a hard **total deadline** (`deadlineMs`; a never-settling / trickling body
  settles at the bound — 408 `AUTH_BODY_DEADLINE_EXCEEDED`);
- **abort propagation** (`request.signal`; a pre-aborted request performs no
  read — 400 `AUTH_BODY_ABORTED`);
- fatal UTF-8 decode (400 `AUTH_BODY_NOT_UTF8`), JSON parse only after the read
  settles (400 `AUTH_INVALID_JSON`), object requirement (400
  `AUTH_OBJECT_REQUIRED`);
- exactly-one terminal settlement (late resolution/rejection contained by the
  reader's latch — no unhandled rejection).

`readBoundedJsonObject` returns `{ ok, body, bytes }`; `boundedJsonRefusalResponse`
renders the refusal as `{ ok:false, code, error }` with the right status and
`Cache-Control: no-store`.

## Scope of the migration

**49 routes** across 9 families were migrated. Auth ordering was preserved
exactly — where a route authorized first, the bounded read still runs *after*
the boundary; no route added or removed a Content-Type/415 check; existing
byte ceilings were kept (never loosened). Two migration patterns:

- **Pattern J** — `try { x = await req.json() } catch { return <400> }` →
  `const read = await readBoundedJsonObject(req, {maxBytes, deadlineMs}); if
  (!read.ok) return boundedJsonRefusalResponse(read); const x = read.body as …`.
- **Pattern T** — `const raw = await req.text(); if (bytes > CEIL) return <413>;
  JSON.parse(raw)` → same bounded call, deleting the now-unused byte-check and
  any orphaned `MAX_BODY_BYTES` const (kept where still referenced, e.g. the two
  `requirements` routes pass their existing stricter ceiling into the reader).

## Per-family limits

| Family | maxBytes | deadlineMs | Rationale |
|---|---|---|---|
| architecture, interfaces, power | 8 MB | 30 s | full problem/candidate/proposal state |
| schematic | 16 MB | 45 s | full schematic + editor context |
| pcb-ai (`ai-rules/from-brief`, `assign/suggest`, `edit/assist`, `repair/agent`) | 16 MB | 45 s | board digests + item indexes |
| spice + requirements | 8 MB (spice) / 2 MB, 1.6 MB (requirements, pre-existing) | 30 s | netlists / requirements packages |
| bom | 8 MB | 30 s | schematic state + pricing choice |
| public-misc (search, constraints, exports, placement) | 200 KB search / 2 MB constraints / 8–16 MB exports | 10–45 s | search bodies are tiny; export bodies carry board state |
| worker (`assignment-queue/materialize`) | 8 MB | 30 s | source bundle; `timingSafeEqual` worker-secret guard preserved before the read |

## Execution

43 routes were migrated by a parallel per-family workflow; the final family
(spice + requirements, 6 routes) was migrated by hand after a transient
classifier interruption. Each family's existing behavioral suite was re-run
green; **no test status-code assertion was changed and no test was skipped or
deleted**. The migration is enforced going forward by the automatic body
gate — see [body-coverage-gate.md](body-coverage-gate.md).

## Verification

The generated [route-authorization-and-body-matrix.md](route-authorization-and-body-matrix.md)
shows **0** direct unbounded body reads remaining across all `app/api`
handlers.
