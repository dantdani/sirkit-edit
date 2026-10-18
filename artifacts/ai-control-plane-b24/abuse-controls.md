# B24-A3 - Abuse controls

Labels: **CONFIRMED** (executed here and measured, or read at the cited file:line), **INFERRED** (code reading, nothing executed),
**PROPOSED** (designed, not exercised), **RECORDED** (written down from a document without a claim of our own), **UNKNOWN**,
**BLOCKED-LIVE-QUALIFICATION** (needs a live resource the owner has not supplied; never faked, never claimed).

Base: `b3b6b05` on `chapter/b24-production-qualification` (B24-A1 and B24-A2 committed). B24-A3 closes D24-8 (discovery D24-8 and its
2026-10-06 re-verification note; runbook B24-A `:1039` "rate limiting and abuse controls", global `:158`; OD-197), answers OD-174's
open question (discovery 9.6) and discovery section 8 item 8 (Q8). It is delivered in one workflow run in two halves for one commit by
the lead: part 1 (B24-A3a, the anonymous surface: deliverables 1-5, sections 0-14) and part 2 (B24-A3b, authenticated spend:
deliverables 6-7, sections 15-18). Every citation in the last section is resolved by its anchor; the line beside it is as of this
increment's working tree. The adversarial review of 2026-10-08 confirmed fourteen findings; section 21 lists each with the test that
reproduced it, the fix and the re-run, and the sections it changed carry dated `[B24-A3 review, 2026-10-08]` notes.

## 0. What B24-A3 is

- **What it is.** Per-process fixed windows on the four anonymous rows that spend or block - `POST /api/parts/search`,
  `GET /api/pcb/footprints/search`, `POST /api/pcb/placement/preview` and `POST /api/auth/signin` - enforced in `authorizeRequest`'s
  public branch (C1-C4); an embedding meter under a new `embedding` admission key that both public searches go through (C10-C16); a
  route-side work bound on the public placement preview, which closes B20's F1 as a work bound (C22-C27; [B24-A3 review, 2026-10-08]
  at most two candidate evaluations per request and at most 1.5 s measured on this host at the reviewed bounds, section 9); every
  window and the meter on a clock the fixture runtime does not freeze (C56); the two searches' policy rows
  declaring provider credit, the three public rows classified `expensive`, and a census gate, `abuseLimitViolations`, that refuses a
  reviewed public model-egress path without an enforced limiter (C28-C33); one message on the sign-in page for a throttled sign-in
  (C34); and (part 2) a per-principal window on each of the 40 authenticated provider-credit or expensive rows, `/api/chat` included,
  with the gate at OD-197's full scope (C40-C46, C55). The reuse is B20's fixed-window limiter, unchanged (C7, C8), and B21's LLM
  admission machinery, extended append-only as B23-B2 extended it (C10).
- **What it is not.** No shared store (Redis, the database, a platform limiter): every window is per process (section 2), OD-197's
  alternative being to require sign-in, which A3 does not do. No route, tool, action record, UI control or dependency (OD-42); the
  census stays 168 / 165 / 3 / 0, the tool counts 47 / 36 / 9 / 27, the action records 107; `engine.ts`, `placementRunOptions`,
  `embeddings.ts` and the nine B11-scanned files are untouched; no real network, provider, database or deployment was used, and every [B24-closeout, 2026-10-10] superseded: B24-C1's record, artifacts/ai-control-plane-b24/observability-and-replay.md:338.
  live half is **BLOCKED-LIVE-QUALIFICATION** (section 14).
- **What the builder did not run.** No `next dev`, `next build`, `next start` or Playwright: both browser configs are the lead's runs
  (section 20).

## 1. The limits, and what each is keyed on

Public windows (`ABUSE_LIMITS`, C5; one constant each, C6). Each row's windows are taken per client first, then global (section 6).

| Row | Window | Requests | Per | Keys held | Keyed on |
|---|---|---|---|---|---|
| `POST /api/parts/search` | global | 300 | 60 s | 10,000 | one bucket per process shared by every caller: `["public", "parts-search", "global"]` |
| `POST /api/parts/search` | per client | 60 | 60 s | 10,000 | the trusted header's IP literal, `["public", "parts-search", ...]` with the part `ip-<literal>` (an IPv6 client by its /64, section 4), only when the header is configured |
| `GET /api/pcb/footprints/search` | global | 300 | 60 s | 10,000 | one bucket per process shared by every caller: `["public", "footprints-search", "global"]` |
| `GET /api/pcb/footprints/search` | per client | 60 | 60 s | 10,000 | the trusted header's IP literal, `["public", "footprints-search", ...]` with the part `ip-<literal>` (an IPv6 client by its /64, section 4), only when the header is configured |
| `POST /api/pcb/placement/preview` | global | 10 | 60 s | 10,000 | one bucket per process shared by every caller: `["public", "placement-preview", "global"]` |
| `POST /api/pcb/placement/preview` | per client | 3 | 60 s | 10,000 | the trusted header's IP literal, `["public", "placement-preview", ...]` with the part `ip-<literal>` (an IPv6 client by its /64, section 4), only when the header is configured |
| `POST /api/auth/signin` | global | 30 | 60 s | 10,000 | one bucket per process shared by every caller: `["public", "signin", "global"]` |
| `POST /api/auth/signin` | per client | 10 | 60 s | 10,000 | the trusted header's IP literal, `["public", "signin", ...]` with the part `ip-<literal>` (an IPv6 client by its /64, section 4), only when the header is configured |

The embedding meter (`EMBEDDING_ADMISSION`, C10), shared by both public searches:

| Meter | Window | Breaker on failures | Breaker on a 429 | Breaker on no credits |
|---|---|---|---|---|
| `embedding:openai/model:text-embedding-3-small` | 240 a minute, process-wide | 3 consecutive failures: 60 s | a provider 429: 60 s | `insufficient_quota`: 1 h |

A refusal of a public window answers 429 `PUBLIC_RATE_LIMITED` with `Retry-After` in whole seconds in [1, 60] and
`Cache-Control: no-store`, before the media type and before any body byte is read (C2, C4; `b24-a3-abuse-limits` case 2). A refusal of
the meter makes no provider call: the parts search answers through its lexical fallback, the footprint search 429
`EMBEDDING_ADMISSION_PAUSED` with `Retry-After` (section 8). The meter's window (240) is below each search's window (300), so in one
minute the meter pauses free-text searches before the search window is reached; the window still counts every request, including an
exact `Lib:Name` footprint lookup, which embeds nothing (C20). **CONFIRMED** (`b24-a3-abuse-limits` 1-8, `b24-a3-embedding-admission`
1-7). The per-principal windows of part 2 are in section 15.

## 2. Every limit is per process

Every window on this page and the meter live in the memory of one server process, like B20's MCP limits and B21's LLM admission (C7,
C10): each limit is per process, so N instances allow N times as much, and a restart forgets every window. A shared store is OD-197's
alternative and is not built. **CONFIRMED** by reading (C5, C7, C40); how many instances a deployment runs is UNKNOWN (OD-190).

