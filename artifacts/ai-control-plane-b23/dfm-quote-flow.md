# B23-B2 - bounded transfer and receipts: steps 4 and 5 of the DFM and quote flow

Labels: **CONFIRMED** (executed and measured here, or read at the cited file:line), **INFERRED** (a conclusion from reading code; nothing
executed it), **PROPOSED**, **RECORDED** (written down without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Tree: `chapter/b23-external-manufacturing`, base `0c78e93` (B23-B1), working tree of 2026-10-04, after the adversarial review round
(section 15) and the lead's round on an independent check's three low findings ([B23-B2 lead, 2026-10-04], section 16). Runbook B23-B steps 4 and 5 (`:978-979`): "Upload with bounded streaming, timeouts and idempotency." and "Store provider
receipt, artifact digest, capability/profile version and timestamp." Closes D23-3, D23-4's exchange half and D23-5's receipt half;
D23-4's order-contract half stays B23-C's (OD-172) and D23-5's staleness half B23-B3's (OD-168). Owner decisions applied: OD-165 and
OD-167; B2's own choices beyond its task text are OD-184 (section 12). **Verdict: steps 4 and 5 are met offline, against an in-process
fake provider behind the real egress boundary. A live exchange stays BLOCKED-LIVE-QUALIFICATION (LB-11): no provider is admitted, no
transfer descriptor exists and Sirkit holds no provider account (OD-160).** Steps 6-8 (observations, staleness, no auto-accept) are B23-B3's. [B23-B3, 2026-10-04] Since B23-B3 steps 6-8 are met offline too: section 17 holds the verdict for all eight steps, sections 18-20 the three steps.

## 0. What B23-B2 is

- **Step 4, the bounded upload (D23-3, OD-165).** `outboundUpload`, an additive extension of the one egress boundary
  (`app/lib/net/outbound-fetch.ts:487`), carries an in-memory body - bytes, or a multipart encoding of in-memory parts written there -
  through `outboundFetch` itself. The request-byte ceiling is the descriptor's and never above the release bounds of 64 files and 64 MiB;
  every 3xx answer is refused; one deadline covers the whole exchange, the caller's durable `sent` mark included; no secret is in the
  URL; `Idempotency-Key` is sent only when the descriptor declares support. No new dependency (OD-42). CONFIRMED (`b23-b-bounded-upload`,
  10 cases)
- **The one sending module.** `app/lib/manufacturing-providers/provider-egress.ts`: the reviewed transfer descriptor (none exists), the
  `manufacturing-provider` meter (agent share 0) and ONE upload of the outbound package, classified into an outcome. Only the exchange
  service imports it, past admission. CONFIRMED (`b23-b-provider-meter`, 7 cases; `b23-b-egress-import-gate`, 6 cases)
- **Step 5, the receipts (D23-4, D23-5, OD-167).** `app/lib/manufacturing-providers/exchange-ledger.ts`: one silent durable aggregate
  `mfg.provider-exchange.v1` per (scope, board, provider), the design of B22's `computation.evidence.v1`. Attempts keyed by idempotency
  key move `prepared -> sent -> acknowledged | rejected | UNKNOWN_PENDING_RECONCILIATION`, or `-> not_sent`. Keys are unique per project;
  one package to one provider is in flight at a time; the provider sees a server-derived key. CONFIRMED (`b23-b-exchange-ledger`, 22
  cases; `b23-b-exchange-ledger-pglite`, 4 cases on PostgreSQL) [B23-B2 lead, 2026-10-04] Since the lead's round: 28 and 5 cases; one package is the package digest, provider and operation, and a `prepared` attempt stops blocking ten minutes after it was prepared (section 16).
- **The send path.** The exchange service (`provider-exchange.ts:348`) calls `send` only after B1's revalidation re-ran on a consumed
  plan and admission admitted. In production nothing is admitted, so a commit still ends `provider_not_admitted` before any byte leaves.
  CONFIRMED (`b23-b-exchange-ledger` case 10; B1's suites green, with `b23-b-exchange-route` case 4 and `b23-b-approval-plan` case 9
  moved in place, section 10)
- **Unchanged.** No route added: the census stays 166 / 163 / 3 / 0. No agent tool: 47 / 36 / 9 / 27. No UI change, no generated artifact
  moved (all 21 generators, no drift), the pinned release identities untouched, no provider contacted, no account, no credential.
  CONFIRMED (section 11)
- **The page** is checked by `b23-b-dfm-quote-flow-page` (5 cases): its closure line, its section 10 against its own wording, every
  citation of section 14, the dated notes B2 owes earlier pages, and the exchange record's header. CONFIRMED [B23-B2 lead, 2026-10-04] A sixth case checks the dated notes on B1's not-found statements and section 4's order (low-1).

## 1. Step 4: the bounded upload (D23-3, OD-165)

D23-3's counterexample at `0c78e93`: `OutboundRequest.body` is `string | URLSearchParams` with no request-byte bound and no idempotency
field (`outbound-fetch.ts:128-134`), passed to the transport unchanged (`:252-261`). B2 leaves that request type and `outboundFetch`
as they were - every existing outbound-fetch, distributor, MCP and SchGen suite ran unchanged and green (section 11) - and appends
`outboundUpload` and `encodeOutboundUpload` at the end of the module. The one in-place edit is `:230`: the default transport is the
hoisted `defaultTransport` (`:557`), so the module still holds ONE global fetch, shared by both paths (the transport census of
`b23-a-route-vocabulary` case 8 counts one site, unchanged). In order, before anything is resolved or sent:

1. **No redirect.** The policy must say `maxRedirects: 0` (`:488`). Every 3xx answer is `redirect_refused` after exactly one transport
   call, never followed and never `ok`: the redirect statuses through the boundary's own rule (`:536`), and since the review the ones no
   redirect follows - 300, 304, 305, 306 - too (`:538`). CONFIRMED (case 5: nine statuses)
2. **No secret in the URL.** The policy may name no secret query parameter; an upload URL carries no query string and no fragment
   (`:496`); URL credentials stay the boundary's `url_credentials`. A credential travels in a header. CONFIRMED (case 7)
3. **The boundary owns its headers.** A caller may not set `Idempotency-Key`, `Content-Type`, `Content-Length`, `Host` or
   `Transfer-Encoding`. CONFIRMED (case 4)
4. **Idempotency only when declared.** With `idempotencyKeyHeader`, the key it is handed (1 to 128 of `[A-Za-z0-9._:-]`) travels as
   `Idempotency-Key` (`:504`); without it no such header is sent, whatever key the caller holds. The exchange service hands it the
   record's server-derived key, never the client's (section 4). CONFIRMED (case 4; ledger cases 13, 17)
5. **The ceiling.** `encodeOutboundUpload` (`:441`) refuses a ceiling outside 1..`OUTBOUND_UPLOAD_MAX_BYTES` (64 MiB) or parts outside
   1..`OUTBOUND_UPLOAD_MAX_PARTS` (64) - the release bounds `MAX_FILES = 64` and `MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024` of
   `app/lib/pcb/fab/validate-package.ts:14-15`, which case 2 reads from that file - and measures the encoded size before allocating: over
   the ceiling it answers `request_too_large` (`:467`) with nothing resolved or sent. Exactly at the ceiling the body is sent. CONFIRMED
6. **A part cannot break out.** Field and file names are printable text with no quote, backslash or control character; a media type is
   one plain type with no parameter; the boundary is 1 to 70 RFC 2046 characters; a part whose bytes hold `--<boundary>` is refused.
   CONFIRMED (case 3: eleven shapes)
7. **The hand-over.** The body is copied once into a fresh `Uint8Array`, digested (SHA-256), and handed to the transport on its single
   call. `beforeSend` (the caller's durable `sent` mark) runs immediately before, INSIDE the deadline: it races the deadline and the
   caller's abort (`:522`, `untilAborted` at `:543`), and the signal is checked again once it resolves (`:529`), so a `beforeSend` slower
   than the deadline, or one that never settles, ends `timeout` with nothing handed over - never a late hand-over on an aborted signal.
   Only then is `sendStarted` set (`:530`). A throwing `beforeSend` sends nothing and is `before_send_failed` (`:535`), never a network
   error. CONFIRMED (cases 9, 10; the re-check after the race is defence in depth: no case reaches it apart from the race)

The boundary's own rules hold for an upload (HTTPS only, the exact host, every resolved address public, the bounded reader) because the
upload IS an `outboundFetch` call: case 8 shows plain http, another host, a private, a metadata and a mixed loopback address, and a DNS
failure refused with nothing handed over, and an oversized answer `response_too_large` after the send. One deadline covers resolution,
the `sent` mark, connection, the upload, the answer's headers and its body: a provider that takes the whole body and never answers is cut
at the deadline (`timeout`, `sendStarted: true`), a resolver or a mark that never answers is cut with nothing handed over, and the
caller's abort is honoured (cases 6, 10). CONFIRMED

The multipart encoding is read back by the platform's own parser (`Request.formData()`): every field, file name (release paths with
`/` included), media type and byte. CONFIRMED (case 1; ledger case 13)

The DNS-rebinding window between the address check and the connect stays the recorded limit of the module header (`:13-16`; OD-51), as
for every other caller. RECORDED

## 2. The transfer descriptor and the one sending module

**The transfer descriptor** (`provider-egress.ts`, `ProviderTransferDescriptor`) is the reviewed, typed contract of one board-file
exchange: schema and version; provider and operation; the registry row's version and digest it was reviewed against; the exact HTTPS URL;
`maxRequestBytes` and `maxParts`; `deadlineMs` (at most 120 s); `maxResponseBytes` (at most 1 MiB); `idempotencyKeyHeader`; the credential
(`none`, or one header whose value is read by environment NAME at send time); the receipt's id field and the fields that may be kept;
`retention` (`normalized` or `ids_digests_timestamps_only`); `statusRead` (declared or not); and the meter. `validateTransferDescriptor`
(`:82`) holds it to its registry row: the row's version and digest; an `api` operation of tier `dfm_quote_transfer` whose state is
`enabled` and that is not recorded never-called; a URL whose host the row's `endpoint.hosts` lists, with no query, fragment or
credentials; the bounds; a credential header that is not one the boundary owns, naming an environment variable the row's credential
references list; a closed retention; a declared status read naming an `api` `read_observation` operation; bounded meters; and, the
structural tie of the ceiling to the provider, the row must RECORD an upload limit and an idempotency fact (not `UNKNOWN`). CONFIRMED
(ledger case 11: 24 violations, each refused with its own problem; an unrecorded upload limit refused)

**No descriptor exists.** `PROVIDER_TRANSFER_DESCRIPTORS` is empty and frozen (`:69`). Against the reviewed registry, the fake's
descriptor fails six ways: the row digest, the URL (every row's `hosts` is empty), the operation (JLCPCB's `pcb-quote` is blocked), the
credential reference (none listed), the unrecorded upload limit and the unrecorded idempotency fact. So even a forged admitting answer
sends nothing in this build. CONFIRMED (ledger case 10; `b23-b-approval-plan` case 9, its title moved in place, its assertions as B1
wrote them)

**The send** (`sendProviderExchange`, `:193`), in order: the credential (missing or not a printable header value: `not_sent`, no meter
spent); the `manufacturing-provider` meter (`:205`; paused: `not_sent` with the pause and its retry time); then ONE `outboundUpload` of
the outbound package as multipart form data - each file byte for byte under its release path (field `files`), then the provider manifest
(field `manifest`), boundary `sirkit-` + the last 40 hex characters of the package digest - with `beforeSend` writing `sent` durably and
the record's server-derived key as `Idempotency-Key`. Every outcome is reported to the meter. CONFIRMED (meter cases 6, 7; ledger cases
1, 13, 17)

**The outcome** (`classify`, `:223`):

| what happened | state | failure | kept |
|---|---|---|---|
| refused before the hand-over (credential, meter, ceiling, URL, host, address, DNS, a deadline or abort before it - during the `sent` mark too) | `not_sent` | the closed code | nothing |
| the `sent` mark failed (`before_send_failed`) | `not_sent` | `record_unavailable` (`:226`) | nothing |
| a 2xx JSON answer with a receipt id (1 to 128 of `[A-Za-z0-9._:-]`) | `acknowledged` | none | the response's status, media type, size and SHA-256; the receipt id and `retrievedAt`; the declared fields of a short printable string, a finite number or a boolean (none, and no media type, under `ids_digests_timestamps_only`) |
| a 4xx answer | `rejected` | `http_<status>` | the response's status, media type, size and SHA-256 |
| a 5xx answer, a 2xx with no readable receipt id or not JSON (a media type holding a control character is no usable type: kept empty, `:230`) | `UNKNOWN_PENDING_RECONCILIATION` | `http_<status>` or `receipt_unreadable` | the response's status, media type, size and SHA-256 |
| after the hand-over: a timeout, an abort, a transport error, an oversized answer, any 3xx | `UNKNOWN_PENDING_RECONCILIATION` | the boundary's code | nothing but the request digest |

The raw answer body is read through the bounded reader, digested and dropped: never stored, never answered. CONFIRMED (ledger cases 1, 2,
3, 7, 15: a sentinel in every fake answer occurs in no committed request, stored record, replay or answer)

## 3. The manufacturing-provider meter (OD-165)

`AdmissionKey` gains `{ kind: "manufacturing-provider"; providerId: string }` (`admission-control.ts:50`, appended in place on the line
B21-E1 extended; its key string `manufacturing-provider:<id>` on `:54`); the meter itself is appended at the end of the module
(`:486`, `:507`). One meter per provider: a minute and a day window and a breaker from the descriptor (Sirkit's own spend guard: no
provider documents its limits in section 1.2). The agent's share is 0 (`MANUFACTURING_PROVIDER_AGENT_SHARE`, `:486`): an agent request
is refused on a fresh meter and reserves nothing (`:508`). No line the B19-B21 pages cite moved; every earlier key kind keeps its
spelling, and the distributor, MCP and LLM meters are untouched. CONFIRMED (meter cases 1-5; the B19, B20 and B21 meter suites
unchanged and green)

| outcome (`meterOutcome`, `provider-egress.ts:256`) | the breaker learns |
|---|---|
| acknowledged | success |
| rejected 429 | rate limited (open at once) |
| other rejected | neutral |
| UNKNOWN after the send (but an abort) | failure |
| an abort | nothing (`inconclusive`) |
| not sent: DNS failure or a blocked address | failure |
| not sent otherwise (a deadline during the `sent` mark, the mark failing, a pause, the credential, the ceiling) | nothing (`inconclusive`) |

CONFIRMED (meter case 6: a used-up window is not sent to; two server errors open the breaker; the trial's acknowledgement closes it;
a 429 opens it at once; each pause with no transport call. Meter case 7: three 422 refusals, then three caller aborts, past a breaker
that two failures open, and an acknowledgement still goes. Ledger case 14: a deadline during the mark under a breaker that one failure
opens, and the next exchange goes)

## 4. Step 5: the exchange record `mfg.provider-exchange.v1` (D23-4, D23-5, OD-167)

B22-C's `computation.evidence.v1` (`app/lib/computation/evidence-store.ts`, OD-141) is the design copied, on the same durable-workflow
substrate, with the repository injected (the route composes the durable one over the same store as the release ledger,
`route.ts:62`; tests the in-memory one or PGlite):

- **One silent aggregate per (scope, board, provider)**, type `mfg.provider-exchange.v1` (`exchange-ledger.ts:43`), keyed through
  `durableWorkflowId`.
- **CAS and an idempotent append.** Each append (`:360`) is a compare-and-set on the aggregate revision under the durable idempotency
  key `attempt:<key>:<phase>`, phases `prepared`, `sent`, `settled`. A repeated or concurrent append of the same phase meets the first
  (by the revision check, by the replay row, or on PostgreSQL by a unique-index refusal, `23505`) and is answered from its replay; a
  conflict with ANOTHER attempt is retried on the new head, at most eight times - a durable write, never a send - and then refused
  `PX_EXCHANGE_CONTENDED`. CONFIRMED (ledger cases 6, 19, 20)
- **One key namespace per project.** The replay namespace of every exchange record of a project scope is one (`exchangeScopeKey`,
  `:270`): (tenant, project, branch), B1's key scope. A key names at most one attempt in a project, so a key used on one board is refused
  on another board or provider of the project, after a restart too, and another project's keys are its own. CONFIRMED (ledger case 22;
  PGlite case 4)
