# B16.0.2 — pre-edit counterexamples (R1–R8)

Recorded BEFORE any production edit, from ONE disposable vitest probe
(`app/lib/auth/__tests__/_b16-0-2-probe.test.ts`, deleted after this record)
that imported the REAL route handlers / helpers and drove them with injected
identities (`app/lib/auth/test-support.ts`). No live database, provider, or
Supabase session was used; where a handler reached the durable repository the
probe records the repository-entry error (`DATABASE_URL is not set`) as the
evidence that the handler reached data access without the missing control.

Every defect below is converted into permanent regression coverage by the
B16.0.2 suites (see `test-and-validation-report.md`).

## R1 — protected SPICE child resources are public

```
R1 policy rows: bundle=public events=public waveforms=public
R1 GET bundle (no auth, missing id): status=404 body={"ok":false,"error":"Run not found"}
R1 GET waveforms (no auth, existing run): status=200 body={"ok":true,"signals":[]}
R1 GET bundle (no auth, existing run): status=409 body={"ok":false,"error":"Run has no reproducibility artifacts"}
R1 GET events (no auth, existing run): status=200 content-type=text/event-stream
R1 events first SSE frame: event: run\ndata: {"id":"run_2188e6a4-…","projectId":"simproj_40162b2f-…
```

An anonymous caller reaches resource lookup (404 / 409 / 200 — never 401) and
receives the run's event stream and waveform index. The three routes did not
call `authorizeRequest` at all; their policy rows were `public`.

## R2 — authenticated SPICE operations are not project-scoped

```
R2 run projectId in store = simproj_40162b2f-… (client-asserted SimulationProject.id; no tenant/branch)
R2 GET /api/spice/runs?ids=<runA> as project-B member: status=200 body={"ok":true,"runs":[{"id":"run_2188e6a4-…
R2 GET /api/spice/runs/<runA> as project-B member: status=200 body={"ok":true,"run":{"id":"run_2188e6a4-…
R2 subscribeRun with NO scope check: listener invoked=1
R2 DELETE /api/spice/runs/<runA> as project-B member: status=200 body={"ok":true,"run":{…"status":"cancelled"…
R2 run status after foreign cancel = cancelled
```

A member of `project-B` (selector headers for project-B, membership only in
project-B) listed, inspected, subscribed to, and CANCELLED a run started for a
different project. The job store carried only the client-asserted
`SimulationProject.id` and no trusted `{tenantId, projectId, branchId}`.

## R3 — BOM ownership is caller-controlled

```
R3 policy /api/bom/diff GET = {"path":"/api/bom/diff","method":"GET","authClass":"public","identitySource":"none","requiresAuth":false,…}
R3 GET /api/bom/diff?from=<rawid>&to=<rawid> (no auth): status=500 body={"ok":false,"error":"DATABASE_URL is not set. …"}
R3 GET /api/bom/snapshot?projectKey=project-A as project-B member: status=500 body={"ok":false,"error":"DATABASE_URL is not set. …"}
R3 PATCH /api/bom/notifications {id:raw} as project-B member: status=500 body={"ok":false,"error":"DATABASE_URL is not set. …"}
static: app/components/bom/BomView.tsx:397  const projectKey = props.projectKey ?? hashedKey;
static: app/page.tsx renders <BomView … /> with NO projectKey prop (0 occurrences) → the hash fallback is the production path
```

`/api/bom/diff` was public and loaded snapshots by raw id with no identity
at all (it reached the repository without authentication). An authenticated
project-B member's caller-supplied `projectKey=project-A` and raw notification
`id` both reached the repository predicate unchanged — no trusted
tenant/project/branch ownership appears in any BOM predicate, and the
production client derived `projectKey` from a schematic-content hash.

## R4 — CSRF "same origin" is not exact

```
R4a https URL + http Origin same host: ACCEPTED
R4b Host=sirkit.example Origin=https://evil.example X-Forwarded-Host=evil.example: ACCEPTED
```

Both independently reported bypasses reproduce: scheme downgrade on the same
host is accepted, and a caller-controlled `X-Forwarded-Host` redefines the
allowed origin.

## R5 — authenticated JSON body limits are not load-bearing

```
R5a scopedTrustedJson maxBytes=10 with never-settling body: STILL PENDING after 1500ms
R5b scopedTrustedJson maxBytes=10 with 2MB body: status=413, wire bytes pulled before refusal=2031616
R5c signin MAX 16000 with 2MB body: status=413, wire bytes pulled before refusal=2031616
R5d apply-authorization MAX 64000 with 2MB body (no content-length): status=413, wire bytes pulled before refusal=2031616
```

A never-settling body hangs the authenticated JSON helper indefinitely
(`request.text()` is awaited before `maxBytes` is consulted); an oversized
body is fully buffered (≈2 MB pulled from the wire for a 10-byte ceiling)
before the 413. Sign-in and apply-authorization share the post-buffer check.

## R6 — interactive tier-1 production identity is not integrated

```
static: primeSessionIdentity production callers: (none)   [grep over app/** excluding tests + the module itself]
static: app/page.tsx:4973  authorization: sessionAuthorizationBinding(sealScope),   [synchronous]
R6 sessionAuthorizationBinding() with no primed evidence -> principalId=local-dev-principal membershipRevision=mbr1-09e15d764f638451
R6 apply-time reauthorization of that binding against a live production editor -> {"code":"principal-changed",…}
```

With zero priming, the page seals under `local-dev-principal`; a production
session's apply-time reauthorization then refuses `principal-changed` — the
visible user can create a proposal they can never apply.

## R7 — requiredApplyRole is not enforced

```
R7 binding.requiredApplyRole=project_admin, live role=pcb_editor -> denial=null (null = AUTHORIZED)
```

A sealed binding demanding `project_admin` authorized a live `pcb_editor`.

## R8 — legacy engineering exports can misattribute humans/projects

```
R8 policy /api/pcb/export/gerbers POST = {…"authClass":"public","identitySource":"none","requiresAuth":false,…"evidence":"stateless export (label-only identity)"}
R8 POST gerbers (NO auth) preflight engineering with body.actor -> status=200 waivers[0].actor="mallory@evil.example"
R8 authorizeRequest(anonymous POST gerbers) -> ok=true kind=public
```

An anonymous caller minted human attribution (`waivers[0].actor`) and a
project label from the request body on a process-spawning export route.