**The clock** ([B24-A3 review, 2026-10-08] `regressions-1`). Every window and the embedding meter read `unfrozenNowMs` (C56), the
real wall clock: `Date.now()` in a deployment and in a test (a test's faked `Date` included), and the original `Date.now()` while the
fixture runtime's frozen clock is installed. The browser jobs run `next dev` under the fixture runtime, whose instrumentation installs
that frozen clock (C57): `Date.now()` answers one fixed instant for the whole run. A window keyed on it never rolls over (the limiter
opens a new window only when the clock has moved a full window, C8), so `e2e/agent-execution.spec.ts` - 82 chat runs ([B24-B2, 2026-10-08] 85 since B24-B2's order case) from one
principal in one project over its serial run - would have met 429 `PRINCIPAL_RATE_LIMITED` from its 61st run to its end, and every
other window would have been one budget for the whole run. The windows and the meter mint no identity, so the real clock costs the
fixture runtime no determinism. **CONFIRMED** (`b24-a3-abuse-limits` 9, `b24-a3-principal-limits` 9, `b24-a3-embedding-admission` 9:
with the frozen clock installed each window refuses past its limit and admits again once the real clock has moved 61 s); the browser
jobs themselves are the lead's runs (section 20), **PROPOSED** until then.

## 3. Where each limit is enforced

- **The public windows:** `authorizeRequest`'s public branch (C1), after the same-origin CSRF check and before the branch answers public
  (C2), so before every wrapper's media-type check and body read (`publicRoute` and `publicJsonRoute` call `authorizeRequest` first;
  every row in `ABUSE_LIMITS` adopts one of them, `b24-a3-credit-census` case 5). The configured header's value is read there and
  handed on bounded (C3); `abuse-limits.ts` takes no request object, reads no header and imports no address module (C5, C9).
- **The embedding meter:** `admittedEmbedQuery` (C14) around `embedQuery`, called by the parts search (C17) and passed by the public
  footprint route into the shared service (C19, C21).
- **The preview's work bound:** in the preview route only (C22-C25), never in the engine or `placementRunOptions`.
- **The per-principal windows (part 2):** `authorizeRequest`'s authenticated branch after membership and role (C42, C43), and
  `agentStreamRoute` after its role check (C44); section 15.
- **The census:** `abuseLimitViolations` (C30), `reviewedMeteredPublicCredit` (C31) and `publicHasCreditOrWrite` narrowed in place
  (C32).

## 4. The trusted client header

- **The rule.** `SIRKIT_TRUSTED_CLIENT_IP_HEADER` may name one of a closed list - `x-real-ip`, `cf-connecting-ip`, `true-client-ip`,
  `fly-client-ip` (C9); `x-forwarded-for` and every other name key nothing. The header must carry exactly one IPv4 or IPv6 literal of
  at most 45 characters, checked by a bounded pattern (C11); the key part is `ip-` and the literal lower-cased, which keeps every form,
  `::1` included, inside `ID_PATTERN` (a bare `::1` would fail it, and the limiter would refuse it `key_invalid`). A list, a port,
  brackets or a zone keys nothing. An absent or malformed value is never trusted and never an error: the global window alone applies.
  The value keys a window only - it is never identity and never an origin (`expected-origin.ts`, `trusted-request-context.ts` and
  `request-security.ts` do not read it). **CONFIRMED** (`b24-a3-abuse-limits` 4, 8).
- **The key part, by network** ([B24-A3 review, 2026-10-08] `security-2`; `clientWindowKeyPart`, C58). An IPv4 address keys as
  itself (`ip-203.0.113.7`); an IPv4-mapped IPv6 address (`::ffff:203.0.113.7`, or `::ffff:cb00:7107`) as its IPv4 address, the same
  client; any other IPv6 address by its /64 prefix (`ip-2001:db8:0:1::`), the unit one host or one subscriber is given - keyed per
  full address, one IPv6 host could rotate through its /64 and meet a fresh per-client window on every request. **CONFIRMED**
  (`b24-a3-abuse-limits` 10).
- **Why the header is unset by default.** OD-190 names no hosting platform, so no proxy is known to overwrite such a header; trusting
  one that a client can set would let any client mint a fresh per-client window per request. The variable is declared in
  `.env.example` with no value (configuration class, B24-A2's census) and inventoried by B24-A1 (kind configuration, its state only).
  Setting it is the owner's, behind a real proxy (LB-13).

## 5. The lockout trade-off

With the header unset, each window is one bucket shared by every caller. Any client can exhaust it: sign-in at 30/60 s locks every user out of sign-in for up to 60 s, and each search at 300/60 s refuses every user. This is the owner's trade-off against OD-197's alternative (require sign-in) and against configuring a trusted proxy header (LB-13).

Any client can do it because the sign-in CSRF check compares an `Origin` header that a non-browser client sets freely (C35), and the
footprint search is a GET with no CSRF at all. The preview at 10/60 s is the same: one client can refuse every user the preview for a
minute. Pinned: `b24-a3-abuse-limits` case 5 exhausts the sign-in window from one source and is then refused for a request carrying a
different `x-real-ip`. **CONFIRMED**.

Setting the header does not remove the lockout ([B24-A3 review, 2026-10-08] `security-2`; the text above, and OD-197's as handed to
the lead, read as if it did). The global window is the process-wide cap on spend and stays one bucket for every caller, keyed or not:
a few keyed clients at their per-client limit exhaust it - 3 for sign-in (3 x 10 = 30), 4 for the preview (4 x 3 >= 10), 5 for each
search (5 x 60 = 300) - and every other client is then refused until the window ends. One IPv6 host is one client (its /64, section
4). The limiter can only take (C7), so a new client's per-client key is inserted before the global window is asked, even when the
global window then refuses: a caller with 10,000 distinct IPv4 addresses or IPv6 /64 prefixes in one minute fills the per-client key
map, after which a new client's per-client window answers `full` and the global window alone applies (section 6). What the header
buys is fairness below the cap - no single keyed client takes more than its per-client share - not freedom from the lockout.
**CONFIRMED** for the lockout with the header set (`b24-a3-abuse-limits` 10: three keyed clients refuse a fourth sign-in);
**INFERRED** for the map fill (the limiter's code, C7, C8; not executed).

## 6. The window order

The per-client window first, then the global window (C12, C13). The limiter has only a consuming `take()` - no peek and no refund
(C7, C8) - so a per-client refusal consumes nothing in the global window, and
a global refusal has already used that client's own per-client slot.
On the per-client window only reason `limited` refuses; a per-client `full`, `key_invalid`, `clock_invalid` or `misconfigured` falls
back to the global window alone and never answers 429 by itself; the global window refuses on any reason (fail closed).
**CONFIRMED** (`b24-a3-abuse-limits` 6, 7). [B24-A3 review, 2026-10-08] `tests-02`, `tests-03`: cases 6 and 7 drove the decision
function, never the enforcement site with a refusal other than `limited`; case 11 now drives every public row through its real
wrapper on an invalid clock (`clock_invalid`) and each answers 429 `PUBLIC_RATE_LIMITED`, and case 6 pins `Retry-After` as what is
left of the refusing window (59 one second after it opened), never a constant. **CONFIRMED**, and each proved sensitive by a
deliberate breakage of the source, restored by sha256 (section 21).

## 7. What a person sees on a 429

- **The Build Library's parts search** (C36): a 429 body has `ok: false`, so the panel shows its existing error state, "Could not load
  parts" with Retry (`BuildLibraryPanel.tsx`); no UI change there. **INFERRED** from the panel's code; no browser run here.
- **Sign-in** (C34): at `b3b6b05` a 429 showed "Sign-in failed. Check your email and password." - only `AUTH_SIGNIN_UNAVAILABLE` had its
  own message. A3 adds one in-place branch for code `PUBLIC_RATE_LIMITED`: "Too many sign-in attempts; try again in a minute." Message
  text only, no new control: `app/signin` is outside B17-A's control roots (C37), so `generate-b17-control-inventory` runs with no diff.
  **CONFIRMED** (`b24-a3-signin-message` 1, 2, jsdom).
- **The footprint search and the preview** have no UI caller: the editor resolves footprints through `resolve` and `[id]`, and places
  in its own worker (the action registry's `placement.preview-api` record: "no UI control calls this route").
- **An authenticated row (part 2)** answers 429 `PRINCIPAL_RATE_LIMITED` with `Retry-After`; each panel shows its existing error state,
  and no UI was changed. **INFERRED**; no browser run here.

## 8. The embedding meter

- **Its key and limits.** `embedding:openai/model:<EMBEDDING_MODEL>`, appended to `AdmissionKey` as B23-B2 appended the manufacturing
  provider (C15, C16); 240 a minute process-wide; three consecutive failures open the breaker for 60 s, a provider 429 at once for 60 s,
  `insufficient_quota` at once for 1 h; after an opening one trial call goes. An outcome recorded while the breaker is open belongs to a
  call admitted before the opening and neither closes nor re-opens it. `resetAdmissionControl()` clears the meter, its open causes kept
  beside the shared state map included (C16). No runtime import was added to `admission-control.ts` (its runtime imports stay
  `["./source-registry"]`, `b21-e1-provider-policy` case 6); the caller names the model and the clock (`unfrozenNowMs`, section 2).
  [B24-A3 review, 2026-10-08] `tests-01`, `tests-03`: the late outcome is now pinned - two calls admitted together, the first's
  provider 429 opens the breaker, the second's later success leaves it open (`b24-a3-embedding-admission` 8) - and so is the
  `Retry-After` of the hour-long opening (3,539 s after 61 s, case 3). **CONFIRMED**, each proved sensitive by a deliberate breakage
  (section 21).
- **The outcome classes,** by the error's provider status and code, never its message text (C13): a provider 429 is `rate_limited`, a
  429 with code `insufficient_quota` is `insufficient_quota`, a 5xx, a 408 or an SDK error with no status (a timeout or a network
  failure: the request was attempted) is `failure`, another provider status is `neutral`, and an error carrying no status at all was
  thrown before any provider request - a missing `OPENAI_API_KEY` (C38) - and is `neutral`, which never opens the breaker; so the
  public footprint route keeps its 500 for a missing key, never a misleading 429 `EMBEDDING_ADMISSION_PAUSED`. **CONFIRMED**
  (`b24-a3-embedding-admission` 2-6).
- **What it counts.** The meter counts `embedQuery` calls, not provider HTTP requests: `embeddings.ts` builds its client with
  `new OpenAI({ apiKey })` and no `maxRetries` (C39, unchanged), and the SDK retries on its own below the meter, so one admission can be
  up to three provider requests. **INFERRED** from the SDK's default of 2 retries (read in the installed openai 6.48.0,
  `node_modules/openai/client.js:173`, not a repository file); no provider request was made here.
- **The lexical fallback.** A refusal in the parts search takes the route's existing exact-token fallback (C18), with no provider call
  and the response shape unchanged (`ok`, `results`, `pagination`); the footprint search's exact `Lib:Name` path answers without the
  meter (C20). **CONFIRMED** (`b24-a3-embedding-admission` 1).
- **What it does not meter.** The two authenticated embedding paths - `POST /api/pcb/assign/suggest`, which keeps the service's default
  `embedQuery`, and the build loop's `searchPartsForAI` - are not behind the `embedding` key; their routes' own windows bound them
  (section 17).

## 9. The placement preview's work bound

- **Option ceilings,** clamped and never refused (C23, C24): `timeoutMs` at most 5,000 (absent means 5,000); `candidateCount` at most 2
  (absent means 2); `maxIterations` at most 400; `localRefinementPasses` at most 0 (absent means 0); `gridNm` at least 100,000. A
  value inside its ceiling passes unchanged; an absent `maxIterations` or `gridNm` stays absent, the engine's own default already at
  its ceiling. [B24-A3 review, 2026-10-08] `security-1`: the task proposed 4 candidates and 1 refinement pass. One pass is up to 64
  more candidate evaluations (16 target components, 4 moves each) inside one candidate the budget cannot interrupt, so the reviewed
  ceilings leave at most two candidate evaluations per request, the engine's minimum of 2 candidates and no refinement
  (`b24-a3-placement-bound` 5).
- **Board bound** (C22, C25): a request above 1,000,000 bytes (the body's size, checked first, so the counting walks at most a
  megabyte), 30 footprints, 600 pads, 128 pads in one footprint, 2,400 polygon-pad vertices, 300 nets, 100 tracks and vias, 8 zones,
  512 zone vertices (outlines and fills) or 512 keepout vertices, or a board without a rect or roundrect outline (a polygon outline is
  refused: at most 0 polygon outline vertices), is refused with 413 `PLACEMENT_PREVIEW_TOO_LARGE`, naming the bound, before the
  revision hash and before `runPlacementCandidate`. The wrapper still reads up to 16 MB (B20's anchor, C29): a larger body is read and
  parsed, then refused. 30 footprints is the largest board any suite sends there (`objectives-transaction-api.test.ts`, 84 pads).
  [B24-A3 review, 2026-10-08] `security-1`, `security-3`: the task's five counted lists admitted up to a 200-footprint, 1,000-net
  board and missed the cost drivers the measurement below found; each bound above is one of them (`b24-a3-placement-bound` 3, 6).
- **Not a preemptive stop.** The engine checks its budget only between candidates (C26) and accepts a timeout up to 120 s (C27), so
  the clamps are a route-side work bound - fewer and cheaper candidates on a bounded board - not a preemptive stop: a running candidate
  still blocks the event loop until the next budget check. B20's stop-evidence anchors stand exactly once (the five forwarded keys, the
  16 MB / 45 s wrapper, the one engine call) and the preview's policy row is byte-identical (C29).
- **The measurement,** measured once on this host, never a wall-clock assertion in CI (D24-28): the route's POST handler called in
  process (Node v24.15.0, no network), the caller asking above every ceiling (`candidateCount` 8, `maxIterations` 2,000,
  `localRefinementPasses` 3, `gridNm` 10,000, `timeoutMs` 120,000), a 100 ms interval timer counting the event-loop turns the call
  allowed (none, in every run: the loop was blocked for the whole call).
  - *On the task's bounds* (2026-10-07, before the review): a 200-footprint board of 20-pad footprints (at the task's footprint, pad
    and net bounds; no copper, zones or keepouts) did not finish its first candidate in 900 s - a watchdog thread ended it at 900.0 s
    (`a3-measure-preview-200-capped.log`); 30 footprints of 20 pads took 10.8 s, 25 took 7.4 s, 50 took 42.1 s, and a 200-footprint board of
    2-pad footprints 303.2 s, one candidate each (`a3-measure-preview-30.log`, `-25`, `-50`, `-200x2`). B20's 50-footprint probe took 124.9 s
    with 3 passes and 40.9 s with 1. A refusal timing stated here before the review had no retained log and is withdrawn; the
    refusal timings below replace it.
  - *The cost drivers* (engine-level exploration, 2026-10-08, `a3fix-explore-*.log`): one refinement pass (above); a polygon outline
    (on 30 footprints of 20 pads a force candidate took 34.7 s with 64 vertices and 5.2 s with 16, and 4 vertices doubled the rect's
    time); overlapping copper (500 tracks on one spot: 5.0 s in the problem build, before the first candidate; 500 vias 9.8 s; 20,000
    tracks crashed the problem build with `RangeError: Invalid array length`); one footprint's pads (540 pads in one footprint: 2.1 s
    in the problem build, 23.6 s with 32-vertex polygon pads); and the footprint count (100 footprints: 14.4 s for one candidate).
  - *On the reviewed bounds* (2026-10-08), each answering 200 with 2 candidates: the crowded worst - 30 footprints of 20 pads stacked
    on one spot in a rect outline twice their courtyards' area, 300 nets, 50 tracks and 50 vias on top of one another, 8 zones of 32
    outline and 32 fill vertices, 8 keepouts of 64 vertices, 176,681 bytes - 1,118 ms (`a3fix-measure-worst.log`), with seeds 1, 2
    and 3 1,125, 1,100 and 1,157 ms (`a3fix-measure-worst-s1.log`, `a3fix-measure-worst-s2.log`, `a3fix-measure-worst-s3.log`), with
    a roundrect outline 1,168 ms (`a3fix-measure-worst-roundrect.log`); 30 footprints of 20 pads on a grid 983 ms
    (`a3fix-measure-grid-30x20.log`); four footprints of 128 four-vertex polygon pads and 26 of 2 (564 pads, 2,256 polygon-pad
    vertices) 1,451 ms (`a3fix-measure-big4x128-poly4.log`), 1,485 ms with the copper, zones and keepouts
    (`a3fix-measure-big4x128-combo.log`), 1,482 ms stacked (`a3fix-measure-big4x128-stacked.log`); 600 four-vertex polygon pads
    stacked with the copper 1,273 ms (`a3fix-measure-padpoly4-stacked-combo.log`); the suites' 30-footprint board 164 ms
    (`a3fix-measure-fixture30.log`). Refused: a 1,000,435-byte body in 22 ms (`a3fix-measure-refuse-bytes.log`), a 4-vertex polygon
    outline in 23 ms (`a3fix-measure-refuse-polygon.log`).
  - *So:* at the reviewed bounds one admitted request blocked the server for at most 1.5 s measured, and the preview's global window
    (10 a minute) bounds the block to about 15 s of every minute per process (a keyed client's 3 a minute, about 4.5 s). **CONFIRMED**
    (measured). That no board inside the bounds is slower than the shapes tried is **INFERRED** (section 19).
- **B20 F1** is closed as a work bound: the caller's `localRefinementPasses`, `gridNm`, `timeoutMs` and `candidateCount` no longer
  reach the engine unclamped (`b20-b4-stop-evidence` case 6, moved by review twice; `b24-a3-placement-bound` 1-6), and one admitted
  request blocks for at most 1.5 s measured, against B20's 124.9 s probe and the reviewed tree's more than 900 s. **CONFIRMED**
  (measured).

## 10. Test-first record, part 1 (red at `b3b6b05`)

The six part-1 suites were written first and run on `b3b6b05`'s sources with no production change, twice: on 2026-10-06 and again on
2026-10-07, the second time with every changed source restored to `b3b6b05` and back, each verified by sha256. Both runs: 6 files
failed, 32 cases failed and 2 passed (`b24-a3-signin-message` case 2 and `b24-a3-placement-bound` case 4 pin behaviour that already
held). The failures were assertions on today's tree, not only a missing module:

- `b24-a3-abuse-limits`: request 301 to the footprint search answered 200 (case 2); a keyed client's request 61 answered 200 (3, 4);
  sign-in request 31 answered 503, not 429 (5, 6); cases 1, 7 and 8 met the missing module.
- `b24-a3-embedding-admission`: the provider fake counted 241 calls for 241 requests (1); the call after three failures, a 429 or an
  `insufficient_quota` still reached it (2, 3, 5); cases 4, 6 and 7 met the missing module.
- `b24-a3-placement-bound`: the engine received `localRefinementPasses: 3`, `gridNm: 10_000` and `timeoutMs: 60_000` (1); no
  `timeoutMs` for an absent one (2); an oversized board reached the route's revision hash and threw (3).
- `b24-a3-credit-census`: `providerCredit` was false on both searches (1); `abuseLimitViolations` and `reviewedMeteredPublicCredit`
  did not exist (2-4); the public branch never took a window (5); 42 gated rows, not 43 (6); no dated notes (7).
- `b24-a3-signin-message`: a throttled sign-in showed "Sign-in failed. Check your email and password." (1).
- `b24-a3-abuse-controls-page`: the page did not exist (1-6).

## 11. The authenticated rows, unlimited after part 1

At the A3a tree these 40 authenticated rows are provider credit (33) or expensive (7) and had no window of their own (39 use `authenticatedJsonRoute`, `/api/chat` uses `agentStreamRoute`); part 2 gives each a per-principal window (section 15). [PR-L, 2026-10-17] 41 since runbook L.4: + `POST /api/generation-tasks` (provider credit, `authenticatedJsonRoute`), the durable generation task's start, which has its own per-principal window from the start (this paragraph is one line so that the page's line citations stand):

- `POST /api/architecture/alternatives`
- `POST /api/architecture/candidates`
- `POST /api/architecture/compare`
- `POST /api/architecture/propose`
- `POST /api/bom`
- `POST /api/calculation/propose`
- `POST /api/chat`
- `POST /api/circuit-knowledge/propose`
- `POST /api/circuit-verification/propose`
- `POST /api/component-selection/propose`
- `POST /api/generation-tasks`
- `POST /api/interfaces/alternatives`
- `POST /api/interfaces/candidates`
- `POST /api/interfaces/compare`
- `POST /api/interfaces/propose`
- `POST /api/parts/external-search`
- `POST /api/pcb/ai-rules/from-brief`
- `POST /api/pcb/assign/suggest`
- `POST /api/pcb/autoroute` (expensive)
- `POST /api/pcb/edit/assist`
- `POST /api/pcb/export/gerbers` (expensive)
- `POST /api/pcb/provider-exchange` (expensive)
- `POST /api/pcb/qualify` (expensive)
- `POST /api/pcb/release` (expensive)
- `POST /api/pcb/repair/agent`
- `POST /api/power/alternatives`
- `POST /api/power/candidates`
- `POST /api/power/compare`
- `POST /api/power/propose`
- `POST /api/schematic`
- `POST /api/schematic-compiler/propose`
- `POST /api/schematic/build`
- `POST /api/schematic/build-multi`
- `POST /api/schematic/cross-verify`
- `POST /api/schematic/edit`
- `POST /api/schematic/edit-build`
- `POST /api/schematic/layout-critic`
- `POST /api/schematic/review`
- `POST /api/simulate` (expensive)
- `POST /api/spice/ai`
- `POST /api/spice/models/smoke-test` (expensive)

## 12. Pins moved, and why

- `b16-0-1-ci-gates.test.ts` invariant 4 (`:148-151` "provider-credit routes are NEVER public", `:179-184` "public rows carry no
  credit, no authoritative write, no release"), narrowed in place by review: a public credit row is excused only as a reviewed, metered
  public model-egress row (`reviewedMeteredPublicCredit`), and the excused set is pinned to exactly the two searches; the header `:14-16`
  carries a dated note; the import stands in place of the blank `:27`. OD-197's "their policy rows declare provider credit" reverses
  B16.0.1's R8 closure for these two rows only; the owner's alternative is to require sign-in.
- The regenerated CSVs: `exact-route-authorization-policy.csv` (the two search rows) under `b16-0-1-ci-gates.test.ts:110`;
  `route-data-and-resource-classification.csv` (the two searches and the preview) under `b16-0-2-gates.test.ts:269` and
  `b23-a-route-vocabulary.test.ts:667`. The assertion lines are unchanged.
- `b20-b4-stop-evidence.test.ts` case 6 (F1 clamped) and a dated note on its header `:9`, "pin UNCHANGED base code".
- `b24-a1-flags` case 1 (the configuration list and 51 -> 52) and `b24-a2-env-names` (configuration 27 -> 28; case 10 [51, 5] ->
  [52, 5]), with dated notes on A1's page section 3 and A2's page section 5, in place.
- [B24-A3 review, 2026-10-08] `b20-b4-stop-evidence.test.ts` case 6 again, in place with a dated note: the engine now receives
  `localRefinementPasses: 0` for the caller's 3 (was 1; `candidateCount` 2 is inside the new ceiling and passes unchanged).
  `b24-a2-env-names` case 9 gains one check, on its last line: A2's page section 5 states its row total as the census's
  (`coverage-a2-page-stale-total`: the table summed to 81 under "80 rows."), and that line carries the dated note "80 -> 81".
  `app/lib/fixture-runtime/clock.ts` gains `unfrozenNowMs`, appended after its last line (A1's inventory cites its `:24`, unmoved).
- Not moved, as designed: `b16-0-2-gates.test.ts:263`, `b20-b2-mcp-route-policy.test.ts:105, :190`,
  `b20-b3-mcp-tools-call-reads.test.ts:365`, `b23-a-route-vocabulary.test.ts:679, :683, :713, :817-819` (the `PUBLIC_MODEL_EGRESS` keys
  and the two rows' `isPublic` / `outboundEgress` / `modelEgress` hold), `b16-0-24-tranche-parity.test.ts:140`,
  `b16-0-1-signin.test.ts:76`, the B16.0.4 and B16.0.7 matrices, the census and the tool counts. Part 2 moved no pin: `route-handlers.ts`
  keeps its 1,092 lines (each part-2 edit is in place on an existing line), its nine `retainedSignal(request)` sites, its one `deadlineMs`
  line in `publicJsonRoute` and no `x-sirkit-` text after `mcpBearerJsonRoute`.

## 13. Superseded statements, handed to B24-F

Each is left as written by A3 and handed to B24-F, which gathers every increment's list into one table for the closeout:

- B23 `tier3-vocabulary.md` `:177-178` (the two public searches send a model input "with `provider_credit` false"; the true rows are now
  35, not 33), `:238-241` ("recorded, not changed ... Both carry `provider_credit` false"), `:343-345` (the owner's question, "A2
  records it and changes no route"); `unknowns-and-owner-decisions.md` `:44` (OD-174 still "**open**"); `final-verdict.md` `:131-132`
  ("recorded in A2 (OD-174's open question), not changed").
- `admission-control.ts:19`'s key-kind enumeration (a source, a server, a tool, an LLM provider, a manufacturing provider): listed, not
  edited, since it carries the B21 and B23 closeout notes; the `embedding` kind is named on `:47` instead.
- B20 `final-verdict.md` `:67-68` and `mcp-server-proposals.md` `:258-264` (F1: the preview forwards the caller's options and blocks about
  two minutes per request, "queued as its own fix").
- B22 `discovery.md` `:360, :796` and `named-computations.md` `:161, :404` (F1 "stays open").

## 14. Live: BLOCKED-LIVE-QUALIFICATION

- **LB-13** (A1's row): a real edge or proxy that overwrites one of the four headers, per-client keying behind it, and several
  instances (each with its own windows) are **BLOCKED-LIVE-QUALIFICATION** until the owner names the platform (OD-190).
- **LB-1:** sign-in throttled against a live Supabase project (the Supabase project's own auth limits beside the app's window) is
  **BLOCKED-LIVE-QUALIFICATION** until an isolated project exists (OD-191).
- **LB-2:** OpenAI's own 429 and `insufficient_quota` under the meter, and how many HTTP requests one call becomes with the SDK's
  retries, are **BLOCKED-LIVE-QUALIFICATION** until the owner supplies credits with a cap (OD-216).

Nothing here is a live claim: every result on this page is offline, against fakes.

## 15. Part 2: the per-principal windows on authenticated spend

Part 2 (B24-A3b) gives every authenticated row that is provider credit or expensive - the 40 rows of section 11, `/api/chat` among
them - one fixed window per (method, path), keyed on the trusted context's `[tenantId, projectId, principalId]` only: never a header,
never a body field (`PRINCIPAL_ABUSE_LIMITS`, C40; one constant per kind, C41). Each is per process, like every window on this page.

- **Where.** In `authorizeRequest`'s authenticated branch, after membership and role (`authorizeContext`) and before it answers (C42,
  C43), so before every wrapper's media type and body read: a refused request pulls no body byte (`b24-a3-principal-limits` case 2).
  In `agentStreamRoute` after its role check (C44). Chat reads its body first by design - its step 3, the streaming bounded read
  (C45) - because its project selector is in the body; so a refused chat request has already been read (at most the route's
  `maxBytes`) and is refused after that, before any model call.
- **The refusal.** 429 `PRINCIPAL_RATE_LIMITED` with `Retry-After` in whole seconds in [1, 60] and `Cache-Control: no-store`. Any
  refusal of the limiter refuses - fail closed, as MCP's endpoint window does (C46): there is no global window to fall back to. A
  request refused by identity, membership or role (401, 403) consumes nothing (case 4). [B24-A3 review, 2026-10-08] `tests-02`,
  `tests-03`: case 6 drove the limiter, not the sites; case 10 now drives both sites with an invalid clock (`clock_invalid`) - a
  provider-credit row and the chat wrapper each answer 429 before their handlers and before any body byte - and refuses a principal id
  outside `ID_PATTERN` (`key_invalid`) through `principalRateLimitRefusal`; case 2 pins `Retry-After` as what is left of the window
  (30 at 30.5 s into it). **CONFIRMED**, each proved sensitive by a deliberate breakage (section 21).
- **Where they differ from part 1.** No trusted-header rule and no lockout trade-off: a principal exhausts only its own window in one
  project. A principal with several projects has a window in each, per process.
- **The values, and the counts they were checked against.** Before fixing them, every existing suite that reaches a gated row was run
  once with the windows switched off and each request counted (the largest number one fixed window would see, per suite file, row
  and key; 2026-10-07, 522 files, 1,113 takes; section 20): provider credit at most 18 (`b16-0-17-1-proposal-validation`, the schematic
  compiler), so 60 as proposed; expensive at most 43 - `b23-b-exchange-route` (the provider exchange) and `b22-d-adversarial`
  (simulate), and 11 to 35 in ten more files, twelve over the proposed 10 in all - so 50, not the proposed 10; `/api/chat` at most 37
  (`b21-e3-chat-resume`; `b21-e4-chat-first-turn` 24, `b21-f-evaluation` 21), and the browser job's `e2e/agent-execution.spec.ts`
  sends 82 chat runs from one principal in one project (29 `chat(...)` turns, 49 `board()` reads, 4 direct sends) over its 29 serial
  tests ([B24-B2, 2026-10-08] 85 runs since B24-B2's order case: 30 turns, 51 reads, 4 direct sends, 30 tests; ci-admission.md section 10), its first scenarios 17 in 39.6 s in B18-C's recorded run (`safe-mutation-tools.md:37`), about 20 in its first minute - so 60,
  not the proposed 20. [B24-A3 review, 2026-10-08] `regressions-1`: that premise holds only on a real clock. The browser job's server
  runs the fixture runtime's frozen clock, under which a window keyed on `Date.now()` never rolls over, so the spec's 82 runs ([B24-B2, 2026-10-08] 85) would
  have been one window and its 61st run refused for the rest of the run; every window now reads `unfrozenNowMs` (section 2), and
  whether a real minute of the spec stays under 60 is the lead's browser run (**PROPOSED**). Each is A3b's stated choice (OD-197); tightening expensive to 10 or chat to 20 needs those suites to reset their
  windows per case, the lead's or the owner's choice (section 19). The public windows met no suite's count: sign-in at most 8 of 30,
  the preview 5 of 10, each search 6 of 300. **CONFIRMED** (counted).

| Row | Kind | Requests | Per | Keys held | Keyed on |
|---|---|---|---|---|---|
| `POST /api/architecture/alternatives` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/architecture/candidates` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/architecture/compare` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/architecture/propose` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/bom` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/calculation/propose` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/chat` | chat | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/circuit-knowledge/propose` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/circuit-verification/propose` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/component-selection/propose` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/generation-tasks` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/interfaces/alternatives` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/interfaces/candidates` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/interfaces/compare` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/interfaces/propose` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/parts/external-search` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/pcb/ai-rules/from-brief` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/pcb/assign/suggest` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/pcb/autoroute` | expensive | 50 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/pcb/edit/assist` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/pcb/export/gerbers` | expensive | 50 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/pcb/provider-exchange` | expensive | 50 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/pcb/qualify` | expensive | 50 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/pcb/release` | expensive | 50 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/pcb/repair/agent` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/power/alternatives` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/power/candidates` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/power/compare` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/power/propose` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/schematic` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/schematic-compiler/propose` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/schematic/build` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/schematic/build-multi` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/schematic/cross-verify` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/schematic/edit` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/schematic/edit-build` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/schematic/layout-critic` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/schematic/review` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/simulate` | expensive | 50 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/spice/ai` | provider-credit | 60 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |
| `POST /api/spice/models/smoke-test` | expensive | 50 | 60 s | 10,000 | `[tenantId, projectId, principalId]` |

**CONFIRMED** (`b24-a3-principal-limits` 1-8).

## 16. Part 2: the meters beside the windows

The per-principal windows stand beside the meters that already bound these rows; none is replaced:

- **The distributor quotas** of `POST /api/bom` and `POST /api/parts/external-search`: every vendor request is admitted against the
  source registry's documented windows, with the agent's OD-40 share (`requestAdmission`, C47).
- **The ngspice cap** of the diagnostic runner: at most 4 processes at once and a queue of 64, one more refused
  `NGSPICE_DIAGNOSTIC_BUSY` (C48).
- **The provider exchange** (`POST /api/pcb/provider-exchange`, expensive): its stores' bounds refuse with 429 `PX_PLAN_LIMIT_REACHED`
  or `PX_KEY_LIMIT_REACHED` (C49), and its transfers go through the manufacturing-provider meter, agent share 0 (C50); no provider is
  admitted (B23).
- **The LLM-provider meter** (240 a minute, B21-E1) meters the orchestration's specialists and follow-up turn only (section 17).
- **The embedding meter** (part 1, section 8) meters the two public searches only; the two authenticated embedding paths are bounded by
  their routes' windows (section 17).

**CONFIRMED** by reading (C47-C50).

## 17. Part 2: the single-agent chat path (discovery section 8 item 8) and the authenticated embedding paths

- **Q8, answered.** A chat run with `SIRKIT_ORCHESTRATION_ENABLED` unset (C51) made 0 calls of `requestLlmProviderAdmission` over 60
  runs, each run one SDK call (`b24-a3-principal-limits` case 5). **CONFIRMED** - the discovery's INFERRED 0 holds: the flag-off path
  only reads the LLM-provider meters before its first turn (`pausedFirstTurn`, C52), and `admission-control.ts:339` ("the
  coordinator's own first turn is not metered") stays true (C53). The per-principal window, 60 runs a minute, is that path's control.
- **The two authenticated embedding paths** (task Lead note 2, item 4) are not behind the `embedding` key: `POST /api/pcb/assign/suggest`
  keeps the footprint service's default `embedQuery` (C21), and the build loop's `searchPartsForAI` (C54) is reached only from
  `POST /api/schematic/build`, `/build-multi` and `/edit-build`. Each of those rows has its per-principal window (60 a minute), which is
  their bound. **CONFIRMED** (`b24-a3-principal-limits` case 8). [B24-A3 review, 2026-10-08] `tests-05`: case 8 searched route files
  for one import spelling; it now derives the reach from the runtime import graph of every production file - the modules that import
  `searchPartsForAI` are exactly the build loop (by name, or by a namespace or star form), and the routes whose runtime closure reaches
  it are exactly those three, each a per-principal row, however they import - and pins that the tool registered on that binding
  (`sirkit.parts.search`) is exposed to neither the agent nor MCP (`not_agent_exposed`). A module reached from the public footprint
  route that re-exported `searchPartsForAI` failed it (section 21). [PR-G, 2026-10-17] Four since product reliability D (OD-243): `POST /api/chat` injects the shared Build generation as the agent's generate-proposal port (`app/api/chat/schematic-generation-runtime.ts`), so its closure reaches the build loop too; its bound is its own per-principal chat window (60 runs a minute, taken in `agentStreamRoute`), one generation per run under `BUILD_BUDGET`, and case 8 now lists it and holds it to that window.

## 18. Part 2: the gate at OD-197's full scope, and its test-first record

- **The gate.** `abuseLimitViolations` now covers every authenticated provider-credit or expensive row too: without a per-principal
  window it is `credit_unlimited` or `expensive_unlimited` (both when it is both); a malformed window is `limit_invalid`; an entry that
  names no gated authenticated row is `orphan_limit`. The two registries never stand in for each other. The reasons are a closed set of
  eight, and the two registries' key set is exactly the 43 gated rows plus sign-in (`b24-a3-credit-census` case 8; C30, C55).
  [B24-A3 review, 2026-10-08] `coverage-signin-gate-gap`: nine - a table without sign-in's window reported nothing, though sign-in is in
  the gate's scope; it is now `public_signin_unlimited` (cases 2, 3, 8; red on the reviewed tree).
- **Red on the A3a tree.** Part 2's three suites were written first and run on the A3a tree, twice ([B24-A3 review, 2026-10-08]
  `coverage-a3b-red-record`: corrected to what the logs show). The first run (2026-10-07 15:01, with the part-1 suites beside them,
  `a3-green3-red-b.log`): 3 of 20 files failed and 11 cases failed, 205 passed - `b24-a3-principal-limits` 1-8, `b24-a3-credit-census`
  case 8, page case 5 (the part-2 statements were not yet on the page) and page case 7. The second (23:02, the four part-2 sources -
  `abuse-limits.ts`, `authorize.ts`, `route-resource-classification.ts`, `route-handlers.ts` - restored to the A3a tree and back, each
  verified by sha256, `a3-red-b2.log`): 3 files failed, 11 cases failed, 12 passed - `b24-a3-principal-limits` 1-8, census case 8,
  page cases 3 and 7. Both runs used the values then proposed, not the final ones: an expensive row at 10 in both (case 3 "admits
  10"), chat at 20 in the first and 60 in the second; the final 50 for an expensive row was never run red then. So
  the final part-2 suites were run red once more on 2026-10-08, the review's cases included, on the same four A3a sources restored and back by sha256
  (section 21). The failures were assertions on the A3a tree, not only a missing export: the
  request past each window reached the handler and answered 200, not 429 (cases 2-4: a provider-credit row, an expensive row, and
  the window after 401/403 refusals), chat's run past its window answered 200 (case 5), the authenticated branch took no window
  (case 7); `PRINCIPAL_ABUSE_LIMITS`, `takePrincipalAbuseLimit` and the two authenticated reasons did not exist (cases 1, 6, 8, census
  case 8, page case 7). The page's citation case failed too, its part-2 anchors absent from the A3a sources.

## 19. What stays open

- The windows are per process (section 2) and a restart forgets them; a shared limiter is OD-197's alternative. **RECORDED**.
- With the header unset, the lockout trade-off of section 5 stands. **RECORDED**.
- The preview's block is bounded only between candidates (section 9): [B24-A3 review, 2026-10-08] at the reviewed bounds one admitted
  request blocked for at most 1.5 s measured, about 15 s of every minute per process at the global window; the bounds were chosen from
  the shapes measured, and a board inside them that is slower than every shape tried is not excluded (**INFERRED**). Lower bounds,
  taking the preview off the request thread (a worker with a hard stop), or requiring sign-in (OD-197's alternative) are the owner's.
  The reviewed bounds refuse a polygon outline and any board above 30 footprints: a tool that previews a real board with a polygon
  outline gets 413 here and runs the engine itself instead (the editor worker and the agent's placement tool are not bounded by this
  route). **RECORDED**.
- With the header set, the lockout stands (section 5): the per-client key map can be filled by a caller with enough distinct
  addresses or /64 prefixes, after which the per-client windows fall back to the global one. **INFERRED** (not executed).
- The embedding meter has no per-call ticket like B21's LLM breaker: a call admitted just before an opening and answering after it is
  ignored while the breaker is open (pinned, `b24-a3-embedding-admission` 8), but one answering during the half-open trial is counted
  as the trial's. **INFERRED**, low.
- A per-principal window refuses a principal id outside `ID_PATTERN` (fail closed, `b24-a3-principal-limits` 10); the trusted context
  checks the selector's ids against it, and the principal id is a Supabase user id or a fixed local-development id, never caller text.
  **CONFIRMED** for the refusal; that no real principal id fails the pattern is **INFERRED**, low.
- The B21 LLM-provider meter and B20's distributor meter, which predate A3, still read `Date.now()`: under the fixture runtime's frozen
  clock their windows are also one budget per run. Whether a browser spec reaches them past their limits was not checked here; A3
  does not change them. **INFERRED** (their callers were not read for this), recorded for the lead.
- The browser jobs were not run here (section 20): whether any spec meets a window there is the lead's run. **PROPOSED**.

## 20. Gates

Every run below is offline, on this host, through the lead's lock (vitest two workers), on the A3 working tree. **CONFIRMED** (executed).

**The review round's gates** (2026-10-08, after the last edit to a source or test file; logs `a3fix-gate-*.log`, `a3fix-tsc-1.log`,
`a3fix-eslint-1.log`, `a3fix-gen-*.log`). No run reported `Timeout calling onTaskUpdate`.

| gate | files | result | exit |
|---|---|---|---|
| the B24 suites, `app/lib/qualification/__tests__` (A1, A2 and A3: 16 files), `app/lib/fixture-runtime/__tests__` (the clock's reader), `objectives-transaction-api`, `b19-d-review-price-consistency`, `b19-e-bom-sources`, `b19-e-atomic-revision-loaders`, `b19-e-publication-boundaries`, `b19-e-publication-fake-vendors`, `b16-0-2-spice-scope-isolation`, `b19-e-build-library-exact-revision`, B14's `b14-4-ast-import-gates` | 27 | 291 passed | 0 |
| `app/lib/auth/__tests__`, `app/lib/http/__tests__` | 42 | 493 passed, 9 skipped | 0 |
| `app/api` (every route suite: the gated rows' and `app/api/__tests__`, `auth`, `mcp`, `chat`, `bom`, `parts`, `components`, `agent`, `assignment-queue`, `passive-policy`, `pcb-sync`, `pcb/export/gerbers`, `physical-bindings` among them) | 101 | 100 passed, 1 skipped; 1,707 tests passed, 5 skipped | 0 |
| `app/lib/mcp` (B20-B4 stop evidence, inbound limits, the B20-B2 import gates), `app/lib/acquisition/__tests__`, `app/lib/manufacturing-providers/__tests__` (B23 closeout statements), `app/lib/computation/__tests__` (B22 closeout statements), `app/lib/distributors/__tests__` | 134 | 131 passed, 3 skipped; 1,865 tests passed, 20 skipped | 0 |
| `app/lib/agent`, whole (`orchestration`, the B21 import gates and closeout statements, `b20-a4-observation-read-service`, B11.5 capture exactness) | 85 | 875 passed | 0 |
| `app/lib/workflow` (the acceptance and recovery pipelines), `sec-1-deck-injection`, `worker-integration`, `b12-boundary-and-e2e`, `b14-1-production-integration`, `b15-3-production-integration` | 10 | 9 passed, 1 skipped; 320 tests passed, 3 skipped | 0 |
| `b23-b-exchange-ledger-pglite`, as the `database-delivery` job runs it (no database URL) | 1 | 5 passed | 0 |
| the page's last run, after its last edit: this page's suite, A2's five suites (A2's page), the B21, B22 and B23 closeout statement suites | 9 | 93 passed | 0 |
| `tsc --noEmit -p tsconfig.json` | - | no error | 0 |
| eslint on the 26 changed or new `.ts`/`.tsx` files | 26 | 0 problems | 0 |
| the generators `generate-b16-0-1-artifacts`, `generate-b16-0-2-artifacts` (the two CSVs as A3 regenerated them), `generate-b16-0-4-artifacts` (168 rows), `generate-b16-0-7-artifacts` (168 / 165 / 3 / 0), `generate-b16-0-8-baseline` (3 -> 3), `generate-action-toolability-matrix` (107 records), `generate-agent-artifacts` (36 of 47), `generate-b17-control-inventory` (631 controls, 63 surfaces) | - | no file moved: the sha256 of every changed, new and `artifacts/` file is the same before and after | 0 |

**Before the review** (2026-10-07, the A3 tree as the review read it; logs `a3-gate-*.log`), **RECORDED** as run then:

| gate | files | result | exit |
|---|---|---|---|
| the B24 suites, `app/lib/qualification/__tests__` (A1, A2 and A3: 16 files) | 16 | 157 passed | 0 |
| `app/lib/auth/__tests__`, `app/lib/http/__tests__` (before the expensive window became 50; again in the last run below) | 42 | 493 passed, 9 skipped | 0 |
| `app/api` (every route suite, the gated rows' and `app/api/__tests__`, `auth`, `mcp`, `chat`, `bom`, `parts`, `components`, `agent`, `assignment-queue`, `passive-policy`, `pcb-sync`, `pcb/export/gerbers`, `physical-bindings` among them) | 101 | 100 passed, 1 skipped; 1,707 tests passed, 5 skipped | 0 |
| `app/lib/mcp` (B20-B4 stop evidence, inbound limits, the B20-B2 import gates), `app/lib/acquisition/__tests__`, `app/lib/manufacturing-providers/__tests__` (B23 closeout statements), `app/lib/computation/__tests__` (B22 closeout statements), `app/lib/distributors/__tests__` | 134 | 131 passed, 3 skipped; 1,865 tests passed, 20 skipped | 0 |
| `app/lib/agent`, whole (`orchestration`, the B21 import gates and closeout statements, `b20-a4-observation-read-service`, B11.5 capture exactness) | 85 | 875 passed | 0 |
| the single files: `objectives-transaction-api`, `b19-d-review-price-consistency`, `b19-e-bom-sources`, `b19-e-atomic-revision-loaders`, `b19-e-publication-boundaries`, `b19-e-publication-fake-vendors`, `b16-0-2-spice-scope-isolation`, `b19-e-build-library-exact-revision`, B14's `b14-4-ast-import-gates` (with the 16 B24 suites) | 25 | 264 passed | 0 |
| `b23-b-exchange-ledger-pglite`, as the `database-delivery` job runs it (no database URL) | 1 | 5 passed | 0 |
| the last run, after the last code edit: `app/lib/auth/__tests__`, `app/lib/http/__tests__`, the 16 B24 suites, `app/lib/workflow` (the acceptance and recovery pipelines), `sec-1-deck-injection`, `worker-integration`, `b12-boundary-and-e2e`, `b14-1-production-integration`, `b15-3-production-integration`, the B21, B22 and B23 closeout statement suites (on this page), `b20-b4-stop-evidence` | 72 | 71 passed, 1 skipped; 1,005 tests passed, 12 skipped | 0 |
| `tsc --noEmit -p tsconfig.json` | - | no error | 0 |
| eslint on the 25 changed or new `.ts`/`.tsx` files | 25 | 0 problems | 0 |
| the generators `generate-b16-0-1-artifacts`, `generate-b16-0-2-artifacts` (the two CSVs, regenerated), `generate-b16-0-4-artifacts`, `generate-b16-0-7-artifacts` (168 / 165 / 3 / 0), `generate-b16-0-8-baseline` (3 -> 3), `generate-action-toolability-matrix` (107 records), `generate-agent-artifacts` (36 of 47), `generate-b17-control-inventory` (631 controls, 63 surfaces) | - | no diff beyond the two CSVs | 0 |

- **The first `app/api` run failed, as the counts predicted:** with the proposed expensive window (10), 6 files and 19 cases answered 429
  where they expect 200, 400, 404, 409 or 422 (`b16-0-13`, `b16-0-15` and `b16-0-23` tranche parity, the autoroute route suite,
  B16-A's release confirmation, B16.0.2's engineering export). The counting runs (the windows switched off for that run only, restored
  by sha256: 371 files, 367 passed and 4 skipped, 5,038 tests; and 151 files, 150 passed and 1 skipped, 1,749 tests, over
  `app/lib/workflow`, `app/lib/project`, `app/lib/engineering`, `app/lib/spice` and `app/lib/fixture-runtime`) gave the counts of
  section 15, and the expensive window became 50: the rerun is the row above. [B24-A3 review, 2026-10-08]
  `coverage-measurement-evidence`: that failing run's log was overwritten by the passing rerun (`a3-gate-api.log`), so its counts are
  **RECORDED** as written at the time, not re-checked; the counting runs' logs are kept (`a3-count-1.log`, `a3-count-2.log`).
- **Not run here (the lead's):** the Playwright browser job (`playwright.config.ts`, A2's `e2e/security-headers.spec.ts` included) and
  `playwright.orchestration.config.ts`, once each with no vitest running; no `next dev`, `next build` or `next start`. Whether a browser
  spec meets a window is **PROPOSED** until then (section 15's counts are from the spec's source and B18-C's recorded run).
- **The AST and import gates** (`b14-4-ast-import-gates`, `b20-b2-import-gates`, `b21-a-import-gates`, B20-B4's process gate) passed
  in their batches with no "Timeout calling onTaskUpdate".

## 21. The review round (2026-10-08)

The adversarial review of the A3 tree confirmed fourteen findings. Each was reproduced first - a new or extended case run on the
reviewed sources and seen to fail (`a3fix-red-1.log`, `a3fix-red-2.log`, `a3fix-red-3.log`), or, for a finding about a test's
strength, the strengthened case seen to pass on the reviewed code and to fail on one deliberate breakage of the source, the source
then restored and checked by sha256 (`a3fix-mut-M-A.log` to `a3fix-mut-M-H.log`, `mutate.py`) - then fixed and re-run (section 20).
**CONFIRMED** (executed).

- `regressions-1` (high): the windows never rolled over under the browser job's frozen clock. Reproduced by `b24-a3-abuse-limits` 9,
  `b24-a3-principal-limits` 9 and `b24-a3-embedding-admission` 9: with the fixture runtime's frozen clock installed, each window
  refused past its limit and still refused after the real clock had moved 61 s - sign-in "expected 429 to be 503", chat and the
  meter "expected 429 to be 200". Fixed: `unfrozenNowMs` (C56), appended to the fixture clock; `authorize.ts` takes both kinds of
  window on it (C2, C43), and the meter admits, records and answers `Retry-After` on it (C14). Green.
- `security-1` (high) and `coverage-preview-block-not-closed`: one admitted anonymous preview blocked the server for minutes, and the
  page recorded F1 as closed. Reproduced by `b24-a3-placement-bound` 1, 2 and 5 and `b20-b4-stop-evidence` 6: the engine received
  `candidateCount: 4` and `localRefinementPasses: 1` for a caller's 8 and 3, and case 5's crowded 30-footprint board ran more than two
  evaluations - its file held the vitest worker for minutes (229 s, with `Timeout calling onTaskUpdate`). Fixed: the reviewed ceilings
  and bounds, chosen from measurement (section 9). Green; case 5 runs in about a second.
- `security-3`: the board bound counted five lists and missed the cost drivers. Reproduced by `b24-a3-placement-bound` 3 and 6: a
  31-footprint board reached the revision hash (and threw), a body over 1,000,000 bytes, a polygon outline, 129 pads in one footprint,
  2,402 polygon-pad vertices, 516 zone vertices and 516 keepout vertices each reached the engine (422, not 413). Fixed: the body-size,
  per-footprint, polygon-pad, zone-vertex, keepout-vertex and outline bounds, the body's size checked first. Green.
- `security-2`: configuring the header did not remove the lockout, and IPv6 was keyed per address. Reproduced by
  `b24-a3-abuse-limits` 10: a second address in a spent /64 was admitted, "expected 503 to be 429". Fixed: `clientWindowKeyPart`
  (C58) keys an IPv6 client by its /64 and an IPv4-mapped one as its IPv4 address; section 5 and the OD-197 text now say the lockout
  stands with the header set (three keyed clients exhaust sign-in, pinned by the same case). Green.
- `coverage-signin-gate-gap`: a table without sign-in's window passed the gate. Reproduced by `b24-a3-credit-census` 2, 3 and 8,
  "expected [] to deeply equal [ Array(1) ]". Fixed: `public_signin_unlimited` (section 18). Green.
- `coverage-a2-page-stale-total`: A2's page said 80 rows under a table that sums to 81. Reproduced by `b24-a2-env-names` 9, "expected
  80 to be 81". Fixed: the dated note "80 -> 81" on that line. Green.
- `coverage-a3b-red-record`: section 18 did not match the logs and the final values were never run red. Section 18 now states both
  runs as logged; the final part-2 suites were run red on the four A3a sources, restored and back by sha256 (`a3fix-red-b3.log`): 3
  files failed, 16 cases failed and 10 passed - `b24-a3-principal-limits` 1-10 (case 2 carried no `Retry-After`, "expected null to be
  '30'"; case 3 at the final 50, case 4 and case 5's chat run 61 answered 200, not 429), census cases 2, 3 and 8, and page cases 3, 7
  and 8.
- `coverage-measurement-evidence`: section 9 stated a refusal timing with no log and called a board without copper the largest
  admitted one, and section 20 stated a failing run whose log had been overwritten. Section 9's every measured figure now names its
  log and the unlogged timing is withdrawn; section 20 labels that run **RECORDED**. Pinned by page case 8.
- `tests-01`: no case recorded an outcome while the embedding breaker was open. `b24-a3-embedding-admission` 8 passes on the reviewed
  code and failed with the guard deleted (M-F).
- `tests-02`: no case reached an enforcement site with a refusal other than `limited`. `b24-a3-abuse-limits` 11 and
  `b24-a3-principal-limits` 10 pass on the reviewed code; the public site failing open on a non-`limited` refusal (M-B) failed case
  11, the principal site doing so (M-A) failed case 10.
- `tests-03`: `Retry-After` values were range-checked only. `b24-a3-embedding-admission` 3, `b24-a3-abuse-limits` 6 and
  `b24-a3-principal-limits` 2 pin exact values; the meter's capped at 60 (M-C), the public site's a constant "60" (M-D) and the
  principal site's (M-E) each failed its case.
- `tests-04`: the counted spies were never asserted. `b24-a3-abuse-limits` 2 now asserts that every refusal reads and embeds nothing;
  `publicRoute` running its handler before the window refuses (M-G) failed it.
- `tests-05`: case 8 found the build loop's routes by one import spelling. `b24-a3-principal-limits` 8 derives them from the runtime
  import graph; a module the public footprint route reaches re-exporting `searchPartsForAI` (M-H) failed it.

[B24-A3 lead, 2026-10-08] **The check's two new issues.** (1) The preview's bounds did not count a footprint's `allowedRotations`,
which the engine refines value by value inside the first candidate its budget cannot interrupt (`problem.ts:106-107`, `engine.ts:174`),
nor its `pinPadMappings`, each a terminal: one anonymous request inside every other bound could carry about 100,000 rotation values.
The lead closed it test-first: `b24-a3-placement-bound` case 7 failed on the fixed tree (1,000 rotations admitted, 422 where 413 is
due; `a3lead-red2`), and the route now refuses, before the engine, more than 4 rotations in one footprint, any rotation other than 0,
90, 180 or 270, more than 128 pin-pad mappings in one footprint and more than 600 in all, each 413 naming its bound; a footprint with
exactly the four rotations and 128 mappings is admitted. The B24 suites and `b20-b4-stop-evidence` 176 of 176 (`a3lead-green`).
The measured worst admitted request (section 21) stands for boards inside these bounds; a request at the new mapping bound was not
re-measured (INFERRED: at most the pad bound's terminals). (2) Keying IPv6 per /64 makes every host on one IPv6 network share one
per-client window: a stated trade-off, RECORDED.

## 22. Citations, as of the B24-A3 tree

| id | file | line | within | anchor | what |
|---|---|---|---|---|---|
| C1 | `app/lib/auth/authorize.ts` | 77 | — | `if (!policy.requiresAuth) {` | the public branch |
| C2 | `app/lib/auth/authorize.ts` | 82 | — | `const abuse = takePublicAbuseLimit(` | the windows, after CSRF, before the branch answers |
| C3 | `app/lib/auth/authorize.ts` | 187 | — | `function trustedClientValue(` | the one configured header, bounded |
| C4 | `app/lib/auth/authorize.ts` | 195 | — | `function publicRateLimited(` | 429 `PUBLIC_RATE_LIMITED`, `Retry-After`, no-store |
| C5 | `app/lib/auth/abuse-limits.ts` | 51 | — | `export const ABUSE_LIMITS` | the registry |
| C6 | `app/lib/auth/abuse-limits.ts` | 31 | — | `export const PUBLIC_SEARCH_GLOBAL_LIMIT` | one constant per value |
| C7 | `app/lib/mcp/server/inbound-limits.ts` | 74 | — | `export function createFixedWindowLimiter(` | the reused limiter (B20), unchanged |
| C8 | `app/lib/mcp/server/inbound-limits.ts` | 90 | — | `if (entry.count >= perWindow) return refusal("limited"` | a refusal consumes nothing |
| C9 | `app/lib/auth/abuse-limits.ts` | 72 | — | `export const TRUSTED_CLIENT_IP_HEADERS` | the closed header list |
| C10 | `app/lib/acquisition/admission-control.ts` | 535 | — | `export const EMBEDDING_ADMISSION = Object.freeze({` | the meter's values |
| C11 | `app/lib/auth/abuse-limits.ts` | 101 | — | `export function clientIpLiteral(` | exactly one IP literal |
| C12 | `app/lib/auth/abuse-limits.ts` | 115 | — | `export function publicWindowDecision(` | per client, then global |
| C13 | `app/lib/embedding-admission.ts` | 36 | — | `export function classifyEmbeddingError(` | outcomes by status and code |
| C14 | `app/lib/embedding-admission.ts` | 46 | — | `export async function admittedEmbedQuery(` | admission, call, outcome |
| C15 | `app/lib/acquisition/admission-control.ts` | 50 | — | `{ kind: "embedding"; provider: "openai"; model: string }` | the key, appended to the union |
| C16 | `app/lib/acquisition/admission-control.ts` | 305 | — | `resetEmbeddingMeter(); //` | the reset clears the meter |
| C17 | `app/api/parts/search/route.ts` | 250 | — | `queryEmbedding = await admittedEmbedQuery(query, { purpose: "interactive" });` | the parts search through the meter |
| C18 | `app/api/parts/search/route.ts` | 253 | — | `return lexical(db, where, query, limit, offset);` | the lexical fallback |
| C19 | `app/api/pcb/footprints/search/route.ts` | 61 | — | `if (err instanceof EmbeddingAdmissionRefused)` | 429 `EMBEDDING_ADMISSION_PAUSED` |
| C20 | `app/lib/pcb/footprint-search-service.ts` | 52 | — | `if (EXACT_REF_RE.test(q)) {` | the exact path, no embedding |
| C21 | `app/lib/pcb/footprint-search-service.ts` | 63 | — | `const queryEmbedding = await (deps.embed ?? embedQuery)(q);` | the injected call |
| C22 | `app/api/pcb/placement/preview/route.ts` | 34 | — | `const tooLarge = publicPreviewBoundRefusal(input.board, bytes);` | the bound, the body's size first |
| C23 | `app/api/pcb/placement/preview/route.ts` | 23 | — | `return clampPublicPreviewRequest(result); // [B24-A3] OD-197` | the clamp |
| C24 | `app/api/pcb/placement/preview/route.ts` | 52 | — | `const PUBLIC_PREVIEW_CEILINGS = Object.freeze(` | the ceilings |
| C25 | `app/api/pcb/placement/preview/route.ts` | 53 | — | `const PUBLIC_PREVIEW_BOUNDS = Object.freeze(` | the bounds |
| C26 | `app/lib/pcb/placement/engine.ts` | 327 | — | `checkBudget(startedAt, timeoutMs, input.observer)` | the budget is checked between candidates |
| C27 | `app/lib/pcb/placement/engine.ts` | 309 | — | `Math.max(50, Math.min(120_000, Math.round(options.timeoutMs ?? 15_000)))` | the engine accepts up to 120 s |
| C28 | `app/lib/auth/route-policy.ts` | 62 | — | `function pub(path: string, methods: readonly string[], evidence: string, opts: { providerCredit?: boolean } = {})` | `pub()` may declare credit |
| C29 | `app/lib/auth/route-policy.ts` | 257 | — | `pub("/api/pcb/placement/preview", ["POST"], "stateless compute")` | the preview row, byte-identical |
| C30 | `app/lib/auth/route-resource-classification.ts` | 277 | — | `export function abuseLimitViolations(` | the census gate |
| C31 | `app/lib/auth/route-resource-classification.ts` | 265 | — | `export function reviewedMeteredPublicCredit(` | the one excuse |
| C32 | `app/lib/auth/route-resource-classification.ts` | 215 | — | `publicHasCreditOrWrite: rows.filter(` | narrowed in place |
| C33 | `app/lib/auth/route-resource-classification.ts` | 196 | — | `expensive: annotation.expensive ?? PUBLIC_EXPENSIVE_PATHS.has(policy.path)` | the three rows expensive |
| C34 | `app/signin/page.tsx` | 44 | — | `code === "PUBLIC_RATE_LIMITED" ? "Too many sign-in attempts; try again in a minute."` | the throttled message |
| C35 | `app/lib/auth/request-security.ts` | 52 | — | `export function requireSameOrigin(` | an `Origin` a non-browser client sets |
| C36 | `app/components/editor/BuildLibraryPanel.tsx` | 211 | — | `const res = await fetch("/api/parts/search", {` | the panel's search |
| C37 | `app/lib/engineering/control-surface.ts` | 66 | — | `export const DEFAULT_CONTROL_ROOTS = ["app/page.tsx", "app/components", "app/lib/pcb/render/scene.ts"] as const;` | B17-A's control roots |
| C38 | `app/lib/embeddings.ts` | 23 | — | `throw new Error("OPENAI_API_KEY is not set. Add it to .env.local.");` | thrown before any request |
| C39 | `app/lib/embeddings.ts` | 25 | — | `client = new OpenAI({ apiKey });` | no `maxRetries`: the SDK's default |
| C40 | `app/lib/auth/abuse-limits.ts` | 202 | — | `export const PRINCIPAL_ABUSE_LIMITS` | the per-principal registry (part 2) |
| C41 | `app/lib/auth/abuse-limits.ts` | 167 | — | `export const PRINCIPAL_CHAT_LIMIT` | one constant per kind |
| C42 | `app/lib/auth/authorize.ts` | 97 | — | `const principal = principalRateLimitRefusal(context, policy);` | after membership and role, before the answer |
| C43 | `app/lib/auth/authorize.ts` | 203 | — | `export function principalRateLimitRefusal(` | 429 `PRINCIPAL_RATE_LIMITED`, keyed on the trusted context |
| C44 | `app/lib/auth/route-handlers.ts` | 853 | — | `const principalRefusal = principalRateLimitRefusal(trusted.context, policy);` | chat's window, after its role check |
| C45 | `app/lib/auth/route-handlers.ts` | 827 | — | `const bounded = await readBoundedStream(request.body, options.maxBytes);` | chat reads its body first |
| C46 | `app/lib/auth/route-handlers.ts` | 1039 | — | `const admitted = mcpEndpointLimiter.take([claims.tenantId, claims.projectId, claims.subject], nowMs);` | MCP's fail-closed window, the precedent |
| C47 | `app/lib/acquisition/admission-control.ts` | 257 | — | `export function requestAdmission(` | the distributor quotas |
| C48 | `app/lib/computation/diagnostic-runner.ts` | 46 | — | `export const DIAGNOSTIC_RUNNER_MAX_QUEUED = 64;` | the ngspice cap and its queue |
| C49 | `app/lib/manufacturing-providers/provider-exchange.ts` | 84 | — | `PX_PLAN_LIMIT_REACHED: { status: 429,` | the provider exchange's bounds |
| C50 | `app/lib/acquisition/admission-control.ts` | 507 | — | `export function requestManufacturingProviderAdmission(` | the manufacturing-provider meter |
| C51 | `app/api/chat/orchestration-runtime.ts` | 42 | — | `export function orchestrationEnabled(` | the flag, off unless exactly "1" |
| C52 | `app/api/chat/orchestration-runtime.ts` | 834 | — | `export function pausedFirstTurn(` | the first turn reads the meters only |
| C53 | `app/lib/acquisition/admission-control.ts` | 339 | — | `the coordinator's own first turn is not metered in B21-E1.` | still true |
| C54 | `app/lib/parts-search.ts` | 281 | — | `export async function searchPartsForAI(` | the build loop's embedding path |
| C55 | `app/lib/auth/route-resource-classification.ts` | 288 | — | `principalScoped.add(key);` | the gate's authenticated half |
| C56 | `app/lib/fixture-runtime/clock.ts` | 75 | — | `export function unfrozenNowMs(` | the windows' and the meter's clock (review) |
| C57 | `instrumentation.ts` | 12 | — | `installFixtureClock();` | the fixture runtime freezes `Date.now()` at start-up |
| C58 | `app/lib/auth/abuse-limits.ts` | 243 | — | `export function clientWindowKeyPart(` | an IPv6 client by its /64 (review) |