- **One package in flight.** A new attempt is refused `in_flight` while the aggregate holds another attempt of the same request (the
  same package, provider, operation and descriptor) that is `prepared` or `sent` - in flight, or interrupted by a crash (`:422`). The
  check runs against every head the append is tried on, so two concurrent commits of one package under two plans send once. CONFIRMED
  (ledger case 16; PGlite case 4) [B23-B2 lead, 2026-10-04] low-3: "the same request" is now the same package digest, provider (the aggregate's) and operation: the request digest, which a registry or descriptor revision moves, let a revised registry resend an interrupted package (ledger case 27). low-2: a `prepared` attempt `EXCHANGE_PREPARED_ABANDON_MS` (ten minutes) old is first settled `not_sent` (`abandoned`) by the next attempt of its package, and a `sent` mark lands only while its own attempt is still `prepared` on that head, so whichever lands first, the other is refused (ledger cases 25, 26). CONFIRMED
- **Digest re-verified on load.** Every record: its type and key, its closed payload, its record digest, the attempt's own digest, the
  attempt's rules, the phase-state match and the provider key's own derivation; an attempt is read from its latest phase's replay
  (`keyedAttempt`, `:331`) and checked against the record stored under that replay's id (`:339`), both verified, the phase and key
  matched. Any disagreement throws one closed error, `PX_LEDGER_DIGEST_MISMATCH`, and returns nothing. CONFIRMED (ledger case 8: four
  tamperings of what is stored and four of a replay alone; case 17: a provider key that is not its own derivation)
- **Silent.** Every commit carries `outbox: []` (`:376`): no outbox effect, ever. CONFIRMED (ledger cases 1, 2, 9; import-gate case 4)

**The record keeps**: the idempotency key, the plan id and digest, the provider-facing key, the request digest; the committing human
administrator; the operation and purpose; the registry version and row digest and the transfer descriptor's version; the capability
profile (`jlcpcb-2l`, version 2); the release id and archive SHA-256 and the `outboundPackageDigest`; the retention and whether a status
read is declared; the state; `preparedAt`, `sentAt`, `settledAt`; whether the send started; the request's size and SHA-256; the response's
status, media type, size and SHA-256; the provider's receipt id with `retrievedAt`; at most 16 normalized fields; and a closed failure
code. **It keeps no raw provider body and no archive or file byte**: B1 re-derives the bytes from the ledgered release while its authority
is head, its board current and its rule-profile evidence unexpired and within `RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS` (discovery 9.5 item
18); otherwise the exchange is stale, which is B23-B3's to show (OD-168). [B23-B3, 2026-10-04] Shown since B23-B3: an observation of an exchange whose authority is no longer head, whose board is not current or whose rule-profile evidence is out of window is stale at once (section 19); an ids-only answer is not stale for its retention. [B23-B3 review, 2026-10-04] coverage-7: this note stood after B2's next sentence and split it, so it seemed to call an ids-only answer stale; it now names its antecedent. A provider whose terms forbid storage keeps no provider-chosen
text: no normalized field and an empty media type (`:459`); what it keeps is Sirkit's own classification (state, failure code) and the
answer's protocol status, size and SHA-256 (OD-184 (k)). CONFIRMED (ledger cases 1, 7; PGlite case 3 over what PostgreSQL holds)

**The provider-facing key** (`providerIdempotencyKeyOf`, `:173`): `sx-` and 64 hex characters of a digest of the scope, the board, the
provider, the plan and the client's key, recorded on the attempt and re-derived on load. Every tenant sends under one provider account,
so the client's string never reaches the provider: two projects using the same key send different keys, and one attempt keeps its own.
CONFIRMED (ledger cases 1, 13, 17)

| state | written | carries |
|---|---|---|
| `prepared` | before the send, after admission | the plan's identity and versions; nothing sent |
| `sent` | immediately before the hand-over (`beforeSend`, inside the deadline) | the request's size and SHA-256 |
| `acknowledged` | after the answer | the response digest, the receipt, the kept fields |
| `rejected` | after the answer | the response digest, the failure |
| `UNKNOWN_PENDING_RECONCILIATION` | after the send started, with no clean answer | the failure; the response digest when one was read |
| `not_sent` | when nothing was handed over: from `prepared`, or from a `sent` mark that landed without a hand-over (the deadline fell during the mark), which keeps its time and digest (`:455`); [B23-B2 lead, 2026-10-04] or, ten minutes after it was prepared, by the next attempt of its package (`abandoned`, `:426`) | the failure (OD-184 (a)) |

A sender sends only after ITS OWN `prepared` and `sent` appends wrote new records (`:444`): a replayed `sent` means another sender holds
the attempt, so `beforeSend` throws and nothing is handed over. CONFIRMED (ledger case 18: two concurrent marks, one refused)

**B1's in-memory key store and the durable record** (OD-184 (c)). B1 keeps plans and key records in memory per project (32 open plans,
256 key records, backstops 2,048 and 16,384, 24 hours; OD-183 (d)). They stay the first answer: the same key in the same process replays
its recorded envelope, another plan's key is refused, a consumed plan answers `PX_PLAN_CONSUMED`, all before any durable read. Past
them the durable record is the outcome of record and the backstop:
- a commit whose plan this instance does not hold (a restart, another instance, an expired plan; `provider-exchange.ts:309`) is answered
  from the record under its key (`recorded`, `:440`): the same plan id and digest replay the recorded outcome (`idempotent: true`, nothing
  sent), another plan's are `PX_IDEMPOTENCY_KEY_REUSE_CONFLICT`, and a key naming nothing there answers `PX_PLAN_NOT_FOUND`, as before; [B23-B2 lead, 2026-10-04] low-1: that read comes BEFORE `PX_PLAN_NOT_FOUND`: with the record composed as the route composes it (`route.ts:62`), an unknown plan or another project's plan answers 404 only after up to three replay reads under its key in the requester's project, and a store that cannot be read answers the release route's `MFG_DURABLE_STORE_UNAVAILABLE` 503 instead; steps 1 and 2 never run for them, and the in-process refusals still read nothing. B1's statements that it answered before any port carry dated notes (`outbound-disclosure.md:207`, `:402`, `:426`, and B1's approval-plan case 4, whose ports hold no record). CONFIRMED (ledger case 23, the production composition)
- a fresh plan under a key the record already holds is refused durably (`PX_IDEMPOTENCY_KEY_REUSE_CONFLICT`), on any board or provider
  of the project - after its plan was consumed, since a plan is consumed before any await (B1's race rule).
B1's replay behaviour is unchanged (its suites are green). CONFIRMED (ledger cases 5, 16, 22: restarts with the server's random nonce)

**The answers.** A commit's answer stays B1's recorded envelope (the service's `refusal` slot): a refusal, or since B2 a send's outcome,
whose `body.ok` is true only when acknowledged. Every body carries its sentence in `error`, where the panel reads it (`:471`). New codes:
`PX_EXCHANGE_ACKNOWLEDGED` 200, `PX_EXCHANGE_REJECTED` 422, `PX_EXCHANGE_UNKNOWN_PENDING_RECONCILIATION` 502, `PX_EXCHANGE_NOT_SENT`
503, `PX_PROVIDER_PAUSED` 429, `PX_EXCHANGE_IN_FLIGHT` 409 (an unanswered attempt under this key, or another of this package to this
provider: `inFlight` names it), `PX_EXCHANGE_CONTENDED` 409. `PX_SEND_UNAVAILABLE` now says no reviewed transfer descriptor or durable
record exists. Each body carries the plan id, request digest, `sent`, the state, the receipt, the response's status, size and digest, the
failure and `idempotent`; never a raw body. CONFIRMED (ledger cases 1-5, 9, 10, 14-16, 20) [B23-B2 lead, 2026-10-04] low-2: `PX_EXCHANGE_NOT_SENT` now says only that the exchange stopped before any byte left (it said the exchange was recorded, which is false when it answers `recorded: false`), and `PX_EXCHANGE_IN_FLIGHT` says when an attempt stops blocking: a `sent` one when a person reconciles it, a `prepared` one ten minutes after it was prepared. CONFIRMED (ledger cases 24, 25)

**An answer that cannot be recorded.** The settle is a durable write, never a send, so it is tried up to three times
(`PROVIDER_EXCHANGE_SETTLE_ATTEMPTS`, `:456`). If it still fails, the answer is `PX_EXCHANGE_UNKNOWN_PENDING_RECONCILIATION` when bytes
left (`PX_EXCHANGE_NOT_SENT` otherwise) with `recorded: false`, `failure: "record_unavailable"`, `observed` (what the egress saw) and the
provider's receipt id and the response's status, size and digest, so a person can reconcile; the record still says `sent`, B1's store
replays that answer for the key, and nothing is resent. CONFIRMED (ledger case 15) [B23-B2 lead, 2026-10-04] low-2: for a `not_sent` outcome the record still says `prepared` (or `sent`, when a mark slower than the deadline landed), and a `prepared` one stops blocking its package ten minutes after it was prepared (ledger cases 24, 25). A provider field PostgreSQL's jsonb would refuse (a lone UTF-16 surrogate) is dropped at normalisation, so an acknowledged settle can always be written (ledger case 28; PGlite case 5, where PostgreSQL refuses the unfixed record with 22P02). CONFIRMED

## 5. Ambiguity, no retry, no outbox (D23-4)

- **UNKNOWN_PENDING_RECONCILIATION.** A timeout, a transport error, a 5xx, an unreadable answer, an answer without a receipt id, an
  oversized answer and a redirect after the send started each end UNKNOWN with exactly one transport call; the caller's abort too.
  CONFIRMED (ledger case 2: seven answers through the service, the abort through the send itself)
- **Never retried.** `sendProviderExchange` makes one upload; the same key replays the record (B1's store, then the durable record), so
  the transport count stays one. CONFIRMED (ledger cases 2, 5)
- **Never resent behind a person's back.** An attempt left `sent` (a crash, or an answer that could not be recorded) blocks its package
  to its provider: after a restart a fresh preview and a fresh key answer `PX_EXCHANGE_IN_FLIGHT` naming it, and its own plan and key
  answer it too; nothing is sent. Only a person, reconciling with the provider, ends it - no reconciliation read is built (OD-167), so
  until one is, the block stands (section 13). A settled UNKNOWN does not block: its answer told the person to reconcile, and starting
  again is that person's new preview and commit. CONFIRMED (ledger case 16) [B23-B2 lead, 2026-10-04] Across a registry or descriptor revision too (low-3, ledger case 27). A `prepared` attempt, which handed nothing over, no longer blocks forever: the next attempt of its package settles it `not_sent` (`abandoned`) once it is ten minutes old (low-2, ledger cases 25, 26). CONFIRMED
- **Never the outbox.** The record writes no outbox event, so no `DurableOutboxDispatcher` run - including the re-claim of a
  `processing` event whose lease expired (`app/lib/durable-workflow/repository.ts:36`; `server-repository.ts:32`) - can ever run a
  send: dispatching and claiming at the commit instant, 30 seconds later and a week later claim nothing, with handlers that would send
  registered. CONFIRMED (ledger cases 2, 9; PGlite case 2 on PostgreSQL's claim path)
- **Structurally.** No outbox module reaches the send: the outbox dispatcher, the effects runtime, the runtime and every production module
  naming the dispatcher, an effect handler or an `*OutboxHandlers` export reach neither `provider-egress.ts` nor the record, and every
  `.commit({...})` in the record carries an empty `outbox` literal. CONFIRMED (import-gate case 4; case 6 bites on an injected handler
  and an injected outbox effect)

## 6. Concurrency on PostgreSQL (discovery section 8 item 10)

`b23-b-exchange-ledger-pglite` runs the record over the PostgreSQL durable-workflow repository against a migrated in-process PostgreSQL
(PGlite): two concurrent exchanges of one attempt send once (one prepared, the other replayed); two attempts of two packages on one
aggregate are both recorded and each sent once (revision 6, the revision check retried for the second); two concurrent exchanges of ONE
package under two keys send once (the other refused in flight); a key used on one board names no new attempt on another; a later
duplicate replays; the outbox table stays empty and the expired-lease claim finds nothing; what the records and replays tables hold
carries no raw answer and no file or archive byte, and every record re-verifies. CONFIRMED (4 cases) [B23-B2 lead, 2026-10-04] Case 5: PostgreSQL's jsonb refuses a lone UTF-16 surrogate (22P02), and the exchange drops such a provider field at normalisation, so the settle lands; case 1's helper names its two packages by package digest too (section 10). CONFIRMED (5 cases)

Stated limit: PGlite is one connection and runs one transaction at a time, so the cases prove the replay and revision paths, not two
interleaved server transactions; the in-memory ledger case 6 adds both orders and case 19 the unique-index refusal (`23505`) a concurrent
first append meets on a server. The isolation level of a production server stays **UNKNOWN**: item 10 is narrowed, not closed. RECORDED

CI: the suite starts PostgreSQL, so it lives outside the B23 test folder (`app/lib/manufacturing-providers/database/__tests__/`; the
folder `app/lib/manufacturing-providers/__tests__` is a prompt-to-gerber directory filter, and the job-scope guard refuses a PGlite suite
there) and is an explicit database-delivery entry (`.github/workflows/deterministic-manufacturing.yml:486`; [PR-L7, 2026-10-20] was `:415` before PR-L7's 71 prompt-to-gerber lines at `:313-381` and `:440-441` (OD-254); [PR-G, 2026-10-17] was `:376` before PR-G's 39 prompt-to-gerber lines at `:294-312`, `:316` and `:352-370` (OD-250); [B24-D1, 2026-10-09] was `:373` before B24-D1's OD-30 steps at `:32` and `:344-345`; [B24-D0, 2026-10-09] was `:335` before B24-D0's 38 prompt-to-gerber `--exclude` lines at `:293-330`; [B24-B3, 2026-10-08] was `:334` before B24-B3's prompt-to-gerber entry at `:292`; [B24-A1, 2026-10-06] was `:301` before B24-A1's filter line after `:227`; [B24-B2, 2026-10-08] was `:302` before B24-B2's 32 prompt-to-gerber entries at `:260-291`), the B19-E E6 precedent.
The guard (`b19-e-ci-job-scope`, its `b23-` case) admits it; DB-backed tests stay opt-in (the database-delivery run: 16 files passed, 3
skipped). CONFIRMED

## 7. Who reaches the send, and the route's closure

`b23-b-egress-import-gate` pins, over the runtime import graph: `provider-egress.ts` has one production importer, the exchange service;
`outboundUpload` is named in production only by its definition and `provider-egress.ts`; the record is imported by the exchange service
and the route that composes it; the exchange service only by the route; the agent loop, the gateway, the chat route, the orchestration
runtime, the MCP route, its read runtime and dispatcher, and every production module under `app/lib/agent/`, `app/lib/mcp/`,
`app/api/chat/` and `app/api/mcp/` reach none of the three; the route reaches the egress boundary only through `provider-egress.ts`
(with it bridged, nowhere); `provider-egress.ts` imports exactly six reviewed modules. Case 6 shows each rule bite. CONFIRMED [B23-B3, 2026-10-04] Since B23-B3 the record is also imported by GET /api/pcb-sync's route, which composes it for the observation reader's read (`load` only; `b23-b-egress-import-gate` case 1 moved in place, section 23).

The route's closure therefore now reaches the boundary. Its classification row stays `outboundEgress: files`, declared by the transfer
row (OD-182 (a)), and its closure-derived census value moved, by review, from `none` to `observation-query` (`b23-a-route-vocabulary` case
4), with the same line now pinning that around `provider-egress.ts` the route reaches the boundary nowhere: a query sent around the send
still cannot hide behind `files`. The transport census (case 8) is unchanged: the boundary keeps one connection site. Twelve route files
now reach the boundary (A2's page counted eleven; its line carries a dated note). CONFIRMED

**The durable-access row** (`route-resource-classification.ts:99`) stays `read`, and the B16.0.2 CSV did not move: the commit composes the
exchange record, but the record writes only past a reviewed transfer descriptor, and none exists. Ledger case 21 pins that rule: with
any reviewed descriptor the row must say `read-write`, so the revision that adds the first descriptor moves the row (regenerating the
B16.0.2 CSV) or fails; the row's comment carries a dated note. CONFIRMED

## 8. Production today

The route composes the durable record and the real egress, and the service's default transfer table is the empty production one. A
commit therefore re-runs steps 1 and 2 on a consumed plan and asks admission, which refuses every `dfm_quote_transfer`
(`provider_not_admitted`, `provider-exchange.ts:346`): nothing is recorded and no byte leaves. Were admission forged, `send` would answer
`PX_SEND_UNAVAILABLE`: no reviewed descriptor exists, and none can validate against a registry whose rows list no host, no upload limit
and no idempotency fact. CONFIRMED (ledger case 10: the reviewed admission, a forged one without a descriptor, and one without the
record each send nothing and write nothing)

**Live: BLOCKED-LIVE-QUALIFICATION (LB-11).** A live exchange needs, from the owner, an approved provider account and a staging path,
approval of the exact outbound files (OD-160), a reviewed registry revision recording the host, upload limit and idempotency fact, and a
reviewed transfer descriptor; then admission. Section 1.2's provider facts stay RECORDED (2026-10-01) and were not re-read.

**Reconciliation is recorded, not built** (OD-167): each record says whether its descriptor declares a human-initiated status read
(`statusRead`); neither module exports a reconciliation or status-read operation. RECORDED (ledger case 12)

## 9. Test-first record

- **Red first** (`b2-01-red.log`, the five new suites with no production edit): 5 files failed; four failed to load
  (`Cannot find module '../provider-egress'`), and the import gate failed 5 of its 6 cases (its case 2 passed: no agent module reaches a
  module that did not exist). CONFIRMED
- **First code** (`b2-02-first-code.log`): 35 / 37. Two expectations of the suites themselves were wrong and were corrected: ledger case
  2 ran seven ambiguous answers through one process-wide meter, and the third failure opened the breaker, so the fourth was correctly
  paused (the case now resets the meters per answer); case 5's "restart" used the same fake nonce sequence and clock, so it sealed the
  SAME plan id - a restart production cannot make; the review round replaced it with a real one (section 15). Then 37 / 37
  (`b2-03-green.log`). CONFIRMED
- **The suites bite** (`b2-16-mutation-*.log`, `b2-17-*.log`): seven source mutations, each applied by exact text and the file restored
  and checked (the tree's digest equal before and after):

| mutation | caught by |
|---|---|
| the request-byte ceiling deleted | bounded-upload case 2, ledger case 4 |
| `Idempotency-Key` sent whatever the descriptor says | bounded-upload case 4, ledger case 13 |
| a 5xx classified rejected | ledger case 2, meter case 6, PGlite case 2 |
| every append reported written (a replay too) | PGlite case 1; since `b2-17`, ledger case 6 in memory |
| the prepare's replay check skipped | ledger case 9 |
| the agent admitted | meter case 4 |
| a replayed attempt sent on | ledger cases 5 and 9 (the `sent` mark refuses it: nothing was handed over) |

The review round's own red runs and its twenty-five breakages are section 15.

## 10. Every pin moved, and why

| pin | moved how | why |
|---|---|---|
| `b23-a-route-vocabulary.test.ts:692` (case 4) | in place, dated: `reached: false, derived: "none"` -> `reached: true, derived: "observation-query"`, plus, on the same line, the route bridged at `provider-egress.ts` reaches no boundary; `:497`'s comment noted | the route's closure reaches the boundary through the one sending module |
| `b23-b-exchange-route.test.ts` case 4 | in place, dated: the added modules gain `admission-control.ts`, `exchange-ledger.ts`, `provider-egress.ts` and `outbound-fetch.ts`; the boundary leaves the forbidden list and is pinned reachable only through `provider-egress.ts`; the no-primitive check exempts the boundary (whose one site the transport census reviews); retitled with a dated note | the same |
| `b23-b-approval-plan.test.ts` case 9 | title only, a dated note: the send exists, no reviewed descriptor does | its "(there is no send)" became stale; the assertions are unchanged |
| `artifacts/ai-control-plane-b21/evaluation-matrix.md` C49, C93, C94 | re-pinned +1 in place (333, 336, 345), each with a dated note | the database-delivery entry at `:301` shifts the browser job's lines |
| [B23-B2 review] `b23-b-exchange-ledger` cases 1, 5, 7, 8, 9, 13 and the case 6 helper (B2's own suite) | case 1 expects the two new record fields and the sentence in `error`; case 5's restart is a real one (the server's random nonce); case 7 pins the exact ids-only record; case 8 gains four replay-only tamperings; case 9's title says what it writes; case 13's header pin moved in place, dated (was the client key), to the derived key; the case 6 helper sends the derived key | regressions-4, tests-3, coverage-6, tests-5, security-2 |
| [B23-B2 review] `b23-b-bounded-upload` case 5, `b23-b-exchange-ledger-pglite` case 1 and its helper (B2's own suites) | case 5 iterates 300, 304, 305 and 306 too; PGlite case 1's two attempts name two packages (two of one package now block each other, case 4), and the helper sends the derived key | coverage-5, coverage-2, security-2 |
| [B23-B2 review] `outbound-disclosure.md:218`, `:270`; `tier3-vocabulary.md:186` | a dated `[B23-B2, 2026-10-04]` note appended on the statement's own line (no line moved) | regressions-2: B1's "no transport" and "exactly six modules" and A2's "eleven route files" stopped holding with B2 |
| [B23-B2 review] `route-resource-classification.ts:98` | a dated note appended to the comment line (the row and the CSV unchanged) | regressions-3 |
| [B23-B2 lead, 2026-10-04] `b23-b-approval-plan.test.ts` case 4 (B1's) | title only, a dated note: its ports hold no exchange record; the assertions are as B1 wrote them | low-1: the production composition reads the record before `PX_PLAN_NOT_FOUND` (ledger case 23) |
| [B23-B2 lead, 2026-10-04] `outbound-disclosure.md:207`, `:402`, `:426` | a dated note on the statement's own line (no line moved) | low-1 |
| [B23-B2 lead, 2026-10-04] `b23-b-exchange-ledger` case 19's `attemptFor` and `b23-b-exchange-ledger-pglite`'s `PLAN` helper (B2's own suites) | in place, dated: two packages name two package digests (they named two request digests only) | low-3: the in-flight check keys on the package; left unmoved, both failed after the fix (`b2low-03`: case 19's second package `in_flight`, PGlite case 1 `[true, false]`) |

No other pin moved. `app/lib/acquisition/admission-control.ts` and `app/lib/net/outbound-fetch.ts` changed only by in-place edits of
existing lines (`:47`, `:50`, `:54`; `:36`, `:230`) and appended blocks, so every line the B19-B23 pages cite holds its content
(`b21-e1-page`, `b21-f-page` and the B21 page suites green). The exchange service's cited lines (B1's section 12: `:39`, `:56`, `:160`,
`:162`, `:198`, `:216`, `:248`, `:315`, `:317`, `:326`, `:346`, `:370`, `:374`) and the route's (`:66`, `:73`) hold theirs: B2 edited
lines in place (`:19`, `:85`, `:309` in the review round) and appended the send after `:394`. CONFIRMED (`b23-b-page` case 3 green) [B23-B2 lead, 2026-10-04] The lead's round edited `provider-exchange.ts:85` in place again (two sentences), and `exchange-ledger.ts` and `provider-egress.ts` only in place and at their ends: every line section 14 cites holds its content (case 3).

## 11. Gates

Every run went through the shared lock, one at a time; every CLI process was stopped after it (leftover count 0 each time). No run
printed `Timeout calling "onTaskUpdate"`.

First round (the implementer's tree):

| gate | result |
|---|---|
| every suite that reads a file B2 changed (93 files), before any edit (`b2-00`) | 93 files (92 passed, 1 skipped); 1152 passed, 2 skipped; exit 0 |
| the same after, with `app/lib/manufacturing-providers` (`b2-08`) | 101 files (100 passed, 1 skipped); 1293 passed, 2 skipped; exit 0 |
| the five new suites (`b2-03`, then `b2-17` for the ledger) | 37 / 37; exit 0 |
| tsc; eslint on 15 files; every generator (21) | exit 0 each; no drift |

The review round (`b2fix-*` logs):

| gate | result |
|---|---|
| the readers, before any edit: `app/lib/manufacturing-providers`, `app/lib/net`, both closeout suites, `b21-f-page`, the CI job-scope guard, `b16-0-2-gates`, `b16-0-3-effective-classification` (`b2fix-00`) | 27 files; 396 / 396; exit 0 |
| the strengthened B2 suites on the unfixed source (`b2fix-01`, red) | 15 failed / 33 passed of 48; exit 1 |
| the same after the fixes (`b2fix-02`, then `b2fix-02b` with case 22 split out) | 48 / 48, then 49 / 49; exit 0 |
| twenty-five source breakages, each restored and checked by SHA-256 (`b2fix-03`) | each caught (exit 1); the tree equal after every one |
| the page suite on the unrewritten page (`b2fix-04`, red) | 3 failed / 2 passed of 5; exit 1 |
| `app/lib/net`, `app/lib/distributors`, `app/lib/schgen`, `app/lib/acquisition/__tests__`, `app/lib/durable-workflow` (`b2fix-05`) | 39 files (37 passed, 2 skipped); 443 passed, 4 skipped; exit 0 |
| the database-delivery job's suites, the PGlite suite included (`b2fix-06`) | 19 files (16 passed, 3 skipped); 139 passed, 12 skipped; exit 0 |
| `app/lib/auth/__tests__`, `app/api/__tests__`, `app/lib/computation/__tests__`, `app/api/components/__tests__`, `app/api/parts/__tests__` (`b2fix-07`; the census 166 / 163 / 3 / 0, the B22 process census) | 100 files (98 passed, 2 skipped); 1930 passed, 27 skipped; exit 0 |
| `app/lib/agent/__tests__` (B11.5 case 12), `app/lib/agent/orchestration/__tests__`, `app/api/chat/__tests__` (`b2fix-08`) | 107 files; 1024 / 1024; exit 0 |
| `app/lib/mcp` (counts 47 / 36 / 9 / 27, `b20-b4-process-gate`), `app/lib/project/__tests__` (`b14-4-ast-import-gates`), `app/api/mcp/__tests__` (`b2fix-09`) | 89 files; 1214 / 1214; exit 0 |
| `app/lib/engineering/__tests__` (B17-A, the B19-E tripwire, the tiers) (`b2fix-10`) | 99 files; 1107 / 1107; exit 0 |
| tsc (`--noEmit -p tsconfig.json`, `b2fix-11`) | exit 0, no output |
| eslint on the 17 changed or added `.ts` files (`b2fix-12`) | exit 0, no output |
| every generator (21; `b2fix-13`) | each exit 0; no drift |
| the readers again on the final tree: `app/lib/manufacturing-providers` (the PGlite suite and the page suite included), `app/lib/net`, both closeout suites, `b21-f-page`, the CI job-scope guard, `b16-0-2-gates`, `b16-0-3-effective-classification` (`b2fix-15`) | 28 files; 413 / 413; exit 0 (before: 27 files, 396) |
| the page suites over this page after its last edit: `b23-b-dfm-quote-flow-page`, `b23-b-page`, both closeout suites, `b21-f-page` (`b2fix-16`) | 5 files; 48 / 48; exit 0 |

[B23-B2 lead, 2026-10-04] The lead's round on the independent check's three low findings (`b2low-*` logs) is section 16.

## 12. OD-184 - B23-B2's choices beyond its task text

(a) An attempt the egress boundary refuses before any byte leaves ends `not_sent`, a terminal state beside OD-167's three: a refusal
before the hand-over is neither the provider's rejection nor an unknown, and the record says nothing left. It is reached from `prepared`,
or from a `sent` mark that landed while nothing was handed over (the deadline fell during the mark), which keeps the mark's time and digest.
(b) `sent` is written immediately BEFORE the hand-over, inside the one deadline: the mark races the deadline and the caller's abort, and
a mark slower than the deadline ends the exchange `not_sent` (`timeout`) with nothing handed over; the request then waits for the mark to
land before recording the outcome (the provider is never contacted late). A sender hands bytes over only after its own `prepared` and
`sent` appends wrote new records; a crash after `sent` leaves a record to reconcile, never a silent resend.
(c) B1's in-memory key store stays the first answer within a process. The durable record is the outcome of record and the backstop across
processes and restarts: its key namespace is the project scope (tenant, project, branch), B1's, so a key names at most one attempt per
project, durably; a commit whose plan the instance does not hold is answered from the record under its key (the same plan id and digest
replay, another plan's are a reuse, an unknown key is `PX_PLAN_NOT_FOUND`); a fresh plan under a held key is refused after its plan is
consumed.
(d) The transfer contract is a separate, typed `ProviderTransferDescriptor` beside the registry row, valid only against the row's current
version and digest, an enabled board-file transfer operation, a listed host and RECORDED upload-limit and idempotency facts; the
registry (and its byte-gated CSV) did not change; none exists in B23.
(e) The upload is multipart form data: each outbound file under its release path (field `files`) and the provider manifest (field
`manifest`), a boundary derived from the package digest; a provider-specific encoding (PCBWay's base64 `DataZipFile`, an S3-signed
upload) is a later reviewed descriptor field, not B2's.
(f) The meter: one per provider, a minute and a day window and a breaker from the descriptor; the agent refused outright (share 0); a
rejection other than 429 neutral, an abort inconclusive, a refusal before the hand-over (a pause, the mark's deadline or failure)
inconclusive; no coalescing.
(g) A 2xx answer is acknowledged only as JSON (a media type holding a control character is no usable type) with a receipt id of 1 to 128
of `[A-Za-z0-9._:-]`; a 4xx is rejected; everything else after the send started is UNKNOWN; every 3xx answer to an upload, the ones no
redirect follows included, is refused and UNKNOWN (a 303 after a POST may mean the provider took it).
(h) A commit's answer stays B1's envelope, with seven new codes (section 4), every sentence in `error` (the panel's field); showing a
receipt id in the panel is a UI change for the increment that admits a provider. The route's code did not change beyond composing the
record.
(i) The PGlite suite lives at `app/lib/manufacturing-providers/database/__tests__/`, outside the prompt-to-gerber filter, with an
explicit database-delivery entry.
(j) Reconciliation: recorded (`statusRead` on the descriptor and the record), not built. RECORDED
(k) Under `ids_digests_timestamps_only` a record keeps no provider-chosen text: no normalized field and an empty media type; it keeps
Sirkit's own classification (state, failure code) and the answer's protocol status, size and SHA-256.
(l) The provider sees `Idempotency-Key: sx-<64 hex>`, a digest of the scope, board, provider, plan and client key, recorded on the
attempt and re-derived on load; never the client's string.
(m) One package in flight: a new attempt is refused while another attempt of the same request is `prepared` or `sent` in its aggregate;
only a person reconciling with the provider ends an interrupted one (no reconciliation read exists: the block stands until one does). [B23-B2 lead, 2026-10-04] low-3: the same request is now the same package digest, provider and operation; low-2: a `prepared` attempt ten minutes old is settled `not_sent` (`abandoned`) by the next attempt of its package, and a `sent` mark lands only while its own attempt is still `prepared`, so only a `sent` one waits for a person.
(n) An answer that cannot be recorded: the settle is tried three times; then the commit answers with `recorded: false`, the observed
state, the receipt id and the response's status, size and digest, and the record stays `sent`. [B23-B2 lead, 2026-10-04] low-2: or `prepared`, for a `not_sent` outcome, and that answer's sentence no longer says the exchange was recorded.
(o) The provider exchange route's B16.0.2 durable-access row stays `read` while no reviewed transfer descriptor exists; the revision that
adds the first one moves it to `read-write` and regenerates the CSV (ledger case 21 fails until it does).
(p) [B23-B2 lead, 2026-10-04] low-1: the commit's durable read (tests-3's `recorded`) stays before `PX_PLAN_NOT_FOUND`: the restart's replay needs it, and a
store that cannot be read answers the release route's `MFG_DURABLE_STORE_UNAVAILABLE` 503 rather than a not-found the store could
contradict. B1's statements carry dated notes instead (the smaller truthful change); restoring B1's order is a breakage ledger case 23
catches.
(q) [B23-B2 lead, 2026-10-04] low-2: `EXCHANGE_PREPARED_ABANDON_MS` is ten minutes, five times the longest deadline a reviewed descriptor may declare (120 s).
The bound decides only when a stalled `prepared` attempt stops blocking, never whether two attempts send: the abandonment and the `sent`
mark each require the attempt still `prepared` on the head their compare-and-set commits on.
(r) [B23-B2 lead, 2026-10-04] low-2: text the record keeps refuses a lone UTF-16 surrogate, and the egress drops a provider field holding one; a NUL was
already refused (a code below 32). These are the two kinds of string PostgreSQL's jsonb refuses in a JSON string (INFERRED from its
JSON input rules; the surrogate CONFIRMED on PGlite, case 5).

## 13. What stays open

- **Live exchange: BLOCKED-LIVE-QUALIFICATION (LB-11)**, as section 8 says. RECORDED
- **The isolation level of a production PostgreSQL** under two interleaved commits: UNKNOWN (section 6).
- **Reconciliation** of an UNKNOWN or interrupted exchange is a person's, with the provider; no read is built. An interrupted attempt
  (`prepared` or `sent`, never settled) therefore blocks its package to its provider until a later reviewed reconciliation settles it.
  RECORDED [B23-B2 lead, 2026-10-04] Only a `sent` one now: a `prepared` one is abandoned ten minutes after it was prepared (section 16). One residual: when a `sent` mark slower than the deadline lands (nothing handed over) and its `not_sent` settle cannot be written, the attempt stays `sent` and blocks its package until a person reconciles it, though the provider holds nothing. INFERRED
- **The abandonment bound reads two instances' clocks** ([B23-B2 lead, 2026-10-04]): a clock skewed by ten minutes can abandon a live `prepared` attempt
  early; its `sent` mark is then refused and it answers not sent, never a second send (ledger case 26 holds the race). INFERRED for the
  skew
- **The request waits for a slow durable write.** The deadline bounds the exchange with the provider, the `sent` mark included; after it
  the commit still waits for the mark (and the settle) to land in the store, as it waits for `prepare`. A store that never answers holds
  the request; the provider is never contacted late. INFERRED
- **The rebinding window** stays OD-51's recorded limit. RECORDED
- **The meters are per process** (the limit `admission-control.ts` states): several instances together can spend more than one window.
  INFERRED
- **A record per (scope, board, provider) grows** with each attempt (three records each); `prepare` reads it whole when the aggregate
  has a head (the in-flight check), and `load` and `history` read it whole. No bound is set (each attempt is a human administrator's
  approved commit). RECORDED [B23-B2 lead, 2026-10-04] Since the lead round the `sent` mark also reads and re-verifies the aggregate's whole history on every compare-and-set try (`stillPrepared`, `exchange-ledger.ts:514-516`), inside the descriptor's one deadline, so a long-lived board and provider pair with a short deadline will miss the deadline more often; such an exchange ends not sent. A bound on the history the mark reads is the reviewed descriptor's increment (no descriptor exists in B23). INFERRED
- **The browser suite was not run**: B2 changed no UI. RECORDED

## 14. Citations

As of this working tree on `0c78e93` after the review round (2026-10-04); the anchor text is the check, the line is for the reader;
`b23-b-dfm-quote-flow-page` case 3 checks every row. [B23-B2 lead, 2026-10-04] C65-C72 were added by the lead's round. [B24-A1, 2026-10-06] C64 re-pinned `:301` -> `:302` in place: B24-A1 inserted its filter line after `:227` (OD-222). [B24-D0, 2026-10-09] C64 re-pinned `:335` -> `:373` in place: B24-D0 inserted 38 prompt-to-gerber `--exclude` lines at `:293-330` (OD-30's split; the moves of B24-B2 and B24-B3 between are noted on the prose citation's line). [B24-D1, 2026-10-09] C64 re-pinned `:373` -> `:376` in place: B24-D1's OD-30 steps at `:32` and `:344-345`. [PR-G, 2026-10-17] C64 re-pinned `:376` -> `:415` in place: PR-G's 39 prompt-to-gerber lines at `:294-312`, `:316` and `:352-370` (OD-250). [B24-B2, 2026-10-08] C64 re-pinned `:302` -> `:334` in place: B24-B2 inserted 32 prompt-to-gerber entries at `:260-291` (OD-204). [B24-B3, 2026-10-08] C64 re-pinned `:334` -> `:335` in place: B24-B3 inserted one prompt-to-gerber entry at `:292` (`worker-integration`, OD-222). [PR-L7, 2026-10-20] C64 re-pinned `:415` -> `:486` in place: PR-L7's 71 prompt-to-gerber lines at `:313-381` and `:440-441` (OD-254).

| # | file | line | anchor |
|---|---|---|---|
| C1 | `app/lib/net/outbound-fetch.ts` | 230 | `const transport: typeof fetch = deps.fetch ?? defaultTransport;` |
| C2 | `app/lib/net/outbound-fetch.ts` | 370 | `export const OUTBOUND_UPLOAD_MAX_BYTES = 64 * 1024 * 1024;` |
| C3 | `app/lib/net/outbound-fetch.ts` | 441 | `export function encodeOutboundUpload(` |
| C4 | `app/lib/net/outbound-fetch.ts` | 467 | `if (size > upload.maxRequestBytes) return tooLarge(size);` |
| C5 | `app/lib/net/outbound-fetch.ts` | 487 | `export async function outboundUpload(` |
| C6 | `app/lib/net/outbound-fetch.ts` | 488 | `if (policy.maxRedirects !== 0) return uploadRefused(` |
| C7 | `app/lib/net/outbound-fetch.ts` | 496 | `if (url.href.includes("?") \|\| url.href.includes("#"))` |
| C8 | `app/lib/net/outbound-fetch.ts` | 504 | `headers[OUTBOUND_IDEMPOTENCY_HEADER] = request.idempotencyKey;` |
| C9 | `app/lib/net/outbound-fetch.ts` | 522 | `await untilAborted(deps.beforeSend(` |
| C10 | `app/lib/net/outbound-fetch.ts` | 530 | `sendStarted = true;` |
| C11 | `app/lib/net/outbound-fetch.ts` | 535 | `code: "before_send_failed", message:` |
| C12 | `app/lib/net/outbound-fetch.ts` | 536 | `code: "redirect_refused", message:` |
| C13 | `app/lib/net/outbound-fetch.ts` | 538 | `if (result.ok && result.status >= 300 && result.status <= 399)` |
| C14 | `app/lib/net/outbound-fetch.ts` | 543 | `function untilAborted<T>(` |
| C15 | `app/lib/net/outbound-fetch.ts` | 557 | `function defaultTransport(` |
| C16 | `app/lib/acquisition/admission-control.ts` | 50 | `\| { kind: "manufacturing-provider"; providerId: string }` |
| C17 | `app/lib/acquisition/admission-control.ts` | 54 | `if (key.kind === "manufacturing-provider") return` |
| C18 | `app/lib/acquisition/admission-control.ts` | 486 | `export const MANUFACTURING_PROVIDER_AGENT_SHARE = 0;` |
| C19 | `app/lib/acquisition/admission-control.ts` | 507 | `export function requestManufacturingProviderAdmission(` |
| C20 | `app/lib/acquisition/admission-control.ts` | 508 | `if (purpose !== "interactive") return { allowed: false` |
| C21 | `app/lib/manufacturing-providers/provider-egress.ts` | 69 | `export const PROVIDER_TRANSFER_DESCRIPTORS` |
| C22 | `app/lib/manufacturing-providers/provider-egress.ts` | 82 | `export function validateTransferDescriptor(` |
| C23 | `app/lib/manufacturing-providers/provider-egress.ts` | 129 | `export function transferDescriptorFor(` |
| C24 | `app/lib/manufacturing-providers/provider-egress.ts` | 193 | `export async function sendProviderExchange(` |
| C25 | `app/lib/manufacturing-providers/provider-egress.ts` | 205 | `const admission = requestManufacturingProviderAdmission(` |
| C26 | `app/lib/manufacturing-providers/provider-egress.ts` | 223 | `function classify(` |
| C27 | `app/lib/manufacturing-providers/provider-egress.ts` | 226 | `result.code === "before_send_failed" ? "record_unavailable"` |
| C28 | `app/lib/manufacturing-providers/provider-egress.ts` | 230 | `const contentType = printable(result.contentType) ? result.contentType.slice(0, 128) : "";` |
| C29 | `app/lib/manufacturing-providers/provider-egress.ts` | 256 | `function meterOutcome(` |
| C30 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 43 | `export const PROVIDER_EXCHANGE_AGGREGATE_TYPE = "mfg.provider-exchange.v1" as const;` |
| C31 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 143 | `export function exchangeAttemptInput(` |
| C32 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 173 | `export function providerIdempotencyKeyOf(` |
| C33 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 212 | `export function validateExchangeAttempt(` |
| C34 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 243 | `function stateConsistent(` |
| C35 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 270 | `export function exchangeScopeKey(` |
| C36 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 293 | `function verified(` |
| C37 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 331 | `async function keyedAttempt(` |
| C38 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 339 | `if (!stored \|\| stored.recordDigest !== replayed.recordDigest)` |
| C39 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 360 | `async function append(` |
| C40 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 376 | `outbox: [], // silent: no effect, ever` |
| C41 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 416 | `if (existing) return replay(existing);` |
| C42 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 422 | `if (open) throw new OpenAttemptRefusal(open);` |
| C43 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 444 | `if (!(await append(input.aggregate, "sent", next, input.at)).written)` |
| C44 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 455 | `outcome.state === "not_sent" ? ["prepared", "sent"] : ["sent"]` |
| C45 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 459 | `const response = outcome.response === null \|\| kept ? outcome.response : { ...outcome.response, contentType: "" };` |
| C46 | `app/lib/manufacturing-providers/provider-exchange.ts` | 309 | `if (!stored \|\| !sameScope(stored.owner, input.scope)) return this.recorded(` |
| C47 | `app/lib/manufacturing-providers/provider-exchange.ts` | 346 | `if (!admission.admitted) return refusalBody("PX_PROVIDER_NOT_ADMITTED",` |
| C48 | `app/lib/manufacturing-providers/provider-exchange.ts` | 348 | `return this.send(plan, prepared.package, ports, correlationId, commit);` |
| C49 | `app/lib/manufacturing-providers/provider-exchange.ts` | 402 | `private async send(` |
| C50 | `app/lib/manufacturing-providers/provider-exchange.ts` | 411 | `if (!begun.ok && begun.code === "in_flight") return refusalBody("PX_EXCHANGE_IN_FLIGHT"` |
| C51 | `app/lib/manufacturing-providers/provider-exchange.ts` | 413 | `if (begun.replayed) return exchangeEnvelope(` |
| C52 | `app/lib/manufacturing-providers/provider-exchange.ts` | 416 | `idempotencyKey: begun.attempt.providerIdempotencyKey` |
| C53 | `app/lib/manufacturing-providers/provider-exchange.ts` | 419 | `if (marking.pending !== null && !outcome.sendStarted) await marking.pending.catch(` |
| C54 | `app/lib/manufacturing-providers/provider-exchange.ts` | 421 | `for (let tries = 0; tries < PROVIDER_EXCHANGE_SETTLE_ATTEMPTS; tries += 1) {` |
| C55 | `app/lib/manufacturing-providers/provider-exchange.ts` | 440 | `private async recorded(` |
| C56 | `app/lib/manufacturing-providers/provider-exchange.ts` | 456 | `export const PROVIDER_EXCHANGE_SETTLE_ATTEMPTS = 3;` |
| C57 | `app/lib/manufacturing-providers/provider-exchange.ts` | 461 | `function exchangeEnvelope(` |
| C58 | `app/lib/manufacturing-providers/provider-exchange.ts` | 471 | `body: { ok: acknowledged, code, error: entry.message,` |
| C59 | `app/api/pcb/provider-exchange/route.ts` | 62 | `exchangeLedger: createProviderExchangeLedger(workflow)` |
| C60 | `app/lib/auth/route-resource-classification.ts` | 99 | `"/api/pcb/provider-exchange": { durable: "read"` |
| C61 | `app/lib/pcb/fab/validate-package.ts` | 14 | `const MAX_FILES = 64;` |
| C62 | `app/lib/durable-workflow/repository.ts` | 36 | `async claimOutbox(` |
| C63 | `app/lib/durable-workflow/server-repository.ts` | 32 | `async claimOutbox(` |
| C64 | `.github/workflows/deterministic-manufacturing.yml` | 486 | `app/lib/manufacturing-providers/database/__tests__/b23-b-exchange-ledger-pglite.test.ts` |
| C65 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 195 | `\|\| hasLoneSurrogate(value)) return false;` |
| C66 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 367 | `if (head && phase === "sent") await stillPrepared(historyOf, aggregate, attempt.idempotencyKey);` |
| C67 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 421 | `samePackage(other, attempt) && (other.state === "prepared" \|\| other.state === "sent")` |
| C68 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 426 | `await abandonStale({ append, history: historyOf }, input.aggregate, attempt, input.at);` |
| C69 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 496 | `export const EXCHANGE_PREPARED_ABANDON_MS = 10 * 60_000;` |
| C70 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 532 | `async function abandonStale(` |
| C71 | `app/lib/manufacturing-providers/provider-egress.ts` | 189 | `return !hasLoneSurrogate(value);` |
| C72 | `app/lib/manufacturing-providers/provider-exchange.ts` | 85 | `PX_EXCHANGE_NOT_SENT: { status: 503, message: "The exchange stopped before any byte left Sirkit.` |

## 15. The adversarial review of the first B2 tree, and what it changed

An adversarial review confirmed twenty-two findings on the first B2 tree. Each was reproduced first: by a new or strengthened case that
failed on the unfixed source (`b2fix-01`: 15 failed / 33 passed of 48; `b2fix-04`: the page suite, 3 failed / 2 passed), or, where the
case already passed (a test-strength finding), by a deliberate breakage of the source that the strengthened case catches. Every fix was
then re-run, and each fix was also reverted once by a breakage its new case catches (`b2fix-03`: twenty-five breakages, each caught,
each restored and checked by SHA-256). CONFIRMED

| finding | reproduced by | observed before the fix | fix | after |
|---|---|---|---|---|
| regressions-1, tests-1 (medium): the `sent` mark not bounded by the deadline; a late mark made a false UNKNOWN | bounded-upload case 10; ledger case 14 | a never-settling mark held the upload past 3 s (`'unbounded'`); a 400 ms mark under a 100 ms deadline ended 502 UNKNOWN with one transport call | the mark races the deadline (`:522`), re-check (`:529`); the service waits for the mark before recording; `sent -> not_sent` (`:455`) | green; reverting the race fails both cases, reverting the wait fails case 14 |
| regressions-2 (low): B1 and A2 statements left CONFIRMED and false | page case 4 | (the notes were written before the case; reverting them fails it) | dated `[B23-B2, 2026-10-04]` notes on `outbound-disclosure.md:218`, `:270`, `tier3-vocabulary.md:186` | green |
| regressions-3 (low): the route's durable row says `read` though the commit composes a writer | ledger case 21 | a test-strength pin: one reviewed descriptor and the row still `read` fails it | the rule pinned; the row stays `read` while no descriptor exists (OD-184 (o)); a dated comment note | green; a descriptor added to the production table fails cases 10 and 21 |
| regressions-4 (low): the acknowledged envelope put its sentence in `message` | ledger case 1 | `body.error` undefined | every code's sentence in `error` (`:471`) | green; reverting fails case 1 |
| security-2, coverage-3 (low): the raw client key sent as Idempotency-Key | ledger cases 13, 17 | the header was `key-exact` / `shared-client-key` | `providerIdempotencyKeyOf` (`exchange-ledger.ts:173`), recorded and re-derived on load | green; sending the client key fails cases 1, 13, 17 |
| coverage-1 (medium): a failed settle dropped the receipt | ledger case 15 | the 502 body had no receipt, no response digest | three settle attempts (`:421`); the unrecorded answer carries `observed`, the receipt and the response digest; a control character in the media type is kept empty (`provider-egress.ts:230`) | green; each part reverted fails case 15 |
| coverage-2 (medium): after a crash a fresh preview resent the package | ledger case 16; PGlite case 4 | a fresh key after the restart was acknowledged (resent); on PostgreSQL both concurrent keys sent | one package in flight (`exchange-ledger.ts:422`), re-checked on every head | green; dropping the check fails both |
| coverage-4 (low): a deadline during the mark ended UNKNOWN; a failed mark recorded `network_error` | bounded-upload case 10; ledger case 14 | the deadline half as regressions-1; the failed-mark assertions come after it in both cases, so the red run stopped before them | `before_send_failed` (`outbound-fetch.ts:535`), recorded `record_unavailable` (`provider-egress.ts:226`) | green; removing `before_send_failed` (the failure is `network_error` again) fails both cases |
| coverage-5 (low): 300, 304, 305, 306 returned `ok` | bounded-upload case 5 | `300: expected { ok: true, status: 300 }` | every 3xx refused (`:538`) | green; reverting fails case 5 |
| coverage-6 (low): ids-only retention kept the provider's media type | ledger case 7 | the exact record differed (`application/json` stored) | stored empty under ids-only, refused otherwise (`exchange-ledger.ts:459`) | green; reverting fails case 7 |
| coverage-7 (low): D23-4 called closed whole | page case 1 | the closure line said "Closes D23-3, D23-4 and D23-5's receipt half" | the exchange half closes; the order-contract half stays B23-C's (OD-172) | green |
| coverage-8 (low): the profile-evidence condition missing | page case 5 | (the header was rewritten with the fix; reverting the phrase fails the case) | the ledger header and section 4 state it; the staleness half is B23-B3's (OD-168) | green |
| coverage-9 (low): B1's suites called unaltered | page case 2 | sections 0, 2 and 4 called B1's suites unaltered while section 10 listed two B1 pins moved | sections 0, 2, 4 say which B1 pins moved | green |
| tests-2 (medium): the unrecorded branch, CONTENDED and an invalid attempt untested | ledger cases 15, 20 | case 15 red as above; case 20 a test-strength pin | as coverage-1 | green; answering the unrecorded branch NOT_SENT fails cases 15 and 16; CONTENDED mapped to SEND_UNAVAILABLE fails case 20 |
| tests-3 (medium): the restart replay was not a restart | ledger case 5 | a real restart answered `PX_PLAN_NOT_FOUND` (404) | `recorded` (`provider-exchange.ts:440`), reached from `:309` | green; reverting fails cases 5 and 16 |
| tests-4 (low): key reuse across boards after a restart not refused | ledger case 22; PGlite case 4 | (split out after the red run; restoring the per-aggregate key namespace fails case 22 at its board assertion, 200 for 409, and PGlite case 4) | the project-scope key namespace (`exchange-ledger.ts:270`) | green |
| tests-5 (low): the replay checks never exercised | ledger case 8 | a test-strength pin: four replay-only tamperings | - | removing the digest comparison, the replay's verification, the phase check or the key check each fails case 8 |
| tests-6 (low): neutral and inconclusive meter outcomes untested | meter case 7 | a test-strength pin | - | counting a 422 or an abort as a failure fails case 7 |
| tests-7 (low): the `sent` mark's written check never exercised | ledger case 18 | a test-strength pin | - | dropping the check fails case 18 (both marks fulfilled) |
| tests-8 (low): the unique-index branch never exercised | ledger case 19 | a test-strength pin | - | dropping the branch fails case 19 (`query failed`) |
| the final tree (`b2fix-15`, `b2fix-16`) | - | - | - | the readers 28 files, 413 / 413; the page suites 48 / 48; every gate of section 11 exit 0 |

## 16. The independent check's three low findings, and what the lead's round changed

[B23-B2 lead, 2026-10-04] An independent check of the review round's fixes confirmed three low findings. Each was reproduced first:
by new or extended cases run on the unfixed source (`b2low-01`: ledger cases 24-28, page case 6 and PGlite case 5 failed, 7 failed /
32 passed of 39, exit 1; `b2low-01b`: case 25 alone, with its sentence check moved last so that its first failure is the block
itself), or, for the order this round keeps, by a production-shaped case that a breakage of the source fails (`b2low-02`, restored and
checked by SHA-256). Then each was fixed and re-run. CONFIRMED

| finding | reproduced by | observed before the fix | fix | after |
|---|---|---|---|---|
| low-1: tests-3's `recorded` reads the record before `PX_PLAN_NOT_FOUND`, which made B1's "before any port" statements false with no dated note; B1's approval-plan case 4 composes no record | page case 6; ledger case 23 (the route's composition, a test-strength pin) | page case 6: `outbound-disclosure.md:207` carried no note. Case 23 passed on the unfixed source (it pins the order the tree has); restoring B1's order fails it (`b2low-02`: 404 `PX_PLAN_NOT_FOUND` where the store is unavailable, for 503 `MFG_DURABLE_STORE_UNAVAILABLE`) | the order kept (OD-184 (p)); dated lead notes on `outbound-disclosure.md:207`, `:402`, `:426` and on B1's approval-plan case 4; section 4 states the order: three replay reads under the key, then 404; one failed read, then 503; nothing read for the in-process refusals | green |
| low-2: a `prepared` attempt that provably sent nothing blocked its package forever, and the unrecorded `PX_EXCHANGE_NOT_SENT` said "The exchange was recorded"; a provider string PostgreSQL refuses could leave a `sent` attempt that can never settle | ledger cases 24, 25, 26, 28; PGlite case 5 | case 24: the sentence began "The exchange was recorded"; case 25: `PX_EXCHANGE_IN_FLIGHT` (409) ten minutes after, for `PX_EXCHANGE_ACKNOWLEDGED`; case 26: the second prepare `in_flight`, for `ok`; case 28: the record kept a `status` holding a lone surrogate; PGlite case 5: PostgreSQL refused the settled record (22P02, "Unicode low surrogate must follow a high surrogate") | `EXCHANGE_PREPARED_ABANDON_MS` and `abandonStale` (`exchange-ledger.ts:496`, `:532`), called before the new attempt's append (`:426`); the `sent` mark's own-state check on every head (`:367`); the two sentences (`provider-exchange.ts:85`); a lone surrogate refused in the record's text (`exchange-ledger.ts:195`) and dropped at normalisation (`provider-egress.ts:189`) | green |
| low-3: the one-package guard keyed on the request digest, which a registry revision moves, so an interrupted package could be resent | ledger case 27 | `PX_EXCHANGE_ACKNOWLEDGED` (200): the same package went to the same provider a second time after a registry and descriptor revision | the guard keys on the package digest, the provider (the aggregate's) and the operation (`exchange-ledger.ts:421`); ledger case 19's and PGlite case 1's helpers name two packages by package digest (section 10) | green |

**The abandonment and why it cannot send twice.** An attempt is `prepared` before anything leaves; a sender hands bytes over only after
its own `sent` append wrote. The next attempt of the same package, provider and operation, once the `prepared` one is ten minutes old,
first settles it `not_sent` with the failure `abandoned` (a compare-and-set append that requires it still `prepared` on its head), then
appends itself (requiring no other attempt of the package `prepared` or `sent` on its head). A `sent` mark is written only while its
own attempt is still `prepared` on the head its append commits on. So of an abandonment and a mark, whichever commits first makes the
other fail: an abandoned attempt never sends, and a marked one is never abandoned (it blocks the new attempt instead). Case 26 holds
both orders, sequentially and with each one's commit held until the other landed. CONFIRMED

**Breakages of the fixed source** (`b2low-05`): twelve, each applied by exact text, run, then the file restored and checked by SHA-256,
the whole tree's digest equal before and after (`b4c304ee...`). Each was caught (exit 1). CONFIRMED

| breakage | caught by |
|---|---|
| the lead note removed from `outbound-disclosure.md:207` | page case 6 |
| the lead note removed from B1's approval-plan case 4 | page case 6 |
| the old `PX_EXCHANGE_NOT_SENT` sentence | ledger case 24 |
| the old `PX_EXCHANGE_IN_FLIGHT` sentence | ledger case 25 |
| no abandonment | ledger cases 25, 26 |
| no own-state check on the `sent` mark | ledger case 26 (a mark held until the abandonment landed is written) |
| no state check in the abandonment's append | ledger case 26 (an abandonment held until the mark landed is written over it) |
| the guard keyed on the request digest again | ledger case 27 |
| the egress keeps a lone surrogate | ledger case 28, PGlite case 5 |
| the record's text accepts a lone surrogate | ledger case 28 |
| the bound five minutes | ledger cases 25, 26 |
| B1's order restored (`provider-exchange.ts:309`) | ledger cases 5, 16, 23, 25 |

**Gates of this round** (every run through the shared lock, one at a time; leftover process count 0 after each):

| gate | result |
|---|---|
| the readers of every file this round changed, before any edit: `app/lib/manufacturing-providers` (the PGlite and page suites included), both closeout suites, `b21-f-page`, the CI job-scope guard, `b16-0-2-gates`, `b16-0-3-effective-classification`, `b16-1c-invariant-tripwires`, `b16-1b-auth-composition`, `b22-a2-process-census` (`b2low-00`) | 28 files; 377 / 377; exit 0 |
| the new and extended cases on the unfixed source (`b2low-01`, red) | 7 failed / 32 passed of 39; exit 1 |
| `app/lib/manufacturing-providers` after the source fixes, before the helper moves and the page notes (`b2low-03`) | 3 failed (page case 6; ledger case 19; PGlite case 1) / 276 passed; exit 1 |
| the same after the moves and notes (`b2low-04`) | 19 files; 279 / 279; exit 0 |
| `app/lib/net`, `app/lib/acquisition/__tests__`, `app/lib/durable-workflow` (`b2low-06`) | 21 files (19 passed, 2 skipped); 290 passed, 4 skipped; exit 0 |
| the database-delivery job's suites, the PGlite suite included (`b2low-07`) | 19 files (16 passed, 3 skipped); 140 passed, 12 skipped; exit 0 |
| `app/lib/auth/__tests__`, `app/api/__tests__/b16-1c-invariant-tripwires.test.ts` (`b2low-08`) | 42 files; 486 passed, 9 skipped; exit 0 |
| tsc (`--noEmit -p tsconfig.json`; `b2low-09` exit 2 on one possibly-undefined read in the new PGlite case, fixed; `b2low-09b`) | exit 0, no output |
| eslint on the eight changed `.ts` files (`b2low-10`) | exit 0, no output |
| every generator (21; `b2low-11`) | each exit 0; no drift |
| the readers again on the final tree, with `b11-5-capture-exactness` (B11.5 case 12: no test writes under the tree) (`b2low-12`) | 29 files; 403 / 403; exit 0 (before: 28 files, 377) |
| the page suites over this page after its last edit: `b23-b-dfm-quote-flow-page`, `b23-b-page`, both closeout suites, `b21-f-page` (`b2low-13`) | 5 files; 49 / 49; exit 0 |

## 17. B23-B3 - steps 6 to 8, and the verdict for all eight steps

[B23-B3, 2026-10-04] Tree: `chapter/b23-external-manufacturing`, base `0cd3f59` (B23-B2), working tree of 2026-10-04. Runbook B23-B steps 6-8
(`:980-982`): "Normalize DFM/quote results as external observations, not Sirkit proof.", "Detect stale quotes and changed release
inputs." and "Never auto-accept substitutions or design changes suggested by a provider."; global `:140`: "Every external observation
must retain source identity, retrieval time, licensing/retention policy, freshness and evidence hashes." B23-B3 closes D23-17 and D23-5's
staleness half. Owner decisions applied: OD-168 and OD-169; B3's own choices beyond its task text are OD-185 (section 24). **Verdict: steps
6-8 are met offline - an acknowledged answer of B2's record is an external observation, judged stale or current at every read, and a
provider's suggestion is shown and never applied. A live answer stays BLOCKED-LIVE-QUALIFICATION (LB-11): no provider is admitted, no
reviewed transfer descriptor exists and Sirkit holds no provider account (OD-160), so no live observation can exist.**

The eight steps of B23-B (runbook `:975-982`), each as the tree holds it:

| step | the runbook's words | what holds it | verdict | live |
|---|---|---|---|---|
| 1 | "Revalidate authority immediately before upload." | `revalidateReleaseAuthority` (`release/route.ts:145`), re-run at preview and again at commit (B23-B1; `outbound-disclosure.md` section 2) | met: CONFIRMED (`b23-b-revalidation`) | nothing leaves in B23 |
| 2 | "Present exactly which files and metadata will leave Sirkit." | `buildOutboundPackage`, the sealed plan and the provider panel (B23-B1; `outbound-disclosure.md` sections 1, 3, 6) | met: CONFIRMED (`b23-b-outbound-package`, `b23-b-approval-plan`, `b23-b-provider-panel`) | nothing leaves in B23 |
| 3 | "Require explicit user approval for the named provider and purpose." | preview and commit: plan id, plan digest, idempotency key and the opt-in header; a human project administrator only (B23-B1; `outbound-disclosure.md` section 4) | met: CONFIRMED (`b23-b-approval-plan`, `b23-b-exchange-route`) | nothing leaves in B23 |
| 4 | "Upload with bounded streaming, timeouts and idempotency." | `outboundUpload` and `provider-egress.ts` (B23-B2; sections 1-3) | met offline against the fake: CONFIRMED (`b23-b-bounded-upload`, `b23-b-provider-meter`) | BLOCKED-LIVE-QUALIFICATION (LB-11) |
| 5 | "Store provider receipt, artifact digest, capability/profile version and timestamp." | `mfg.provider-exchange.v1` (B23-B2; sections 4-6) | met offline: CONFIRMED (`b23-b-exchange-ledger`, `b23-b-exchange-ledger-pglite`) | BLOCKED-LIVE-QUALIFICATION (LB-11) |
| 6 | "Normalize DFM/quote results as external observations, not Sirkit proof." | `provider-observation.ts` and `provider-text-screen.ts` (B23-B3; section 18) | met offline: CONFIRMED (`b23-b-observation`, 9 cases) | BLOCKED-LIVE-QUALIFICATION (LB-11) |
| 7 | "Detect stale quotes and changed release inputs." | `evaluateObservationStaleness`; the summary's current flag compares the board revision AND its authoritative digest (D23-17) (B23-B3; section 19) | met offline: CONFIRMED (`b23-b-stale-quote`, 14 cases; `b16-a-manufacturing-summary`, 2 new cases) | no live answer exists to go stale |
| 8 | "Never auto-accept substitutions or design changes suggested by a provider." | the closed `providerSuggestion` and the import gate (B23-B3; section 20) | met: CONFIRMED (`b23-b-no-auto-accept`, 9 cases) | no live answer exists |

End to end, `b23-b-observation` case 7 runs the exchange service's preview and commit (a forged admitting answer and the fake's transfer
descriptor, the real egress boundary, B2's record) and reads the acknowledged answer back through GET /api/pcb-sync's core as an
observation; steps 1 and 2 are stubbed ports there (B1's own suites run them for real). CONFIRMED

## 18. Step 6: the observation, never Sirkit proof (OD-185)

**The source is B2's record, never a body.** `normalizeManufacturingObservation` (`provider-observation.ts:151`) reads one attempt of
`mfg.provider-exchange.v1` as `load` returns it (every record re-verified on load, B2's section 4); no raw provider body exists to read.
Only an `acknowledged` attempt with its receipt, request and response is an observation: `prepared`, `sent`, `rejected`,
`UNKNOWN_PENDING_RECONCILIATION` and `not_sent` stay exchange states (B2's envelope answers them), and an unknown provider or an
unreadable `retrievedAt` is refused. CONFIRMED (`b23-b-observation` cases 1, 2) [B23-B3 review, 2026-10-04] coverage-2: an unknown provider is no longer refused - a row a reviewed registry revision withdrew still names its recorded answers, listed stale (`descriptor_moved`) under `OBSERVATION_UNLISTED_PROVIDER_NAME` with its terms UNKNOWN (`b23-b-stale-quote` case 12; case 2 moved in place); only an unreadable `retrievedAt` is refused.

**The record** `sirkit.manufacturing-observation.v1`, class `manufacturing_observation`, closed and deep-frozen, keeps what runbook `:140`
asks for:

| `:140` asks for | the observation keeps |
|---|---|
| source identity | `source`: provider id and name, operation, the provider's receipt id, the registry version and row digest and the transfer descriptor's version the exchange ran under [B23-B3 review, 2026-10-04] security-1: the receipt id is null when the screen withheld it |
| retrieval time | `retrievedAt` (the receipt's) |
| licensing/retention policy | `terms`: what Sirkit keeps of the answer (`kept`: `normalized` or `ids_digests_timestamps_only`, the record's retention) and the provider's own terms for what Sirkit sends (`providerRetention`, `providerConfidentiality`, the registry row's, `UNKNOWN` with its reason where nobody read them) [B23-B3 review, 2026-10-04] coverage-6: that was only half of `:140`: the licence under which Sirkit may keep, show or pass on the provider's ANSWER is the terms' `answerLicense`, `UNKNOWN` with its reason (`OBSERVATION_ANSWER_LICENSE`, `provider-observation.ts:69`) while nobody has read any provider's terms for its answers; the registry records only `outboundTerms`, and it is not changed (OD-185 (o)) |
| freshness | `freshness`: `provider_stated` (`validUntil`) or `default_24h`, and `staleAt` |
| evidence hashes | `digests`: the release id, the archive SHA-256, the outbound package digest, the request's and the response's SHA-256; and `capabilityProfile` |

plus `observationId`, `purpose`, the bounded `fields`, the names of the `withheld` fields with their reasons, the `suggestions`
(section 20), the fixed `label` "external observation, not Sirkit proof" (`:38`) and `sirkitVerdict: "none"` (`:195`). CONFIRMED (case 1)

**Provider text is untrusted.** Every kept string passes `screenProviderText` (`provider-text-screen.ts:305`) before it is shown, in
order: at most 256 characters (the record's own bound, `EXCHANGE_LEDGER_BOUNDS.maxNormalizedText`, pinned equal); printable ASCII and
B20-C3's closed typographic set only (pinned equal to `DESCRIPTOR_TEXT_ALLOWED_EXTRA`) - so a control character and a lone UTF-16
surrogate, which B2 already refuses in what its record keeps and drops at the egress, are refused here too, and so is every format,
bidirectional, look-alike or other-script spelling; no secret shape (`app/lib/agent/redaction.ts`, `:19`); and B20's directive matcher.
The strings one observation shows are then read together, across their joins, as B20-A4 reads a result's blocks (`provider-observation.ts:174`):
a directive split across two fields withholds every string field. A string that fails is withheld WHOLE, by its field name and the rule,
never stripped; numbers and booleans are kept. CONFIRMED (case 3: eight hostile fields among eleven, the joined case; [B23-B3 review, 2026-10-04] coverage-7: the first tree called all eleven hostile, but note, price and accepted are the benign controls) [B23-B3 review, 2026-10-04] security-1: the first tree screened the fields only. The provider's receipt id - the one provider-chosen string outside them, read from its answer's id field and admitted by B2's charset `[A-Za-z0-9._:-]` - was shown unscreened to every member. It is now screened like a field (`provider-observation.ts:163`) and read first in the joined reading, as the panel shows it before the fields (`:174`); when it fails, `source.providerReceiptId` is null and `withheld` names `source.providerReceiptId` (`OBSERVATION_RECEIPT_FIELD`; no kept field's name holds a '.') with the rule; the observation id still hashes it, so identity stays whole. CONFIRMED (case 8: a `SYSTEM:` marker, a dotted directive and a key-shaped id are each withheld and shown nowhere, in the GET summary and the list included; a directive split between the receipt id and a field withholds both; a benign id is shown)

**The matcher is B20's, copied verbatim.** `foreign-tools.ts` imports the MCP transport (`foreign-tools.ts:59`), which imports the egress
boundary (`http-transport.ts:47`); importing it would make GET /api/pcb-sync - which sends nothing - derive `observation-query` in the
route census (`b23-a-route-vocabulary` case 4, `QUERY_PATHS`). B20-C3's first-party gate states the same reason for not importing it
(`descriptor-text.ts:25`). So `provider-text-screen.ts` holds a byte-for-byte copy of A2's matcher (the phrase list `:49`, the markers, the
streams, the skeleton, `providerTextReadsAsDirective` `:244`, `providerJoinedTextReadsAsDirective` `:256`), renamed only where a name says
MCP, and `b23-b-observation` case 4 pins it: all 32 copied declarations equal A2's printed without comments under the reviewed renames,
the phrase list equals `MCP_DIRECTIVE_PHRASES`, and a corpus (the phrases spelled four ways, benign provider prose, the markers, non-ASCII
disguises and 1,500 seeded mixes) is judged exactly as A2 judges it, alone and as 400 joined pairs; the screen withholds every corpus
string A2 reads as an instruction. A one-letter change to the copied phrase list fails it. CONFIRMED

**No verdict, no consumer.** A provider's "accepted" or "pass" is a field like any other: `sirkitVerdict` stays `none`, and the summary's
authority, release, viewer, snapshot and integrity are identical with and without the observation (case 5). The workflow machine and its
hook never name an observation (case 5). The release route, the release gate, the authority store, the release ledger, the qualify route,
the workflow machine and hook, CD-12's readiness, the full-flow verdict, the action registry, the exchange service, admission and the
provider exchange route reach the observation module and its screen only through GET /api/pcb-sync's route module and name none of
their exports; the release route reaches it at all only because it imports its board store from that module (`release/route.ts:45`).
The route hands the reader only to `createManufacturingSummaryReader` as its `observations` option (`route.ts:33`). CONFIRMED (case 6) [B23-B3 review, 2026-10-04] tests-4: each consumer also names none of the observation types (`ManufacturingObservation*`, `PcbSyncManufacturingObservation(s)`, `PcbSyncObservationSuggestion`) nor `.observations` or `.suggestions` - a type-only import is erased from the closure, so the name is the check (case 6's pattern widened in place); production names those types only in the five reviewed files (`b23-b-no-auto-accept` case 8).

## 19. Step 7: stale quotes and changed release inputs (OD-168, D23-17)

**D23-17's counterexample, executed.** The board read's `current.digest` is a pcbSyncDigest of the revision payload (`pcb-sync/board.ts:8`),
which sorts the board's arrays; the authority's `boardDigest` is `authoritativeBoardDigest`, a SHA-256 of the board's stable JSON
(`release-gate.ts:133`), which the release route compares (`release/route.ts:178`). Two boards whose nets are listed in another order have
ONE revision id and ONE pcbSyncDigest but TWO authoritative digests. On `0cd3f59` the summary called the authority and its release current
for both (`b3-01-red`: `b16-a-manufacturing-summary` "expected { authority: true, release: true } to deeply equal { authority: false,
release: false }"), so discovery section 9.5's "same-revision, different-JSON board head" is now CONFIRMED, not INFERRED. The fix, in
place: `authorityCurrent` compares the revision AND the authoritative digest recomputed from the loaded board (`manufacturing-summary.ts:83`),
never `current.digest`; the stale header line carries a dated note (`:8`); the handler hands the loaded board and its lineage state to the
reader (`handler.ts:200`, `:228`). CONFIRMED (`b16-a-manufacturing-summary`'s two new cases; `b23-b-stale-quote` case 1) [B23-B3 review, 2026-10-04] regressions-1: the first tree imported `authoritativeBoardDigest` from `release-gate.ts`, which put the release generator (JSZip, the native compiler, the verifiers; about a hundred modules) into every GET /api/pcb-sync's closure for one digest. The summary now declares the same formula over the same `native/stable` helpers (`manufacturing-summary.ts:152`), pinned equal as printed code, and the route's runtime closure holds neither `release-gate.ts` nor a JSZip importer (`b23-b-stale-quote` case 11).

**When an observation is stale** (`evaluateObservationStaleness`, `provider-observation.ts:212`), every reason reported in a fixed order:

| reason | stale when | compared with | case |
|---|---|---|---|
| `expired` | `now` reaches the provider's `validUntil` (an ISO instant), else `retrievedAt` + 24 hours (`:41`); a validity at or before `retrievedAt` is stale at once; one that is no instant is ignored | the read's clock | 2, 3 |
| `authority_unavailable`, `authority_moved` | no authority head; the ledger head's authority is not the head authority (a re-qualification) | the authority head's revision and record digest | 4, 9 |
| `release_unavailable`, `ledger_head_moved` | no ledgered release; the ledger head is another release | the release ledger's head: release id and archive SHA-256 | 4, 5, 9 |
| `board_unavailable`, `board_superseded` | no board at the read; the board is superseded in its lineage | the board read and its lineage | 9 |
| `board_revision_moved`, `board_digest_moved` | the loaded board's revision, OR its authoritative digest recomputed from it (`:227`), is not the authority's and the ledger head's | `authoritativeBoardDigest(board)`, never `current.digest` | 6 |
| `descriptor_moved` | the registry version, the row's digest, or the reviewed transfer descriptor's version is not the one the exchange ran under; [B23-B3 review, 2026-10-04] or the row is gone from the registry (coverage-2) | `PROVIDER_REGISTRY_VERSION`, the row's `durableWorkflowDigest`, `REVIEWED_TRANSFER_VERSIONS` | 7, 12 |
| `profile_moved` | the authority's rule profile id or version is not the observation's capability profile | the authority head's profile | 8 |
| `profile_evidence_invalid`, `profile_evidence_expired`, `profile_evidence_too_old` | the profile is not v2 or its evidence is missing or out of window; the evidence expired (2027-09-09 for `jlcpcb-2l`); it is older than 366 days (`:43`, pinned equal to `RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS`, `release/route.ts:51`) | `ruleProfileEvidenceStatus` at the read | 8, 14 |

These are B1's step-1 checks (`revalidateReleaseAuthority`) as of the read - the authority head, the current board of its lineage, the
board revision AND digest, the v2 profile, its expiry and its age - plus the release ledger head, the descriptor and the capability
profile. D23-5's re-derivation condition (the authority head, the board current, the rule-profile evidence unexpired and within
`RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS`) is therefore exactly when an observation of the exchange can be current. The outbound package digest
is not recomputed on a read: the regeneration is the release gate's whole pipeline. It is compared through its inputs - the ledger
head's release id and archive digest and the capability profile - which B1 pins to give one stable digest (INFERRED for a later change
to the package builder itself). CONFIRMED (cases 2-9)

**No observation can be current in production today.** `REVIEWED_TRANSFER_VERSIONS` (`provider-observation.ts:59`) mirrors
`provider-egress.ts`'s `PROVIDER_TRANSFER_DESCRIPTORS` (`:69`), which is empty: the mirror is pinned equal (case 7), and any observation's
transfer descriptor is not a reviewed one, so it is `descriptor_moved`. The mirror exists because `provider-egress.ts` reaches the egress
boundary and GET /api/pcb-sync must not. CONFIRMED

**Visible, labelled, never current.** A stale observation stays in the list with `stale: true` and its reasons; at most 32 are listed,
newest first, and the rest counted (`OBSERVATION_LIST_MAX`, `:47`). A corrupt exchange record makes the block `corrupt` with its bounded code
(`PX_LEDGER_DIGEST_MISMATCH`), nothing of it shown and nothing thrown, under the summary's one read policy (B16-A F12); the authority,
release, snapshot and integrity verdicts are unaffected (case 10). CONFIRMED [B23-B3 review, 2026-10-04] coverage-2, tests-6: an answer whose provider row was withdrawn, or whose operation was re-tiered, stays listed too: the reader loads every registry row's record, any tier, and every id of the append-only `OBSERVATION_WITHDRAWN_PROVIDER_IDS` (`:65`, none in B23; `:77`), pinned as a list that never shrinks (case 12). tests-7: every provider's answers are listed, newest first across providers (case 13). tests-9: the evidence-age bound is pinned on both sides - exactly 366 days is not too old, as the release route's `>` (`release/route.ts:189`), 1 ms later is - and another profile id is `profile_moved` (case 14). CONFIRMED

## 20. Step 8: shown, never applied (OD-169)

**The suggestion record.** A kept field whose name says it suggests, substitutes, recommends or replaces (`provider-observation.ts:135`,
OD-185 (g)) becomes a closed `sirkit.provider-suggestion.v1`: its kind (`substitution` when the name says substitute, alternative or
replace, else `design_change`), the field, its text screened like every provider string (null and the reason when withheld) and the one
disposition `shown_never_applied` (`:186`). CONFIRMED (`b23-b-no-auto-accept` case 1: five suggestions, one withheld as a directive)

**Nothing is applied.** Reading observations through GET /api/pcb-sync commits nothing: no durable write, no outbox event, and the
authority, release ledger and exchange record heads stay where they were. CONFIRMED (case 2)

**The import gate.** `provider-observation.ts` imports exactly six reviewed modules (the digest, the release manifest's schema, the rule
profile's evidence status, the code-point compare, the registry and the screen; B2's record only as types), and the screen one (the
redaction authority). Their whole runtime closure holds no command, executor or mutation module - no listed writer, sender or dispatcher,
no module whose name says command, executor, dispatch, mutation or apply, and no module whose code commits, fetches or reaches a process
or network module - and never the exchange record, the exchange service, the send, the egress boundary or `foreign-tools.ts`. CONFIRMED
(case 3)

**No code path turns a suggestion into a command.** The suggestion vocabulary is named in production only by the observation module, the
client's types and validator, and the display list; the list holds no control (no button, form, input, select or link, no event-handler
attribute) and no runtime import; only GET /api/pcb-sync's route imports the observation module, and only the observation module the
screen; the workflow panel hands the list the server's observations and nothing else. Each rule bites on an injected violation: an
executor import, a committing module in the closure, a command module importing the observation module, a button in the list. A person who
wants a suggested change makes it in the editor, which yields a new board, a new release and a stale observation (OD-169). CONFIRMED
(cases 4, 6) [B23-B3 review, 2026-10-04] coverage-4: the list now imports `react` (`useState`, `useEffect`) for its expiry clock, its one runtime import, pinned (case 4 moved in place); it holds no control still. tests-4: no control of any component sits inside a JSX expression that reads `.observations` or `.suggestions` (case 8, which bites on a button mapping the suggestions in the workflow panel).

## 21. On GET /api/pcb-sync, and in the panel

**The summary block.** `GET /api/pcb-sync?boardId=...&include=manufacturing` carries `observations: { state, codes, items, omitted }`
(`handler.ts:252`) beside the authority, the release, the snapshot, the integrity and the viewer - read-only, scoped to the request's
trusted project and board, with no provider call. The route composes the reader over B2's record through `load` only (`route.ts:33`). A board
with no exchange record has no block at all, so the summary keeps the shape it had before B23-B3 for every project today (OD-185 (h);
`manufacturing-summary.ts:142`). The client accepts the block only in its exact shape (`client.ts:167`). CONFIRMED (`b23-b-stale-quote`
case 10; the B16 acceptance and recovery pipelines green with their exact summaries) [B23-B3 review, 2026-10-04] coverage-3: that CONFIRMED was not earned: no test ran the validator, which checked the label's type only and admitted unknown keys and missing shown fields. The validator now takes each object's exact own keys, the fixed label, the closed purpose, retention and freshness basis, a stale flag equal to its reasons and the server's bound (`client.ts:167`, `:186`). CONFIRMED by `b23-b-observation` case 9: an answer round-trips through `PcbSyncClient.loadBoardWithManufacturing`, fifteen forged blocks are each `PS_API_INVALID_RESPONSE`, and exactly `OBSERVATION_LIST_MAX` observations pass, so the client's bound is pinned to the server's by behaviour (the client imports no server module).

**The panel.** `ProviderObservationList` (`ProviderObservationList.tsx:33`) renders in the manufacturing workflow panel
(`ManufacturingWorkflowPanel.tsx:125`), whatever the authority's state - the provider panel shows only for a current release, and a stale
observation must stay visible. [B23-B3 review, 2026-10-04] coverage-5: whatever the authority's and the release's state while the hydration is loaded; a hydration that failed integrity verification (a corrupt authority, snapshot or release, B16-A F12) shows none of the durable truth, the observations included - fail closed, since their reasons would read "no qualification authority" for an authority that exists and did not verify (the panel's comment corrected in place, `ManufacturingWorkflowPanel.tsx:124`; OD-185 (l) narrowed). tests-1: CONFIRMED by rendering the workflow panel (`b23-b-no-auto-accept` case 7: a stale authority and release list the observations and hide the provider panel; current ones show both; a failed hydration shows none). [B23-B3 review, 2026-10-04] coverage-4: the list re-judges time expiry by the clock - an observation the server judged current reads "stale: past its validity" once its `staleAt` passes (`ProviderObservationList.tsx:45`), and a timer re-renders the list at the next `staleAt` (`nextExpiryDelayMs`, `:77`), so a panel left open never keeps an expired quote current (case 9); the other reasons stay the server's, judged at the read. Each observation reads "external observation, not Sirkit proof", "stale:" with its reasons in words or
"current until" its `staleAt`, the provider's fields as the provider's words, the withheld fields by name, and each suggestion as "shown,
never applied". It holds no control: the B17-A control inventory and its generator are unchanged. The import is the first statement on
line 19, so B1's cited text on that line stays whole (`outbound-disclosure.md` C20). **This is a UI change: the browser suite was not run
here; the lead runs it.** CONFIRMED (`b23-b-no-auto-accept` case 5, rendered to static markup), RECORDED (browser)

**Who sees it.** GET /api/pcb-sync is readable by every member of the project (its policy row), automation included; the provider text
it shows has passed the screen. RECORDED [B23-B3 review, 2026-10-04] security-1: the receipt id had not, until this round; it has now (section 18). regressions-2: GET /api/pcb-sync's route module composes the reader, and the release and qualify routes import their board store from that module (`release/route.ts:45`, `qualify/route.ts:73`), so their runtime closures hold the exchange record, the observation module, its screen and the registry (modules loaded, nothing of them called). A separate composition module would not help - every module that route imports is in their closures - and moving the board store's import would move lines B16-B23 pages cite and the B16 route mocks, so the composition is kept; `b23-b-exchange-route` case 4 now pins that shared part exactly and scans every B23 module of the exchange closure for a connection primitive again (OD-185 (q)). RECORDED

## 22. Test-first record

- **Red first** (`b3-01-red`, the three new suites and the summary suite's two new cases, no production edit): 4 files failed; three
  failed to load (`Cannot find module '../provider-observation'`, `'@/app/components/pcb/ProviderObservationList'`), and the summary suite
  failed its 2 new cases with its 17 others green - the D23-17 counterexample above. CONFIRMED
- **First code** (`b3-02`): 41 / 42. One expectation of `b23-b-stale-quote` itself was wrong: case 1 read the whole flag line, whose
  dated comment names `current.digest`; it now reads the code before the comment. Then green. CONFIRMED
- **The readers after the code** (`b3-03`): 7 failed / 553 passed of 562. Three were pins B3 moves (section 23); B1's citation C20
  (`ManufacturingWorkflowPanel.tsx:19`) lost its anchor, so the import moved to the front of that line; and the B16 acceptance and
  recovery pipelines pin the summary's exact keys, so a board with no exchange record now carries no block (OD-185 (h)). Then 45 files,
  560 passed, 2 skipped (`b3-04`). CONFIRMED
- **The raw-route ratchet** (`b3-07`): `b16-0-8-migration-ratchet` failed once on POST /api/pcb-sync's source SHA-1 - its route file
  changed on line 14 and line 33 (the GET composition). Its own generator updated the baseline (`b3-08`: "3 -> 3 legacy methods (0
  migrated, 0 added)", only that SHA-1, `_raw-route-baseline.json:15`), the B16-A and B17 precedent; then green (`b3-09`). CONFIRMED
- **The suites bite** (`b3-14`): fifteen source breakages, each applied by exact text, run, the file restored and checked by SHA-256, the
  whole tree's digest equal before and after (`9707df7e52bc...`). Each was caught (exit 1):

| breakage | caught by |
|---|---|
| the flag compares the revision only | `b16-a-manufacturing-summary` (both new cases), stale-quote case 1 |
| the flag compares `current.digest` | the summary suite's control, two integrity and round-trip cases and both new cases, observation case 7, stale-quote cases 1, 10 |
| no `board_digest_moved` | stale-quote case 6 |
| 48 hours by default | observation case 1, stale-quote cases 2, 3 |
| the provider's validity ignored | observation case 1, stale-quote cases 3, 8 |
| no directive screen | observation cases 3, 4, no-auto-accept case 1 |
| no character rule | observation case 3 |
| a suggestion marked applied | no-auto-accept cases 1, 2 |
| no `profile_evidence_too_old` | stale-quote case 8 |
| no transfer-version check | stale-quote case 7 |
| no `authority_moved` | stale-quote case 4 |
| the copied phrase list drifts by one letter | observation case 4 |
| the handler drops the loaded board | the summary suite's board-read case, observation case 5, stale-quote cases 1-5 and 7-10 |
| an absent block kept | stale-quote case 10 |
| the joined reading off | observation case 3 |

## 23. Every pin moved, and why

| pin | moved how | why |
|---|---|---|
| `b16-a-manufacturing-summary.test.ts`: the import, `CURRENT`, the authority fixture's `boardDigest`, the release record's `boardDigest` | in place, each with a dated `[B23-B3, 2026-10-04]` note: `CURRENT` carries the loaded board; both digests are `authoritativeBoardDigest(BOARD.board)` (they held the board record's pcbSyncDigest, another domain, which the revision-only flag never read); two cases appended at the end | D23-17: the fixture was in the wrong domain, and the digest half was never asserted |
| `b23-b-egress-import-gate.test.ts` case 1 | in place, dated: the record's importers gain `app/api/pcb-sync/route.ts`; the title and the header item carry dated notes | GET /api/pcb-sync's route composes the record for the observation reader (`load` only) |
| `b23-b-exchange-route.test.ts` case 4 | in place, dated: `source-registry.ts`, `exchange-ledger.ts` and `provider-registry.ts` commented out of the added list (no line moved) | the release route's own closure now holds them, through GET /api/pcb-sync's route module |
| `b23-a-provider-admission.test.ts` case 8 | in place, dated: + `app/api/pcb-sync/handler.ts`, `manufacturing-summary.ts` (type-only imports) and `route.ts` (the composition); the header carries a dated note | the observation reader reads the registry for a provider's name, terms and row digest; it never calls admission |
| `app/lib/auth/__tests__/_raw-route-baseline.json` | regenerated by `generate-b16-0-8-baseline`: POST /api/pcb-sync's SHA-1 only | its route file changed (the GET composition) |
| `outbound-disclosure.md:270`, `:432`; this page's `:12`, `:187`, `:280` | a dated `[B23-B3, 2026-10-04]` note on the statement's own line (no line moved) | B3 made them incomplete |

[B23-B3 review, 2026-10-04] The review round moved more pins, each in place with a dated note: section 28.

No other pin moved. Every line B1's and B2's pages cite in the files B3 edited holds its content: `manufacturing-summary.ts`,
`handler.ts`, `route.ts`, `client.ts` and `ManufacturingWorkflowPanel.tsx` changed by in-place edits of existing lines and appended blocks
(the panel's one inserted render line comes after every cited line). CONFIRMED (`b23-b-page`, `b23-b-dfm-quote-flow-page` green)

## 24. OD-185 - B23-B3's choices beyond its task text

(a) An observation is derived at the read from B2's record (`load`); it is not stored a second time, and no raw body exists to derive it from.
(b) Only an `acknowledged` attempt is an observation; a rejected, unknown or not-sent attempt stays an exchange state.
(c) The screen: the length, printable ASCII and B20-C3's typographic set, no secret shape, B20's directive matcher alone and joined;
withheld whole, by name and reason; numbers and booleans kept. The matcher is a verbatim copy of A2's, pinned to it, because importing
`foreign-tools.ts` would put the egress boundary into GET /api/pcb-sync's closure.
(d) The stated validity is the kept field `validUntil`, an ISO instant; otherwise 24 hours after `retrievedAt`; a validity at or before
`retrievedAt` is stale at once; no cap beyond the other triggers (the rule-profile evidence bounds every observation within 366 days).
(e) Staleness reads B1's step-1 checks as of the read, the release ledger head, the descriptor (registry version, row digest, reviewed
transfer descriptor version) and the capability profile; a superseded board stales; the outbound package digest is compared through its
inputs, never recomputed on a read.
(f) `REVIEWED_TRANSFER_VERSIONS` mirrors `PROVIDER_TRANSFER_DESCRIPTORS` (empty), pinned equal: no observation is current in production
until a reviewed transfer descriptor exists.
(g) A provider suggestion is a kept field whose name matches `suggest`, `substitut`, `alternat`, `recommend` or `replace`; it is a
`substitution` when the name says substitute, alternative or replace, else a `design_change`. A provider's own field names reach Sirkit
only through a reviewed transfer descriptor's receipt fields, so the descriptor that admits a provider decides which of its fields are
suggestions.
(h) The summary carries `observations` only when the route composes the reader AND the board has an exchange record; a board with none
keeps the summary's earlier shape. A failed read is `corrupt` with its bounded code.
(i) The composition root is GET /api/pcb-sync's route; the release, qualify and provider exchange routes reach the observation module only
through that route module (their board-store import). The raw-route baseline's SHA-1 for POST /api/pcb-sync is regenerated.
(j) At most 32 observations are listed, newest first; the rest are counted.
(k) The summary recomputes `authoritativeBoardDigest` from the loaded board at every `include=manufacturing` read, as the release route does
at every release; the handler passes the board and its lineage state.
(l) The list renders in the manufacturing workflow panel, not inside the provider panel, so a stale observation stays visible after the
authority moves. [B23-B3 review, 2026-10-04] coverage-5: while the hydration is loaded; a hydration that failed integrity verification shows no observation
(fail closed, B16-A F12).
[B23-B3 review, 2026-10-04] The review round's choices:
(m) The provider's receipt id is provider text: screened alone and first in the joined reading; withheld under `source.providerReceiptId`
(null in `source`); still hashed into the observation id.
(n) A row a reviewed registry revision withdraws keeps its recorded answers listed, stale (`descriptor_moved`), named
`OBSERVATION_UNLISTED_PROVIDER_NAME` with its terms UNKNOWN; the reader loads every registry row's record (any tier) and every id of the
append-only `OBSERVATION_WITHDRAWN_PROVIDER_IDS`, which the revision that removes a row appends to.
(o) `terms.answerLicense` states the licence for the provider's answer, UNKNOWN (`OBSERVATION_ANSWER_LICENSE`) until a provider's terms
are read; the registry, its version and its byte-gated CSV are not changed.
(p) The summary declares `authoritativeBoardDigest`'s formula over `native/stable` instead of importing `release-gate.ts`, pinned equal
as printed code.
(q) The composition stays in GET /api/pcb-sync's route module; the release and qualify routes' closures hold the observation modules
(loaded, never called), and `b23-b-exchange-route` case 4 scans them.
(r) The list judges time expiry by the clock and re-renders at the next `staleAt`; every other stale reason stays the server's, judged
at the read.
(s) The client's validator takes the exact shape; its bound is the server's, pinned by behaviour (the client imports no server module).

## 25. What stays open

- **Live answers: BLOCKED-LIVE-QUALIFICATION (LB-11).** No provider is admitted, no reviewed transfer descriptor exists and Sirkit holds no
  provider account (OD-160): no live observation can exist, and in production every observation would read `descriptor_moved`. RECORDED
- **A provider's own field names** (its validity field, its suggestion fields) are the reviewed transfer descriptor's to map; none exists.
  RECORDED
- **The screen is defence in depth** (OD-81's limit, as for B20): it fails closed on what it recognises and cannot recognise every
  paraphrase; that a provider's words direct nothing rests on the label, the absent verdict and the absence of any consumer. RECORDED
- **The copied matcher** must move with A2's: `b23-b-observation` case 4 fails until it does. Extracting A2's matcher into a transport-free
  module both import would remove the copy; it moves lines B20's pages cite, so it is a later reviewed change. RECORDED
- **The digest at every read** costs a SHA-256 of the board's stable JSON per `include=manufacturing` read (the release route pays the same
  per release). INFERRED
- **Who sees observations:** every project member who can read GET /api/pcb-sync, automation included (section 21). RECORDED
- **The browser suite was not run:** B3 changed the UI; the lead runs it. RECORDED
- [B23-B3 review, 2026-10-04] **The release and qualify routes load the observation modules** through their board-store import of GET /api/pcb-sync's
  route module (section 21; OD-185 (q)): load time only, nothing of them is called. RECORDED
- [B23-B3 review, 2026-10-04] **A withdrawn provider stays listed only if its id is appended** to `OBSERVATION_WITHDRAWN_PROVIDER_IDS` by the registry
  revision that removes its row; `b23-b-stale-quote` case 12's append-only list fails until it is. RECORDED
- [B23-B3 review, 2026-10-04] **The answer's licence is UNKNOWN** for every provider (`terms.answerLicense`): nobody has read any provider's terms for its
  answers, and no provider is admitted. BLOCKED-LIVE-QUALIFICATION (LB-11)
- [B23-B3 review, 2026-10-04] **The list's clock re-judges expiry only**: an authority, release, board or descriptor move is seen at the next hydration, as
  every other durable flag of the panel is. RECORDED
- [B23-B3 lead, 2026-10-04] **Nine sequential record reads per hydration.** Since the review the reader loads the exchange record of every
  registry row (`OBSERVATION_PROVIDER_IDS`, nine), one `loadHead` round trip each, where five rows ever had a `dfm_quote_transfer`
  operation; Eurocircuits, Mouser, Nexar and LCSC can hold no record (B2 refuses any other tier, `PX_EXCHANGE_NOT_OFFERED`), so their four
  reads always return nothing. A latency cost on every `include=manufacturing` read, nothing wrong; narrowing the list to rows that ever
  had a transfer operation is a later reviewed change. INFERRED

## 26. Citations (B23-B3)

As of this working tree on `0cd3f59` (2026-10-04); the anchor text is the check, the line is for the reader; `b23-b-dfm-quote-flow-page`
case 8 checks every row. [B23-B3 review, 2026-10-04] Re-pointed after the review round (D1-D13, D29; D8's anchor is the new joined
reading), and D40-D50 added. [PR-G, 2026-10-17] D22-D24 re-pinned `:200` -> `:211`, `:228` -> `:239` and `:252` -> `:263` in place: Product
reliability C (`6bdd7f7`) inserted eleven lines above them in `app/api/pcb-sync/handler.ts` (an import at `:15`, the refused-apply (409)
mapping at `:43-51` and one line in the POST handler); the anchors are unchanged.

| # | file | line | anchor |
|---|---|---|---|
| D1 | `app/lib/manufacturing-providers/provider-observation.ts` | 38 | `export const MANUFACTURING_OBSERVATION_LABEL = "external observation, not Sirkit proof" as const;` |
| D2 | `app/lib/manufacturing-providers/provider-observation.ts` | 41 | `export const OBSERVATION_DEFAULT_FRESHNESS_MS = 24 * 60 * 60_000;` |
| D3 | `app/lib/manufacturing-providers/provider-observation.ts` | 43 | `export const OBSERVATION_PROFILE_EVIDENCE_MAX_AGE_MS = 366 * 24 * 60 * 60 * 1000;` |
| D4 | `app/lib/manufacturing-providers/provider-observation.ts` | 47 | `export const OBSERVATION_LIST_MAX = 32;` |
| D5 | `app/lib/manufacturing-providers/provider-observation.ts` | 59 | `export const REVIEWED_TRANSFER_VERSIONS: readonly TransferVersion[] = Object.freeze([]);` |
| D6 | `app/lib/manufacturing-providers/provider-observation.ts` | 135 | `const SUGGESTION_NAME = /suggest` |
| D7 | `app/lib/manufacturing-providers/provider-observation.ts` | 151 | `export function normalizeManufacturingObservation(` |
| D8 | `app/lib/manufacturing-providers/provider-observation.ts` | 174 | `if (screenProviderTextsTogether([...(receiptReason === null ? [receiptId] : []), ...strings.map((field) => field.value as string)]) !== "clean") {` |
| D9 | `app/lib/manufacturing-providers/provider-observation.ts` | 186 | `disposition: "shown_never_applied" };` |
| D10 | `app/lib/manufacturing-providers/provider-observation.ts` | 195 | `sirkitVerdict: "none",` |
| D11 | `app/lib/manufacturing-providers/provider-observation.ts` | 212 | `export function evaluateObservationStaleness(` |
| D12 | `app/lib/manufacturing-providers/provider-observation.ts` | 227 | `reasons.add("board_digest_moved");` |
| D13 | `app/lib/manufacturing-providers/provider-observation.ts` | 260 | `export function createProviderObservationReader(` |
| D14 | `app/lib/manufacturing-providers/provider-text-screen.ts` | 19 | `import { containsSecretShapedText } from "../agent/redaction";` |
| D15 | `app/lib/manufacturing-providers/provider-text-screen.ts` | 49 | `export const PROVIDER_DIRECTIVE_PHRASES: readonly string[] = Object.freeze([` |
| D16 | `app/lib/manufacturing-providers/provider-text-screen.ts` | 244 | `export function providerTextReadsAsDirective(` |
| D17 | `app/lib/manufacturing-providers/provider-text-screen.ts` | 256 | `export function providerJoinedTextReadsAsDirective(` |
| D18 | `app/lib/manufacturing-providers/provider-text-screen.ts` | 305 | `export function screenProviderText(` |
| D19 | `app/api/pcb-sync/manufacturing-summary.ts` | 8 | `[B23-B3, 2026-10-04] D23-17: until B23-B3 only the revision was compared` |
| D20 | `app/api/pcb-sync/manufacturing-summary.ts` | 83 | `authority.authority.boardDigest === currentBoardDigest);` |
| D21 | `app/api/pcb-sync/manufacturing-summary.ts` | 142 | `if (read.state === "absent") return null;` |
| D22 | `app/api/pcb-sync/handler.ts` | 211 | `board: PcbBoard; superseded?: boolean } \| null` |
| D23 | `app/api/pcb-sync/handler.ts` | 239 | `board: record.board, superseded: lineageSummary?.state === "superseded"` |
| D24 | `app/api/pcb-sync/handler.ts` | 263 | `export interface PcbSyncManufacturingObservations` |
| D25 | `app/api/pcb-sync/route.ts` | 33 | `createManufacturingSummaryReader(workflow, { observations: createProviderObservationReader({ exchanges: createProviderExchangeLedger(workflow) }) })` |
| D26 | `app/lib/pcb-sync/client.ts` | 167 | `function manufacturingObservations(` |
| D27 | `app/components/pcb/ManufacturingWorkflowPanel.tsx` | 19 | `import { ProviderObservationList } from "./ProviderObservationList";` |
| D28 | `app/components/pcb/ManufacturingWorkflowPanel.tsx` | 125 | `{truth?.observations && <ProviderObservationList observations={truth.observations} />}` |
| D29 | `app/components/pcb/ProviderObservationList.tsx` | 33 | `export function ProviderObservationList(` |
| D30 | `app/api/pcb/release/route.ts` | 45 | `import { stage3Repository } from "../../pcb-sync/route";` |
| D31 | `app/api/pcb/release/route.ts` | 51 | `export const RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS = 366 * 24 * 60 * 60 * 1000;` |
| D32 | `app/api/pcb/release/route.ts` | 178 | `authoritativeBoardDigest(head.record.board) !== stored.authority.boardDigest` |
| D33 | `app/lib/pcb/fab/release-gate.ts` | 133 | `export function authoritativeBoardDigest(board: PcbBoard): string {` |
| D34 | `app/lib/pcb-sync/board.ts` | 8 | `export function boardDigest(board: PcbBoard): string { return pcbSyncDigest(pcbRevisionPayload(board)); }` |
| D35 | `app/lib/mcp/foreign-tools.ts` | 59 | `import { MCP_PARAM_HEADER_MAX, scrubWindow, skeletonCarries } from "./http-transport";` |
| D36 | `app/lib/mcp/http-transport.ts` | 47 | `import { outboundFetch, type OutboundDeps` |
| D37 | `app/lib/manufacturing-providers/provider-egress.ts` | 69 | `export const PROVIDER_TRANSFER_DESCRIPTORS: readonly ProviderTransferDescriptor[] = Object.freeze([]);` |
| D38 | `app/lib/engineering/descriptor-text.ts` | 25 | `It is NOT A2` |
| D39 | `app/lib/auth/__tests__/_raw-route-baseline.json` | 15 | `"sha1": "eab017f0467c989a3148a7b1d35e5b7de85abbfb"` |
| D40 | `app/api/pcb-sync/manufacturing-summary.ts` | 152 | `function authoritativeBoardDigest(board: PcbBoard): string {` |
| D41 | `app/lib/manufacturing-providers/provider-observation.ts` | 65 | `export const OBSERVATION_WITHDRAWN_PROVIDER_IDS: readonly string[] = Object.freeze([]);` |
| D42 | `app/lib/manufacturing-providers/provider-observation.ts` | 69 | `export const OBSERVATION_ANSWER_LICENSE = "UNKNOWN:` |
| D43 | `app/lib/manufacturing-providers/provider-observation.ts` | 77 | `...PROVIDER_ROWS.map((row) => row.id), ...OBSERVATION_WITHDRAWN_PROVIDER_IDS` |
| D44 | `app/lib/manufacturing-providers/provider-observation.ts` | 163 | `const receiptReason = screenProviderText(receiptId);` |
| D45 | `app/lib/manufacturing-providers/provider-observation.ts` | 241 | `> OBSERVATION_PROFILE_EVIDENCE_MAX_AGE_MS) reasons.add("profile_evidence_too_old");` |
| D46 | `app/lib/pcb-sync/client.ts` | 186 | `function observationItem(item: unknown): boolean {` |
| D47 | `app/components/pcb/ProviderObservationList.tsx` | 45 | `now >= Date.parse(item.freshness.staleAt)` |
| D48 | `app/components/pcb/ProviderObservationList.tsx` | 77 | `export function nextExpiryDelayMs(` |
| D49 | `app/components/pcb/ManufacturingWorkflowPanel.tsx` | 124 | `[B23-B3 review, 2026-10-04] coverage-5` |
| D50 | `app/api/pcb/release/route.ts` | 189 | `if (Date.now() - retrievedAt > RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS)` |

## 27. Gates (B23-B3)

Every run went through the shared lock, one at a time; every CLI process was stopped after it (leftover count 0 each time). No run
printed `Timeout calling "onTaskUpdate"`. Logs `b3-*` in the program's scratch log folder.

| gate | result |
|---|---|
| every suite that reads a file B3 changed, before any edit (`b3-00`) | 42 files; 535 passed, 2 skipped; exit 0 |
| the new suites and the summary suite's new cases on the unmodified source (`b3-01`, red) | 4 files failed: 3 to load, the summary suite 2 failed / 17 passed; exit 1 |
| the same on the first code (`b3-02`) | 1 failed / 41 passed of 42 (an expectation of the suite itself, section 22); exit 1 |
| the readers after the code, before the pin moves (`b3-03`) | 7 failed / 553 passed / 2 skipped of 562; exit 1 |
| the readers after the fixes and the moves (`b3-04`) | 45 files; 560 passed, 2 skipped; exit 0 |
| `app/lib/auth/__tests__`, `app/api/__tests__`, `app/lib/computation/__tests__`, `app/api/components/__tests__`, `app/api/parts/__tests__` (`b3-07`) | 1 failed (the raw-route ratchet, section 22) / 1929 passed / 27 skipped; exit 1 |
| the same after the baseline's own generator (`b3-08`, `b3-09`; the census 166 / 163 / 3 / 0, the B22 process census) | 100 files (98 passed, 2 skipped); 1930 passed, 27 skipped; exit 0 |
| `app/lib/agent/__tests__` (B11.5 case 12), `app/lib/agent/orchestration/__tests__`, `app/api/chat/__tests__` (`b3-10`) | 107 files; 1024 / 1024; exit 0 |
| `app/lib/mcp` (counts 47 / 36 / 9 / 27, `b20-b4-process-gate`), `app/lib/project/__tests__` (`b14-4-ast-import-gates`), `app/api/mcp/__tests__` (`b3-11`) | 89 files; 1214 / 1214; exit 0 |
| `app/lib/engineering/__tests__` (B17-A, the B19-E tripwire, the tiers), `app/components/pcb/__tests__`, `app/lib/pcb-sync/__tests__` (`b3-12`) | 125 files; 1255 passed, 1 skipped; exit 0 |
| every generator (21; `b3-13`, then `b3-20` on the final tree) | each exit 0; no drift |
| fifteen source breakages (`b3-14`) and three page breakages (`b3-16`), each restored and checked by SHA-256 | each caught (exit 1); the tree equal after every one |
| the page suites over this page: `b23-b-dfm-quote-flow-page`, `b23-b-page`, both closeout suites, `b21-f-page` (`b3-15`) | 5 files; 52 / 52; exit 0 |
| the readers again on the final tree: `app/lib/manufacturing-providers` (the PGlite and page suites included), `app/api/pcb-sync`, the release, qualify and component suites, the prompt-to-Gerber pipelines, B17-A, the B19-E tripwire, the census, both closeout suites, `b21-f-page`, the chat-closure tripwire, `b11-5-capture-exactness`, the CI job-scope guard, the raw-route ratchet, `app/lib/pcb-sync/__tests__` (`b3-17`) | 73 files; 757 passed, 2 skipped; exit 0 |
| tsc (`--noEmit -p tsconfig.json`; `b3-05`, `b3-18`) | exit 0, no output |
| eslint on the 17 changed or added `.ts` and `.tsx` files (`b3-06`: one unused import in a new suite, removed; `b3-19`) | exit 0, no output |

`app/lib/pcb` was not run: B3 changed no PCB module. The browser suite was not run (section 21).

## 28. The adversarial review of the first B3 tree, and what it changed

[B23-B3 review, 2026-10-04] An adversarial review of the first B3 working tree (on `0cd3f59`) confirmed sixteen findings ([B23-B3 lead, 2026-10-04]: sixteen ids, first written fourteen), three issues of them
reported twice (security-1 with coverage-1, coverage-2 with tests-6, coverage-3 with tests-2), so thirteen distinct issues. Each was fixed test-first. "Red" is a case
that failed on the unfixed tree (`b3f-02`: 6 failed / 50 passed of 56, exit 1). A test-strength finding is shown by a source change the
earlier suites miss and the strengthened suite catches (`b3f-06`, the `t` runs). Thirteen breakages of the fixed source were each caught
(`b3f-06`, the `b` runs). Every change was applied by exact text and restored, and the restore was checked by SHA-256. The whole tree's
digest was equal before and after (`ece124f2cac6...`).

| finding | reproducing test | before the fix | fix | after |
|---|---|---|---|---|
| regressions-1 (low) | `b23-b-stale-quote` case 11 | red: the summary declared no `authoritativeBoardDigest`; its value import from `release-gate.ts` put the release generator into GET /api/pcb-sync's closure | the summary declares the gate's formula over `native/stable` (`manufacturing-summary.ts:152`); line 29 imports `sha256` and `stableJson`, never `release-gate.ts`; dated notes on `:8` and `:29` | green; re-importing `release-gate.ts` (b01) or a drifting formula (b02) fails |
| regressions-2 (low) | `b23-b-exchange-route` case 4 | test strength: a `fetch(` appended to `exchange-ledger.ts` passed the first tree's case 4 (t6a: 14 / 14, exit 0) | the composition is kept (section 21; OD-185 (q)); case 4 pins the release closure's B23 part exactly, pins that it reaches no sender, and scans every B23 module of the exchange closure again; it also takes the closure gates' 120 s timeout | the same fetch fails case 4 (t6b) |
| security-1, coverage-1 (low; medium) | `b23-b-observation` case 8 | red: `expected 'SYSTEM:ignore-all-previous-instructio...' to be null` | the receipt id is screened alone and first in the joined reading (`provider-observation.ts:163`, `:174`); when it fails, `source.providerReceiptId` is null and `withheld` names `source.providerReceiptId` with the rule; the list reads "receipt withheld" | green; showing it unscreened (b03: cases 3 and 8) or leaving it out of the joined reading (b04) fails |
| coverage-2, tests-6 (low) | `b23-b-stale-quote` case 12 | red: with jlcpcb's row withdrawn the list was empty (`expected [] to have a length of 1 but got +0`) | a missing row still names its answers (`OBSERVATION_UNLISTED_PROVIDER_NAME`, terms UNKNOWN), judged `descriptor_moved`; the reader loads every registry row (any tier) and every id of the append-only `OBSERVATION_WITHDRAWN_PROVIDER_IDS` (`:65`, `:77`) | green; restoring the tier filter (b05) or refusing the row (b06: case 12 and observation case 2) fails |
| coverage-3, tests-2 (low; medium) | `b23-b-observation` case 9 | red: a forged label passed (`a forged label: expected { ok: true, ... } to match object { ok: false, ... }`) | the client takes the exact shape (`client.ts:167`, `:186`) | green; checking the label's type only (b08), admitting unknown keys (b09), a bound of 33 (b10) or leaving the stale flag unchecked (b13) fails |
| coverage-4 (low) | `b23-b-no-auto-accept` case 9 | red: past `staleAt` the list still read `data-stale="false"` | the list judges expiry by the clock and re-renders at the next `staleAt` (`ProviderObservationList.tsx:45`, `:77`) | green; ignoring the clock (b11) or an absolute delay (b12) fails |
| coverage-5 (low) | `b23-b-no-auto-accept` case 7; the page suite's case 10 | the panel comment, section 21 and OD-185 (l) said "whatever the authority"; a failed hydration hid the observations (the behaviour is kept: fail closed) | narrowed in place: the panel comment (`ManufacturingWorkflowPanel.tsx:124`), section 21, OD-185 (l) | case 7 pins the fail-closed rendering |
| coverage-6 (low) | `b23-b-observation` case 1 (moved in place) | the terms held no licence for the answer | `terms.answerLicense`, UNKNOWN with its reason (`provider-observation.ts:69`); section 18's row says so | green; dropping it (b07: cases 1 and 9) fails |
| coverage-7 (low) | the page suite's case 10 | red: line 187's note read "an observation of such an exchange" | the note stands before B2's next sentence and names its antecedent; section 18 says eight hostile fields among eleven | green |
| tests-1 (medium) | `b23-b-no-auto-accept` case 7 | test strength: wrapping the list into the B1 conditional (lines 122 and 125 keep their cited text) passed every earlier suite | case 7 renders the workflow panel | the wrap fails case 7 (t4; re-run on the final page, `b3f-09`: only case 7 failed, with `b23-b-provider-panel`, `b23-b-page` and the page suite green) |
| tests-4 (low) | `b23-b-observation` case 6 (widened), `b23-b-no-auto-accept` case 8 | test strength: a type-only import of `PcbSyncManufacturingObservations` into `readiness.ts`, gating on `accepted`, passed case 6 with its first-tree names (t5a: only the new case 8 failed) | case 6's names gain the observation types and `.observations` / `.suggestions`; case 8 pins the five files that name the types, and that no control sits inside an expression reading observations or suggestions | the import fails case 6 and case 8 (t5b) |
| tests-7 (low) | `b23-b-stale-quote` case 13 | test strength: the reader cut to its first provider passed | case 13: jlcpcb and pcbway, newest first across providers | the cut fails case 13 (t1) |
| tests-9 (low) | `b23-b-stale-quote` case 14 | test strength: `>=` for `>`, and the profile id ignored, both passed | case 14: exactly 366 days is not too old and 1 ms later is; another profile id is `profile_moved`; the release route's `>` is pinned | each fails case 14 (t2, t3) |

**The pins this round moved**, each in place with a dated `[B23-B3 review, 2026-10-04]` note:

| pin | moved how | why |
|---|---|---|
| `b23-b-observation` case 1 | the terms keys gain `answerLicense`, pinned UNKNOWN | coverage-6 |
| `b23-b-observation` case 2 | an unknown provider's answer is an observation named `OBSERVATION_UNLISTED_PROVIDER_NAME`; was `provider_unknown` | coverage-2 |
| `b23-b-observation` case 3 | the joined case withholds the receipt id too | security-1 |
| `b23-b-observation` case 6 | the consumers' name pattern widened | tests-4 |
| `b23-b-no-auto-accept` case 4 | the list's runtime imports are `react` | coverage-4 |
| `b23-b-no-auto-accept` case 5 | reads at a fixed instant; it read the real clock, so from 2026-10-05T12:00Z its current item would have read stale | coverage-4 |
| `b23-b-exchange-route` case 4 | the shared B23 part, the senders, every B23 module scanned; plus `{ timeout: 120_000 }` | regressions-2. Its two closure walks took 5.6 s and 6.5 s here (`b3f-00` in the readers run, `b3f-01` alone: "Test timed out in 5000ms"), over vitest's 5 s default. In the first tree's runs case 4 took 3.7-4.7 s (`b3-04`, `b3-17`, the review's `b3r-00`); every closure gate in these suites already takes 120 s. |
| this page | section 26 re-pointed (D1-D13, D29; D8's anchor), D40-D50 added; the prose line citations of sections 18-21 re-pointed; the counts of section 17 | the round moved lines in B3's own new files |

**Gates of the round.** Every run went through the shared lock, one at a time, and every CLI process was stopped after it (leftover count
0 each time). No run printed `Timeout calling "onTaskUpdate"`. The logs are named `b3f-*`.

| gate | result |
|---|---|
| the readers (`b3-17`'s 73 files) before any edit (`b3f-00`) | 1 failed (`b23-b-exchange-route` case 4: "Test timed out in 5000ms", 5632 ms) / 756 passed / 2 skipped; exit 1 |
| that suite alone (`b3f-01`) | 1 failed (case 4, the same timeout, 6514 ms) / 13 passed; exit 1 |
| the new and moved cases on the unfixed tree (`b3f-02`, red) | 5 files; 6 failed / 50 passed of 56; exit 1 |
| the three B3 suites, the exchange route, the provider panel and the summary suite on the fixed code (`b3f-05`) | 6 files; 74 / 74; exit 0 |
| test strength and breakages (`b3f-06`; t4 again on the final page, `b3f-09`) | t5a and t6a green on the change (the earlier suites miss it); t1-t4, t5b and t6b each caught by the strengthened suite; b01-b13 each caught; every file restored by SHA-256; the tree digest equal |
| the readers again (`b3f-10`) | 73 files; 767 passed, 2 skipped; exit 0 |
| `app/lib/auth/__tests__`, `app/api/__tests__`, `app/lib/computation/__tests__`, `app/api/components/__tests__`, `app/api/parts/__tests__` (`b3f-11`; the census 166 / 163 / 3 / 0, the raw-route ratchet, the B22 process census) | 100 files (98 passed, 2 skipped); 1930 passed, 27 skipped; exit 0 |
| `app/lib/agent/__tests__` (B11.5 case 12), `app/lib/agent/orchestration/__tests__`, `app/api/chat/__tests__` (`b3f-12`) | 107 files; 1024 / 1024; exit 0 |
| `app/lib/mcp` (counts 47 / 36 / 9 / 27, `b20-b4-process-gate`), `app/lib/project/__tests__` (`b14-4-ast-import-gates`), `app/api/mcp/__tests__` (`b3f-13`) | 89 files; 1214 / 1214; exit 0 |
| `app/lib/engineering/__tests__` (B17-A, the B19-E tripwire), `app/components/pcb/__tests__`, `app/lib/pcb-sync/__tests__` (`b3f-14`) | 125 files; 1255 passed, 1 skipped; exit 0 |
| tsc (`--noEmit -p tsconfig.json`; `b3f-15`) | exit 0, no output |
| eslint on the 17 changed or added `.ts` and `.tsx` files (`b3f-16`) | exit 0, no output |
| every generator (21; `b3f-17`) | each exit 0; no drift (status, diff and untracked digests equal) |
| the page suites over this page after its last edit: `b23-b-dfm-quote-flow-page`, `b23-b-page`, both closeout suites, `b21-f-page` (`b3f-18`) | 5 files; 53 / 53; exit 0 |

New cases: `b23-b-observation` 8, 9; `b23-b-stale-quote` 11-14; `b23-b-no-auto-accept` 7-9; the page suite's 10. No other suite changed.
`app/lib/pcb` was not run: no PCB module changed. The UI changed again (the list's clock, "receipt withheld"): **the lead runs the browser
suite**. RECORDED

## 29. The B23 closeout's export record

[B23 closeout (1/2), 2026-10-05] The B2 and B3 exports and members no production module uses, and why each stays. The table is in
`closeout-statements.md` section 3, which `b23-closeout-statements` case 7 re-derives from the tree. RECORDED; nothing here is
retired. The exchange record, the provider egress, the empty transfer descriptor list and the observation reader are delivered and
kept (section 8); none of them is retired.

- `EXCHANGE_PHASES`: the record's three phases (section 4) as data beside `ExchangePhase`.
- `ProviderExchangeLedger`'s `attempt` and `history`: the record's reconciliation reads (OD-167 records reconciliation, it does not
  build it), which `b23-b-exchange-ledger` reads; production calls `prepare`, `markSent`, `settle`, `attemptForKey` and `load`.
- `currentManufacturingProviderPause`: the meter's non-reserving read, the oracle `b23-b-provider-meter` cases 2, 4 and 7 use to show
  that an agent's request reserves nothing; its sibling `currentMcpPause` has no production caller either.
- `ProviderSendInput`'s `signal`: a caller's abort input for a send, which only the suites set. The exchange service passes no signal
  into a send, so an upload would be bounded by its descriptor's one deadline alone; none can start in B23, since no reviewed
  descriptor exists (section 8).
- `PROVIDER_TEXT_SCREEN_REASONS`: the screen's closed reasons (section 18) as data beside `ProviderTextScreenReason`.
- `ManufacturingSummaryOptions`' `now`: the summary's clock seam; GET /api/pcb-sync's route composes only `observations`, and the
  default is the system clock.
- `createProviderObservationReader`'s `registry` and `transferVersions`: seams for a later registry revision and a reviewed descriptor
  version; the route passes only `exchanges`, so production reads `PROVIDER_ROWS` and the empty `REVIEWED_TRANSFER_VERSIONS`.
