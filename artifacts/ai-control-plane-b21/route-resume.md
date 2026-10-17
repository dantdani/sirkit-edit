# B21-E3 — the route-level resume and the userMessageDigest ledger (OD-122 across resumes; D21-4 at the route, D21-17's live-head half, D21-16's route half)

Labels: **CONFIRMED** (executed and measured, or read at the cited file:line), **INFERRED** (code reading), **PROPOSED** (designed, not
exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. Tree
`chapter/b21-specialist-orchestration`, base `b4a0ec5` (the B21-E2 (2/2) commit); written 2026-09-27, the adversarial review's fixes
2026-09-28. This is a NEW page for B21-E3: item 3 of the lead's E2 section - the route-level resume and the `userMessageDigest` ledger,
judged against the LIVE head read at resume time, with D2's single-emission rule holding across resumes. The composer's kind swap
(D21-38) and the coordinator's first turn behind the breaker (D21-39) are B21-E4's. Every `[B21 E3]` statement below is pinned by
`b21-e3-page.test.ts` (the refusal table IS `CHAT_RESUME_REFUSALS`; the entry table IS `ORCHESTRATION_RESUME_KINDS` with the keys
`orchestrationResumeIdempotencyKey` builds; the bounds, the lease, the deadline, the lists and the lines quoted ARE the code's; every
citation resolves by content exactly once and, for every production file E3 changed, on the line it states; every suite row carries its
real `it(` count) or by the suite it names. No model is called in any E3 suite: the record suite runs the REAL durable store over the
in-memory repository, the runtime suite the REAL runtime, scheduler, loop, gateways, merge and presentation over scripted adapters and
runbook scenario 17's fixture catalog, the route suite the production POST (the wrapper's identity, membership, role and CSRF checks
included) with the adapters mocked, as B18-D and B21-B do.

## 0. What E3 delivers

Why (runbook B21-B "Cancellation and resume first-class. A provider outage must not duplicate committed work."; B21-E "resume from
immutable trace after refresh"; `discovery.md` D21-4, OD-122): before E3 the chat route minted a fresh run id per POST, so a human's
re-send after an outage was a NEW run whose specialists ran - and were paid - again; the scheduler could replay a committed result only
for a caller that handed it the same run id, which no request did.

- **The resume at the route (section 1).** Under `SIRKIT_ORCHESTRATION_ENABLED=1` the chat body may carry ONE more key,
  `resumeRunId` - the run id the client received in `X-Sirkit-Run-Id` - admitted BESIDE the route's `ALLOWED_BODY_KEYS` (unchanged, C1)
  by `chatResumeBodyKeyAdmitted` (C2, C8): flag off, a body carrying it is refused exactly as HEAD refuses any unknown key. The route
  judges it after the wrapper's identity, live membership, role and CSRF checks and before any provider call (C3, C20): nine closed
  refusals, each a JSON answer with no stream (C10). An accepted resume REUSES the run id (C4) and hands its grant to the runtime for
  that request object only (C5, C32, C33). **CONFIRMED** by `b21-e3-chat-resume.test.ts` (11 cases) and `b21-e3-resume-runtime.test.ts`
  (18).
- **The resume record (section 2).** `agent.orchestration-resume.v1`, its own aggregate BESIDE `agent.orchestration-run.v1` on the same
  repository (E2b's trace-record precedent): the coordinator's first turn (the resume binding - owner, message, provider, plan - and its
  final text, recorded whole and exactly unless credential-shaped), ONE specialist artifact per `userMessageDigest`, the follow-up's
  answer, each request's start and end. The run's own history - what the scheduler resumes from and the merge chains its verdicts in - is
  untouched. **CONFIRMED** by `b21-e3-resume-record.test.ts` (9 cases).
- **The resumed run (section 3).** The coordinator's first turn is REPLAYED from the record - no model call, its answer as one final
  text, its artifact never re-emitted (C36, C50); the scheduler replays every committed specialist result that is still current for the
  RESUMING request - its scope, schematic, selection and netlist, and seals that outlive the approval window - and re-runs the rest (the
  merge judging the LIVE head read at resume time, never the first request's snapshot - D21-17's live-head half); the follow-up turn runs
  ONCE per run (a `follow-up` entry finishes it, `resume_completed`); and one request of a run at a time: every request's start is claimed
  on the record and settled at its end - a stand-down, a cancellation or a throw - before it leaves the runtime (C27, C29, C42, C45-C52).
- **The ledger (section 4, OD-122 across resumes).** One side-effecting artifact per `userMessageDigest` across the resumes of a run: a
  specialist's action the merge's rule would present is CLAIMED on the record first; a claim that reads back as a replay withholds it
  (`already_presented`, appended last to the approval outcomes, C81-C83) - a specialist proposal is never presented twice; the
  coordinator's own first-turn artifact keeps every resume's specialists read-only (`coordinator_sealed`).
- **OD-130's part review from a production POST (section 5, D21-16's route half).** A seal replayed on a resume after the catalog's exact
  authority moved is contradicted by the merge against the authority as loaded at resume time, and the part review for
  `request_atomic_review` reaches the stream and the envelope - through two production POSTs.
- **"Resume" on the chat surface is a run-log line (section 6, OD-127).** A DAG run that ended without its follow-up's answer leaves one
  offer line; the next send of the same message on the same provider, project and branch resumes it - after a reload too (the line is read
  back from the saved run log). No control.
- **The work was ADOPTED, then reviewed.** A previous E3 implementer run was cut off by a power outage (2026-09-27, about 09:06) and left
  partial, unreviewed work in the tree; the adopting run verified every changed file against HEAD, kept most of it, changed what was wrong
  or missing and finished the rest (section 8, "Adopted work"). An adversarial review then CONFIRMED twenty findings; each is fixed
  test-first (section 8, "Review fixes").

What E3 is NOT: section 7.

## 1. The resume at the route

**The body key.** `resumeRunId` (C7) is admitted only under the orchestration flag by `chatResumeBodyKeyAdmitted` (C8): the route's
own loop over the body's keys refuses a key when `!ALLOWED_BODY_KEYS.has(key) && !chatResumeBodyKeyAdmitted(key)` (in place, C2), and
`ALLOWED_BODY_KEYS` itself is unchanged (C1) - so a flag-off request carrying the key is refused exactly as HEAD refuses it, with the
same status and body (route case 1). Its value must be a run id this route issues:
`run-` and a lower-case UUID, the grammar `^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (C9); anything else - a
number, a list, an object, another case, a trailing space, a task id, a key-shaped string - is `resume_malformed`.

**Where it is judged.** `resolveChatResume` (C20) runs in the route AFTER the wrapper's identity check resolved the verified principal
with its live membership for the body's project, applied the chat policy's role gate and (in production) the same-origin CSRF check, and
after the context was assembled and the server-owned component authority loaded - and before any provider call: before the minter, the
gateway and the adapter are built (C3). A viewer is refused by the role gate and a cross-origin POST by CSRF before the record is read
(route case 3). Flag off, or no key, or a `null` key: a fresh run, nothing read (C20).

**The closed refusals**, in the order they are decided - each a JSON answer `{ ok: false, error, code }` with no stream and no run id
(C10-C12):

| code | status | when |
|---|---|---|
| `resume_malformed` | 400 | the value is not a run id this route issues |
| `resume_unavailable` | 503 | FOR NOW: the record's read timed out, was aborted or failed, or the request's start could not be written - a claim whose outcome is unknown has its end marked (section 3); each call bounded (C15, C16). The next send of the same message tries again |
| `resume_unusable` | 409 | FOR GOOD ([B21 E3 fix: coverage-7]): no durable record is bound (C21), the record fails the store's verification (`record_mismatch`, C17), or the record refuses the start - the run reached its bound of requests (C31). The next send is a new run |
| `resume_unknown` | 404 | no coordinator entry for this run id in THIS tenant, project and branch (the lookup is scoped to the verified scope) |
| `resume_foreign` | 403 | the run's owner digest - the verified principal and the scope (C18) - is another principal's |
| `resume_mismatch` | 409 | another user message (`userInstructionDigest`, the digest the B18 grant binds) or another provider: the coordinator never switches provider mid-run (`route.ts:14-15` stands, C116) |
| `resume_plan_changed` | 409 | the router's plan for this message under THIS request's facts is no DAG, or not the recorded plan (C19; the scheduler's own `plan_mismatch` would refuse it too, C85) |
| `resume_completed` | 409 | the run's follow-up turn already answered: the run is finished |
| `resume_in_progress` | 409 | another request of the run still holds it (section 3, "One request of a run at a time") |

The owner is decided before anything else about the run (C23): another principal is `resume_foreign` whatever else is wrong - another
message, another provider, a changed plan, a run another request holds, a finished run - and nothing is written (runtime case 14), so
another principal learns nothing about the run's message or state. RECORDED: a member of the same project can tell a foreign run id (403)
from an unknown one (404); run ids are random UUIDs the route issues only to the requester, never listed. An accepted resume REUSES the
run id (C4) - the stream's `X-Sirkit-Run-Id`, the trace's run id, the minter's and the scheduler's - and `resumeChatRun` hands the grant
to the runtime keyed by THAT request object (C5, C32; a grant for another run id is ignored, C33, runtime case 8). No new route; the
route-policy census stays 165 = 162 canonical + 3 factories + 0 raw; CSRF, the bounded reader and the role gate are the wrapper's,
unchanged.

## 2. The resume record

`agent.orchestration-resume.v1` (C62), schema `sirkit.orchestration-resume-record.v1`: one aggregate per coordinator run, scoped by
tenant, project and branch, on the SAME repository as the run's record (derived from the durable record by `orchestrationResumeStoreOf`,
C78 - a store double or the unavailable default has none: then nothing is recorded, a DAG run is unchanged and a resume is
`resume_unusable`). Every append is a compare-and-set commit of an entry judged closed (C72), idempotent by the entry's key (C68), with
no outbox effect; every load checks the aggregate and scope it was read under, recomputes the record digest, re-judges the entry - its
closed keys, its fields, a coordinator answer's digest and encoding - and answers any disagreement with the one sentence
`AGENT_ORCHESTRATION_RESUME_MISMATCH` (C74, C77; record case 5 forges entries WITH their record digest recomputed, so the re-judgement
is what refuses them). The closed entries (C63):

| entry | key | written by, when |
|---|---|---|
| `coordinator` | `orchestration-resume:<runId>:coordinator` | the runtime, when a fresh DAG run's first turn completed and BEFORE any specialist is planned (C53): the owner, message, provider and plan as digests, the final text (encoded), the artifact events the first turn emitted (at most 4, each a closed event name). It is also the start of the run's first request (ordinal 0). A write that fails stands the run down before any specialist: a run that could never be resumed runs none (runtime case 7). |
| `artifact` | `orchestration-resume:<runId>:artifact:<userMessageDigest>` | the runtime, when the merge's rule would present a specialist's action (section 4): the task, attempt, action index, artifact kind and digest, and ([B21 E3 fix: coverage-5], C66) the ordinal of the request that claimed it. The key IS the ledger. |
| `follow-up` | `orchestration-resume:<runId>:follow-up` | the runtime, when the follow-up turn answered (C58): its answer's digest. The run is finished. |
| `resume` | `orchestration-resume:<runId>:resume:<n>` | the route's resolution, when a resume is granted: the request's start, ordinal 1, 2, ... past every start AND end on the record (C28) - claimed by compare-and-set against the head the resolution READ (C29, C76), carrying the claiming request's own claim id (a digest of a fresh nonce; [B21 E3 lead], C123, C124). |
| `settled` | `orchestration-resume:<runId>:settled:<n>` | the runtime, at every end of a request but the follow-up's answer - a stand-down, a cancellation, a throw - before it leaves the runtime (C42), with ([B21 E3 fix: coverage-5], C67, C71) whether THAT request presented the message's artifact; and the route, for a start claim whose outcome is unknown (C30). |

**The answer.** The first turn's final text is stored WHOLE and EXACTLY by `encodeResumeAnswer` (C69): its JSON text with every
control, format and separator character written as an escape, so the stored string passes the orchestration text rule and a jsonb
column (a NUL and a lone surrogate included) and decodes to the same text; its digest is kept in every case. It is WITHHELD - null, with
a closed reason, `answer_too_long` or `answer_refused` - when it is over 60 000 characters (C64, C65) or holds a credential-shaped value
(C73): the redaction authority's shared rule (`containsTokenAnchoredSecretShapedText`, unchanged) and, [B21 E3 fix: security-1], the
record's OWN shapes (`ORCHESTRATION_RESUME_CREDENTIAL_SHAPES`, C79, C80): a PEM private key, an AWS key id, a GitHub or Slack token, a
JWT, a URL with a password, a lower-case `*_secret=` / `*_token=` / `password=` pair - every quantifier bounded, so a hostile answer at
the bound is judged at once (record case 8). A false positive only replays the closed placeholder (section 3); a resume then replays no
text. Bounds: at most 4 coordinator artifact events per entry, at most 1 000 requests of a run (ordinals), attempts and action indexes
within the run record's own bounds.

**Why not a `decision` record in B21-B's store.** The task allowed it ("persist the first turn's final text as a `decision` record in
B21-B's store, or state precisely why not"). Precisely why not: (1) that store's records are closed: its kinds are `plan`, `request`,
`result`, `decision`, `dissent`, and a `decision` is a verdict `{ decision, reason, subjectDigest }` whose `decision` is one of six
verdicts and whose `reason` is bounded to 1 000 characters under the orchestration text rule (no control character, so no newline) - a
coordinator's answer (up to 60 000 characters, with newlines) fits it only by widening A's pinned record (`b21-a-store.test.ts` cases 1,
3 and 12); (2) its keys are task attempts, `orchestration:<runId>:<taskId>:<attempt>:<kind>` - the owner binding, the one-artifact claim
per message and the request starts have no task, and would need an invented task id; (3) the scheduler reads that history for its plan
check and replays, the merge chains its verdicts in it, and B's, D's and D3's suites read and count it. A sibling aggregate on the same
repository keeps all of that untouched (the record suite's case 1 reads the run's own history empty beside it) - the precedent E2b set
for the per-task trace records.

The store module still names no route, executor or minter (`b21-a-store.test.ts` case 12 green); its one new import name joins the
module's existing import of the redaction authority in place (C61).

## 3. The resumed run

**The first turn, replayed.** `replayFirstTurn` (C36), in place of the coordinator's loop (C50): `run_started`, the request's context
warnings, one line, the recorded answer as ONE final text, and the terminal held for the runtime with 0 steps - no model call, no tool,
no minter use. The line (C34, whole on the coordinator's trace: at most its 300-character warning bound):
"Orchestration: resumed run <runId>: the first answer is replayed from the record, no model call; each committed specialist result still current is replayed, one whose design, selection or seal lifetime moved runs again; the follow-up turn runs once."
The coordinator's own first-turn artifact is NOT re-emitted (the human received it once); its event names ride the grant, so the
specialists stay read-only (section 4). A withheld answer replays no text, and the follow-up turn's conversation carries the closed
placeholder (C35): "(The coordinator's first answer of this run was not recorded (answer_refused) and is not replayed.)" RECORDED: the
follow-up's conversation is the resuming request's own history as the page sends it - which already holds the first request's exchange
- then the message and the replayed answer, so the model sees that exchange twice.

**The specialists, replayed or re-run against the LIVE head.** The scheduler runs under the SAME run id: the recorded plan must match
(C85), the plan event is emitted again (C86), and each task's LAST committed result is replayed - "replayed from the record ... it did
not run again" - only when the request it answered was bound to the scope of THIS request (`requestScope`, C84, C89, C90); otherwise it
is STALE: a dissent is written and the task runs again at a new attempt (C91), and so is a result the merge judged stale or expired
earlier (D21-17's regenerate signal). The scope is THIS request's verified context: the canonical revision digest the route recomputes
over the board the request carries (C119), the schematic head mark and the PCB basis as labels. **[B21 E3 fix: security-2, coverage-2]
A route-level resume binds a replay to more** - the runtime marks the coordinator run `resumed` (C54, C87) and the scheduler's blocker
(C88, C92, C95) holds a result bound to this scope back when: (a) one of `RESUME_REPLAY_CONTEXT_REFS` moved (C94) - the schematic, the
selection or the netlist digest the specialist was handed (`stale_context`; runtime case 16: the same design under another selection
re-runs all four); or (b) one of its seals expires within `RESUME_REPLAY_APPROVAL_WINDOW_MS` (120 000 ms, C93) of the resumed DAG's
DEADLINE - the later of the scheduler's clock and the coordinator's start plus the DAG wall time ([B21 E3 lead], C125) - (`stale_lifetime`): OD-107 keeps the DAG wall time inside the 10-minute proposal TTL minus that 2-minute approval window so
nothing the DAG seals expires before the human sees it, and a resume restarts the wall time, so a REPLAYED seal is held to the same bound
(runtime case 17: one minute left - the schematic specialist runs again and its fresh seal is presented; three minutes left at the
deadline - it replays; runtime case 20: six minutes left when the replay is decided but one at the deadline - it runs again). The component authority the route loads server-side for this request (C118) is deliberately NOT part of the replay key: a
replayed seal is re-judged by the merge against the authority AS LOADED FOR THE RESUMING REQUEST, and a part review is asked for when it
moved (OD-130, section 5 - D21-16's route half needs exactly that replay); a replayed result's claims about parts stay its specialist's
own unverified claims, labelled so in the envelope (RECORDED; runtime case 16 replays all four under the catalog's earlier authority).
A scheduler-level resume (B's seam; the suites that call the scheduler directly) keeps B's rule unchanged. **What "the LIVE head read
at resume time" is:** the chat path has no server-side durable schematic head to re-read - the editor context is the page's local
working copy, `authoritySource` "local-working-copy" (C120) - so the live head is the head the resuming request carries, verified by the
route, the same head every apply re-verifies against; the first request's snapshot is never read back (the record holds digests only).
The merge of a resumed run judges against it (runtime case 6, route case 7: the envelope's `scopeDigest` IS the new head's and never the
first's, every committed result STALE and re-run, the one proposal sealed against the new head presented - the ledger held nothing yet).
Each specialist that runs again opens its task's next trace document beside the first request's (D21-3's calls, runtime case 6).

**The follow-up turn runs ONCE.** When it answers, the runtime records the `follow-up` entry before the terminal (C58); every later
resume is `resume_completed`. A resumed request's one terminal counts only its own steps (the replayed first turn has none). A
`follow-up` write that fails is one line on the stream and the trace (within the recorder's shared 32-warning bound: past it the trace
records `trace_event_capacity_reached`; the stream always carries the line) - "a resume of this run would answer again" - and the
request's start is settled instead (runtime case 11: the resume is then granted).

**One request of a run at a time.** Every request of a DAG run has a START on the record - a fresh run's coordinator entry (ordinal 0),
a resume's `resume` entry (ordinal n) claimed by compare-and-set against the head the resolution read (C29): of two resolutions that
read one head, exactly one commits and the other is `resume_in_progress` (record case 7, runtime case 9, route case 9), and a claim
loses when ANY other entry landed after its read - a request past its lease answering its follow-up - which the key alone would not
catch ([B21 E3 fix: tests-3], runtime case 13). Every way a request ends but the follow-up's answer - every stand-down, the cancellation
and ([B21 E3 fix: regressions-2]) a throw past the runtime, which the route's catch answers with `stream_error` (`settledOnThrow`, C45,
C46, C49) - writes its `settled` entry BEFORE its terminal is emitted or the throw leaves the runtime (C42, C47, C51, C52), so the page's
offer (section 6) can be taken at once (runtime case 15, route case 11). A resume while the latest start is unsettled is
`resume_in_progress` (C27) - until that request settles, or its start is `RESUME_LEASE_MS` (600 000 ms) old (C14): a request of a DAG
run lasts at most the DAG wall time from its start (300 s, OD-107, the first turn inside it) plus the follow-up turn's own deadline
(120 s) plus its bounded record writes, so an older unsettled start is a request that died without settling (a crashed process). Every
read and write of the resume record is bounded by `RESUME_RECORD_DEADLINE_MS` (10 000 ms) (C15, C16; [B21 E3 fix: tests-2] the
deadline is injectable for a test through `recordDeadlineMs`, C44, and runtime case 12 proves every write bounded against a repository
that never answers); a driver's message never leaves it. [B21 E3 fix: coverage-5] A call that timed out is UNKNOWN, never taken as
unwritten - it may still land: a start claim of unknown outcome has its end marked (C30) - only its OWN ([B21 E3 lead], C122: the marker re-reads the record and
settles the ordinal only when no start of it is there or the start there carries this request's claim id, by compare-and-set against
the head re-read; two requests that read one head claim one ordinal, and a marker keyed by the ordinal alone would settle the winner's
running start and swallow its real end - runtime case 19) - and every later ordinal is past every end (C28), so a late claim never
holds the run (runtime cases 11 and 18); a ledger claim of unknown outcome is section 4's. RECORDED: a request that
dies after its claim holds the run until the lease passes; a `settled` write that fails is one line on the stream and the trace (within
the recorder's shared 32-warning bound: past it the trace records `trace_event_capacity_reached`; the stream always carries the line) -
"the end of this request could not be recorded ..." - and the same lease applies (runtime case 11); the scheduler's own record writes are
not deadline-bounded (E2b's lesson), so a repository that hangs a request past the lease would let a resume start beside it.

## 4. The userMessageDigest ledger (OD-122 across resumes)

- **The specialists' artifact.** When the merge's deterministic rule would PRESENT one accepted, sealed-in-run action, the runtime first
  claims the message's one artifact on the record (C38, C55) - [B21 E3 fix: regressions-1] once the merge's verdicts and lines stand, so
  a claim that fails still leaves the run's partial result judged by the merge (runtime case 10: `mergeWithheld` counted, never null):
  the key `orchestration-resume:<runId>:artifact:<userMessageDigest>` commits once per run and message. A claim that reads back as a
  replay means an earlier request of this run claimed it, and the decision is `already_presented` (C56, C59) - appended LAST to the
  approval outcomes and decided in `presented`'s place only, never outranking any other outcome (C81-C83): `presented`, `coordinator_sealed`, `escalated`, `review_requested`, `contradicted`, `incomplete`, `none_accepted`, `several_accepted`, `already_presented`.
  Its line: "nothing from the specialists is presented for approval (already_presented): an earlier request of this run presented this
  user message's one artifact, or its end is not recorded (OD-122's ledger presents at most once), so nothing is presented twice." A
  claim that cannot be written stands the run down (the degraded reason `merge_unrecorded`, the closed vocabulary's) with its OWN line
  (C39) - one line on the stream and the trace (within the recorder's shared 32-warning bound: past it the trace records
  `trace_event_capacity_reached`; the stream always carries the line): "the user message's one artifact could not be claimed on the run's
  resume record (...); nothing was presented" - never B21-D's "the merge could not record its decisions" (the merge did); nothing is
  presented unrecorded (a resume could otherwise present it again). Runtime case 4 and route case 6: the schematic specialist's
  replacement presented ONCE by the first request; the resume replays its seal, the merge accepts it again, and nothing is presented.
- **A void claim ([B21 E3 fix: coverage-5]).** The claim carries the ordinal of the request that made it, and every request's end says
  whether THAT request presented the artifact (C57, C67). A claim that reads back as a replay is VOID - this request presents it - only
  when every request since the claiming one (this one aside) recorded an end that presented nothing (C40): a claim that timed out but
  landed, whose request stood down with nothing presented (runtime case 18: the next request presents it, and a later resume finds that
  presentation, `already_presented`). An end that is not recorded - a request that died, or whose end did not land - or a record that
  cannot be read counts as presented (at most once; runtime case 18).
- **The coordinator's own artifact.** Its event names are recorded with its turn; a resume hands them to the scheduler (`artifactHeld`),
  so every specialist stays read-only (the held-artifact notice) and the decision is `coordinator_sealed` - the artifact itself is never
  re-emitted (runtime case 5, route case 6).
- **Scope.** The run and the message: a resume must carry the run's message (`resume_mismatch`), so the ledger is per run; a message
  sent again WITHOUT `resumeRunId` is a new run with its own ledger, as before E3 (RECORDED). **At most once:** the claim is committed
  before the event reaches the stream, so a stream cut between them loses that presentation for the run, as does a presenting request
  whose end is not recorded (RECORDED; section 9 names the owner's alternative). **A moved head ([B21 E3 fix: tests-8]).** After the first
  request presented P1 against head H1, a resume under an edited design H2 re-runs every specialist, and the one seal against H2 is
  accepted but withheld: `already_presented` (route case 10). The human's only presented artifact is then P1, stale against H2: its apply
  is refused by its family's own currency check, and a proposal against H2 needs the message sent as a new run - RECORDED, with the
  owner's alternative in section 9 (present again when the presented artifact is stale against the live head).
- **OD-122's D2 clause, now reachable:** its INFERRED clause "a scheduler-level replay of an earlier committed result keeps its own
  seal; the route never replays" - the route now replays: a replayed result keeps its seal, and the ledger decides whether it is
  presented (CONFIRMED, runtime case 4).

## 5. OD-130's part review from a production POST (D21-16's route half)

Before E3 the part review rendered at the route's envelope only through the scheduler seam and was CONFIRMED-unreachable from a
production POST: in one route run the replacement's sealer seals only the exact target of the authority the merge reads, and the route
never resumed (`specialist-replacement.md`, D3's route case 7). Through the resume it is reachable (route case 8): the first POST runs
while the catalog's exact authority for U1 is its EARLIER part (the route's server-owned component-authority load answering the D3
fixture's `earlierAuthority` - a complete, consistent verified-exact record - through its module seam, as the route suites double the
adapters); the schematic specialist seals that target, the merge accepts it and the run presents it; the follow-up fails (a stand-down).
The catalog's authority then moves back to its exact target and the human resumes with the same message: the scheduler replays the
committed seal (the design, the editor selection and the netlist did not move and the seal outlives the approval window; the authority is deliberately
not part of the replay key, section 3), and the merge judges it against the authority AS LOADED FOR THE RESUMING REQUEST - contradicted
(`part-not-exact-authority`), a part review request recorded for `request_atomic_review`, the stream's part review line naming the
earlier part, the exact authority and the path, NO artifact event, and the envelope's approval `review_requested`. **CONFIRMED** (route
case 8). D21-16's route half closed.

## 6. "Resume" on the chat surface: a run-log line (OD-127)

- **What the page learns.** The page folds each event into a small observation beside the run view (C97, C113): a `plan` event (the
  record exists) and a stand-down - a `degraded` event whose reason is one of `runOrchestratedChat`'s stand-down reasons (C96): `follow_up_failed`, `follow_up_paused`, `merge_unrecorded`, `no_specialist_ran`, `no_usable_result`, `provider_outage`, `provider_paused`. It reads the run id the route
  issued from `X-Sirkit-Run-Id` (C112).
- **The offer.** A DAG run that ended WITHOUT its follow-up's answer - stood down, stopped, cut, cancelled or failed after its plan -
  under a run id the route could have issued (C98) leaves ONE run-log line after the status line (C100, C114), naming the provider the run
  is bound to ([B21 E3 fix: coverage-1]) and promising only what every resume keeps ([B21 E3 fix: coverage-4]):
  "Resume: send the same message again on <provider> to resume run <runId> - its first answer is replayed from the record unless the record withheld it, and so is each committed specialist result that is still current; one whose design, selection or seal lifetime moved runs again (paid), as does one that did not finish."
- **The resume.** The next send of the SAME message on the SAME provider in the SAME project and branch (C99) carries `resumeRunId`
  (C110) and opens its run log with one line before "Calling assistant" (C101, C109):
  "Resuming run <runId>: its first answer is replayed from the record unless the record withheld it, and so is each committed specialist result that is still current; one whose design, selection or seal lifetime moved runs again (paid), as does one that did not finish."
  Anything else is a new run. Every send spends the offer (C108) - except a resume the route refused only for now,
  `resume_in_progress` and `resume_unavailable` (C102, C103, C111): the page reads the code from a CLONE of the refused response before
  the shared error path reads the body, keeps the offer, says so again in that send's log, and the next send of the same message tries the
  resume again; every other refusal - `resume_unusable` included, [B21 E3 fix: coverage-7] - says to send the message as a new run, and
  the next send is one.
- **After a reload ([B21 E3 fix: coverage-1]).** The run log is saved with the project and restored on a reload or when the project is
  opened again, so a send that holds no offer in memory reads the LATEST chat send's log back (`restoredChatResume`, C104, C108): its
  offer line names the run id and the provider, the user message before that log is the text, and the project and branch are the log's
  own; a later chat send spends it whatever its outcome, another kind of log does not (offer case 6). RECORDED: a run cut by the reload
  itself (in flight) wrote no offer line, so it is not offered after the reload - its record stands, and the same message sent again is a
  new run; an offer line in an older log is the record of what was offered then, never taken again.
- **The Retry card.** No new control: the recovery card's Retry IS `send(text)` (C117, C121), so where the card shows for this message
  its Retry resumes the offered run too. A DAG run that stands down ends `run_completed` (its first answer stands), so the card is not
  shown for it - the offer line is the surface.
- **The page, in place.** Ten lines changed in place and none added (every line an earlier page cites stays where it was: this page's
  case 5 and the B20 page suites check each cited line; offer case 4 finds no JSX on a line of E3's wiring), no control: the B17-A control
  inventory regenerated with zero drift and the B18-D UI gates green (their wires untouched).

## 7. What E3 does NOT do

- No composer routing (D21-38) and no first-turn breaker (D21-39): B21-E4.
- No new route (the census stays 165 = 162 canonical + 3 factories + 0 raw), no new control, no new run-event type (the five stand), no
  protocol change (v1), no new exposed tool, descriptor or generator input; the one new body key is admitted under the flag beside the
  closed set - `ALLOWED_BODY_KEYS` itself is unchanged, and a flag-off request is byte-identical to HEAD's.
- No edit to the nine B11-scanned files and no change to `redaction.ts`; no change to the trace contract, the loop or the adapters.
- No change to the router or the merge's judgements (the approval decision gains one outcome, appended and decided last); no change to
  the run's own record. The scheduler's replay rule gains, for a ROUTE-LEVEL resume only, the context and seal-lifetime blocker
  ([B21 E3 fix: security-2, coverage-2]; in place on lines 109, 462, 469 and 473, the rest appended) - a scheduler-level resume keeps B's
  rule, and every line the earlier pages cite in `scheduler.ts` keeps its anchor.
- No cross-run ledger: a message sent again without `resumeRunId` is a new run with its own ledger (RECORDED, section 4).
- No weakening of CSRF, the bounded reader, the role gate, a pin or the ratchet; no reserved-file edit (the texts are in section 9).
- No retention or access-audit setting for the resume record (OD-111's deferral stands, RECORDED; the question is in section 9).
- No live model: BLOCKED-LIVE-QUALIFICATION (LB-9).
- [B21 E3 lead] RECORDED: while the resume record is unreachable (a repository down or timing out) every send of the same message is
  `resume_unavailable` (503) and the offer is kept - a new run would at least answer; another message is a new run. A permanent failure
  below the resume store whose message is not the store's mismatch sentence is taken as transient too.
- [B21 E3 lead] RECORDED: a route-level resume binds a replay to the editor selection, so any change of selection re-runs and re-pays
  every specialist on the resume.
- [B21 E3 lead] RECORDED: the first answer's credential shapes are a denylist (PEM and PGP private keys, AWS key ids, GitHub and Slack
  tokens, JWTs, URL passwords, lower-case secret pairs); a credential of another shape in the first answer is stored with the record
  (the shared redaction rule, unchanged, still covers the rest of the orchestration text).
- [B21 E3 lead] RECORDED: a synchronous throw between the route's start claim and the runtime's settle-on-throw guard (none is known:
  the minter, the gateway, the adapter and the trace recorder are built there) would leave the start unsettled - it then holds the
  run until the lease passes, never presented twice.

## 8. Suites, evidence, the pin moves, gates

| suite | `it(` blocks | what it proves |
|---|---|---|
| `app/lib/agent/orchestration/__tests__/b21-e3-resume-record.test.ts` | 9 | the five closed entries round-trip digest-verified, the run's own history untouched (1); the keys ARE the ledger (2); the answer whole and exact through a jsonb-refusing repository, withheld over the bound or credential-shaped (3); every malformed or hostile entry one closed refusal, nothing written (4); every load verified, forged entries refused by their re-judgement (5); the store derived from the durable record only (6); a request's start claimed by compare-and-set against the head read, one of two concurrent claims (7); the record's own credential shapes, linear (8); a claim's ordinal and an end's `presented`, closed (9) |
| `app/lib/agent/orchestration/__tests__/b21-e3-resume-runtime.test.ts` | 20 | through the REAL runtime: a fresh run's coordinator turn recorded before any specialist, its stream unchanged (1); the closed refusals in order, a granted resume's claim (2); the first turn replayed, every specialist replayed, the follow-up once (3); one artifact per message across resumes (4); the coordinator's own artifact across resumes (5); the LIVE head and the stale re-run, the next trace document (6); an unrecordable turn stands down, a withheld answer replays no text (7); the grant for THAT request only (8); one request of a run at a time (9); a failed ledger claim after the merge judged (10); every other failed write visible, `resume_unusable` (11); every write bounded (12); the claim's compare-and-set (13); the owner first (14); a throw settles (15); the selection binds a replay, the authority does not (16); a seal must outlive the approval window (17); a timed-out write is unknown, a void claim (18); [B21 E3 lead] a start claim of unknown outcome marks only its own end (19); the approval window measured at the DAG's deadline (20) |
| `app/lib/agent/orchestration/__tests__/b21-e3-resume-offer.test.ts` | 7 | the stand-down reasons ARE the runtime's (1); what is resumable (2); the next send resumes only the same message, provider, project and branch (3); the page's wiring, in place, no JSX on it (4); a resume refused only for now keeps its offer (5); the offer read back after a reload (6); the lines are true whatever the resume finds (7) |
| `app/lib/agent/orchestration/__tests__/b21-e3-page.test.ts` | 10 | this page |
| `app/api/chat/__tests__/b21-e3-chat-resume.test.ts` | 11 | through the production POST: flag off byte-identical and the key refused as HEAD refuses it (1); malformed and unknown, another project's run unknown (2); foreign, and the role gate and CSRF first (3); mismatch (4); the resume end to end (5); one artifact per message (6); the LIVE head (7); OD-130's part review (8); one request of a run at a time (9); the ledger across a moved head (10); a `stream_error` settles (11) |
| `app/lib/agent/orchestration/__tests__/b21-d2-approval.test.ts` | 10 | D2's cases; case 6's outcome list moved: `already_presented` appended, with its reason beside it |

**Adopted work.** The interrupted run left eleven changed files and four new suites (`e3adopt/start.sha256` records their hashes as
found). Each was read against HEAD `b4a0ec5` (`git diff`), every citation of the changed production files grepped in `artifacts/`, and
every change checked for scope and for being line-neutral above cited lines (`route.ts` 35, 140, 366-367, 508; `orchestration-runtime.ts`
21-22, 230, 237, 239, 250, 252, 258, 281-282, 314, 464-465, 470; `store.ts` 34; `merge.ts` 1052-1053, 1060, 1071; `page.tsx` 62, 2567,
3103, 4450, 4473, 4519, 4523-4524, 4544, 4741 - ten lines, every one in place; `chat-run-view.ts` appended). Kept: the body key beside the
closed set, the closed refusals, the resume record beside the run's, the replayed first turn, the ledger's claim and `already_presented`,
the follow-up entry, the offer line and the runtime, route and record suites' cases; the D2 pin move (its reason written); the dated notes
on the B, D2 and D3 pages. Changed: one request of a run at a time (the interrupted design let two concurrent resumes - or a resume beside
a still-running first request - both run the uncommitted specialists and the follow-up turn, paid twice: the `resume` and `settled`
entries, the compare-and-set claim, the lease, `resume_in_progress`; record case 7, runtime case 9, route case 9, the refusal and entry
tables); the store's load now checks the aggregate and scope it was read under (the E2b review's scope-binding lesson); a transient
refusal keeps the page's offer (offer case 5); runtime case 6 also proves the re-run specialist's next trace document; the double blank
line in the store's appended header removed. Added: this page and its suite. Dropped: nothing of the interrupted run's code.

**Review fixes.** An adversarial review of the adopted work CONFIRMED twenty findings (three rated
medium - coverage-1, coverage-2, tests-1 - the rest low). Each was fixed test-first: the test was written against the adopted code and run red (logs under the scratchpad's
`b21/e3fix/`: `red-1.log`, the new cases against the adopted tree; `red-2-prefix.log`, `red-3-prefix-case17.log` and
`red-4-prefix-security1.log`, the corrected cases against the adopted production files swapped back in by copy and restored by sha256);
a test-strength finding's strengthened test was proven by a deliberate breakage of the source applied alone (`mutate.py`, `prove.sh`:
each mutation restored and every fixed file verified by sha256 before the next).

| finding | test | failing first | fix | green |
|---|---|---|---|---|
| regressions-1 | runtime case 10 | red-2: the stand-down said "the merge could not record its decisions"; the partial result's `mergeWithheld` null | the merge's lines and verdicts stand before the claim (`orchestration-runtime.ts` 282 in place; 281 back to HEAD's line); the claim's own line (C39) | yes |
| regressions-2 | runtime case 15, route case 11 | red-2: the record `['coordinator']` with no `settled:0` after a throw past the plan | `settledOnThrow` guards the DAG path (line 215 in place, the guard appended; C45, C46, C49) | yes |
| regressions-4 | page case 9 | red-1: one always-recorded claim, no bound stated | the recorder's shared 32-warning bound stated beside each | yes |
| security-1 | record case 8 | red-4: a PEM private key stored whole | the record's own credential shapes, bounded (C73, C79, C80) | yes |
| security-2 | runtime case 16 | red-2: under another selection all four results replayed | a route-level resume's context blocker; the authority deliberately excluded and the page corrected (section 3) | yes |
| coverage-1 | offer case 6 | red-1: `restoredChatResume` missing; the page kept the offer only in memory | the offer read back from the saved log (C104, C108), the line names its provider, a kept offer said again (C111) | yes |
| coverage-2 | runtime case 17 | red-3: a seal with one minute left replayed | the seal-lifetime blocker (`RESUME_REPLAY_APPROVAL_WINDOW_MS`, C93) | yes |
| coverage-4 | offer case 7 | red-1: the lines promised nothing re-run or re-paid | the offer, resuming and resumed lines conditional | yes |
| coverage-5 | record case 9, runtime cases 11 and 18 | red-2: a claim with no ordinal accepted; the next ordinal reused (1, not 2); mutation `claim-never-void`: the void claim never presented | a claim's ordinal, an end's `presented`, `voidClaim` (C40), ordinals past every end (C28), a claim of unknown outcome marked ended (C30) | yes |
| coverage-6 | page case 10 | red-1: "nine" against ten rows | the count ten, pinned against the citation table | yes |
| coverage-7 | runtime cases 2 and 11, offer case 5 | red-2: eight refusals, a tampered record `resume_unavailable` | `resume_unusable` for good (C11, C17, C21, C31); the page spends the offer on it | yes |
| tests-1 | runtime cases 10 and 11 | mutation `claim-failure-ignored`: runtime cases 10, 12 and 18 red | (the guard stands) | yes |
| tests-2 | runtime case 12 | red-2: the deadline not injectable (10 s); mutations `writes-unbounded` and `claim-unbounded`: case 12 timed out | `recordDeadlineMs` (C43, C44), every write through it | yes |
| tests-3 | runtime case 13 | mutation `claim-without-cas`: "expected 'resume' to be 'resume_in_progress'" | (the compare-and-set stands) | yes |
| tests-4 | runtime case 14 | mutation `owner-after-message`: "expected 'resume_mismatch' to be 'resume_foreign'" | (the order stands) | yes |
| tests-5 | runtime case 2, offer case 5 | red-2: a tampered record kept the offer (`resume_unavailable`) | as coverage-7 | yes |
| tests-6 | record case 5 | mutation `load-not-rejudged`: "promise resolved ... instead of rejecting" (the adopted case passed under it: its tampering never recomputed the record digest) | forged entries carry a recomputed record digest | yes |
| tests-8 | route case 10 | mutation `ledger-never-withholds`: route cases 6 and 10 presented a second artifact | (the ledger stands; the consequence recorded, section 4) | yes |
| tests-9 | offer case 4 | mutation `page-line-appended` green (the dropped length pin failed on it); `jsx-on-wiring` red | the snapshot length pin dropped; no JSX on E3's wiring lines | yes |
| tests-10 | page case 8 | mutation: a U+200B and a U+0085 in this page - red (the adopted scan passed them) | every control, format and separator character refused (TAB and LF alone allowed) | yes |

**Test-first, the adopted run** (logs under the scratchpad's `b21/e3adopt/`; the interrupted run's own red and green logs,
`b21/e3-red.log` and `b21/e3-green2.log`, stand beside them). (1) The five E3 suites and D2's approval suite ran against HEAD `b4a0ec5`'s
production files and pages, swapped in by copy (`git show`, never a checkout; this page moved away) and restored by sha256
(`swap-head.sh`, `restore.sh`): `red-1-head.log` - 39 of 48 failing: every one of the 38 E3 cases of that time and D2's approval case 6
on its old outcome list; the nine green are D2's other cases. (2) Each piece the adopting run added to the interrupted design was then
removed in place (`mutate.py` there: M1 the claimed start and the in-progress rule, M2 the settled end, M3 the compare-and-set against the
caller's head, M4 the transient keep, M5 the load's aggregate and scope binding) and the four code suites re-run (`red-2-mutated.log`):
6 of 30 failing, exactly the cases that pin them; restored by sha256 (every file OK). (3) Green: `green-final.log` and the gates below.

**Pin moves, each with its reason written next to it.** `b21-d2-approval.test.ts` case 6: `SPECIALIST_APPROVAL_OUTCOMES` gains
`already_presented`, appended last (OD-122's ledger across resumes; decided in `presented`'s place only - runtime case 4). The CI
workflow: ONE explicit `prompt-to-gerber` entry for the route suite (C115), after E2's; the four orchestration suites ride the
`app/lib/agent/orchestration/__tests__` filter; no suite starts PGlite. Not pin moves: the dated E3 notes appended to the blocks of
`task-complexity-router.md`, `specialist-proposals.md` (and its table's new last row, which its own suite reads as the outcome list) and
`specialist-replacement.md` that E3 made untrue (no line those pages' suites pin moved; their page suites green); the E2 page's pin of the
stale line (`b21-e2-run-events.test.ts` case 7) is untouched - a stale result for the reasons it names keeps that sentence, and only the
route-level resume's new reasons say theirs.

**Gates** (after the review fixes; one heavy job at a time through the lock runner; logs under `b21/e3fix/gates/`, the chain
`gates.sh`): every B21 suite with the seven route suites and the CI job-scope guard (`gate-b21.log`: 47 files, 438 of 438, every A..E3
page suite included); `app/api/chat/__tests__`, `app/lib/llm/__tests__` and `app/lib/acquisition/__tests__` in full (44 files, 376
passed and the one opt-in live file's 2 cases skipped as before); `app/lib/agent/__tests__` with the engineering exposure and tier
suites, the B17-A control inventory and the B18-D UI gates (63 files, 646 of 646); `app/lib/project/__tests__` with
`app/components/chat` (39 files, 312 of 312); the proposal families and approval paths (34 files, 513 of 513); the import gates, census
ratchets and route matrices (10 files, 104 of 104 - the route-policy census 165/162/3/0 unchanged); `app/lib/mcp/__tests__` with
`app/api/mcp/__tests__` (33 files, 737 of 737 - the B20 pages' citations into `route.ts` and `page.tsx`) and `app/lib/mcp/server/__tests__`
(19 files, 183 of 183 - the b20-b2 nine-file pin among them); tsc 0; eslint on the 13 changed and new TypeScript files: `app/page.tsx`'s
14 pre-existing `react-hooks/refs` errors (lines 1266 to 7792, the same lines as at the adoption, none of E3's ten lines), the other
twelve files clean. Zero drift, the outputs snapshotted by sha256 first: the B11 generator (19 of 19 cases, 61 of 61 checks) and the B09
agent artifacts (the 21 files byte-identical), the B17-A inventory generated into the scratchpad (628 controls; the CSV and the summary
identical to the committed ones); the tree's status unchanged by the generators. No descriptor, route, request key, run-event type,
control or generator input changed; the nine B11-scanned files and `redaction.ts` byte-identical to HEAD.

**The lead's follow-up on the check ([B21 E3 lead], 2026-09-28).** The check confirmed eighteen of the twenty fixes fixed and
revert-sensitive and raised two new low issues and five residuals; the lead fixed: (1) a start claim of unknown outcome marks only its
OWN end - every `resume` entry carries its request's claim id (C123, C124) and the marker re-reads and settles by compare-and-set only
when no start of that ordinal is there or the start there is this claim's (C122; runtime case 19: a loser whose write failed leaves the
winner's start unsettled, the winner's own end lands with `presented`, a start without a claim id is refused); (2) a replayed seal's
approval window is measured at the resumed DAG's deadline (C125; runtime case 20: six minutes left when the replay is decided, one at
the deadline - re-run; case 17's in-time contrast moved to three minutes left at the deadline); (3) the PEM shape also matches a PGP
private key block (record case 8); (4) the offer and resuming lines say the first answer is replayed unless the record withheld it
(offer case 7); (5) route case 8 and this page say the catalog's AUTHORITY moved, never the editor selection (section 5, D21-16's
clause). Each fix reverted alone turned its case red and was restored by sha256 (`b21/e3lead/prove.py`, `red-*.log`: 5 of 5); section
7 records the rest (the offer kept while the record is unreachable, the selection binding's re-pay, the denylist, the
synchronous-throw window). Lead gates: every B21 suite with the seven route suites and the CI guard (47 files, 440 of 440); `app/api/chat`, `app/lib/llm` and
`app/lib/acquisition` in full (44 files: 376 passed, the opt-in live file's 2 skipped as before); `app/lib/agent` with the exposure
and tier suites, the B17-A inventory and the B18-D UI gates (63 files, 646 of 646); `app/lib/project` with `app/components/chat` (39
files, 312 of 312); the proposal families and approval paths (34 files, 513 of 513); the import gates, census ratchets and route
matrices (10 files, 104 of 104; census 165/162/3/0); `app/lib/mcp` with `app/api/mcp` (33 files, 737 of 737) and `app/lib/mcp/server`
(19 files, 183 of 183); tsc 0; eslint: `app/page.tsx`'s 14 pre-existing `react-hooks/refs` errors only (none on E3's ten lines),
every other changed file clean; the generators with zero drift (B11 19 of 19 cases and 61 of 61 checks; the B09 and B11 outputs, 21
files, byte-identical; B17-A 628 controls, CSV and summary identical; the tree's status unchanged). (logs under `b21/e3lead/gates/`, the chain `e3-lead-gates.sh`).

Live behaviour with a real model: **BLOCKED-LIVE-QUALIFICATION** (LB-9) - the resume replays what the record holds and never calls a
model for it.

## 9. For the lead — the reserved texts, in full

Each `### OD-…` below is the entry for `OWNER_DECISIONS.md` (as `## OD-…`, or as the amendment it names), in its format. Then the README
row, the ledger paragraph, the PROGRAM_STATE texts, the discovery closure clauses, the §10 amendment and the report line.

### OD-122 — The artifact ledger scope, the ledger across resumes as applied (B21-E3, 2026-09-27)

- **Question:** with a route-level resume, how is "one side-effecting artifact per user message" kept across the requests of one run?
- **Applied:** keyed by `userMessageDigest` on the run's resume record `agent.orchestration-resume.v1` (beside the run's own record, the
  same repository): (1) the coordinator's first-turn artifact events are recorded with its turn, and a resume hands them to the scheduler
  (`artifactHeld`), so no specialist is offered a proposal and the decision is `coordinator_sealed` - the artifact itself is never
  re-emitted; (2) when the merge's rule would present one specialist action, the runtime claims `orchestration-resume:<runId>:artifact:
  <userMessageDigest>` first (with the claiming request's ordinal), once the merge's verdicts stand: a claim that reads back as a replay
  withholds it as `already_presented` (appended last to the approval outcomes, decided in `presented`'s place only) unless it is VOID -
  every request since the claiming one recorded an end that presented nothing (a claim that timed out but landed) - and a claim that
  cannot be written stands the run down with its own line before anything is presented. A specialist proposal is never presented twice
  for one message in one run. The resume itself: the chat body's optional `resumeRunId` (admitted beside `ALLOWED_BODY_KEYS` under the
  orchestration flag only), authorized after the wrapper's checks by the record's owner (principal and scope, decided first), message,
  provider and plan, with nine closed refusals (`resume_unavailable` for now, `resume_unusable` for good); the run id reused; the first
  turn replayed from the record; the scheduler replaying what was committed against the LIVE head the resuming request carries - bound
  also to its schematic, selection and netlist, with seals that outlive the approval window; the follow-up turn once; one request of a run
  at a time (a compare-and-set start, a settled end - also on a throw - before the terminal, a 10-minute lease). The D2 amendment's
  INFERRED clause (a replayed result keeps its seal) is now CONFIRMED: the ledger decides.
- **Scope, stated:** per run and message - a message sent again without `resumeRunId` is a new run with its own ledger; at most once to
  the human - a stream cut between the claim and the event, or a presenting request whose end is not recorded, loses that presentation
  for the run; after a moved head the first artifact stays the message's one (stale against the new head, its apply refused by its
  family's currency check).
- **The owner may choose otherwise:** a ledger across runs keyed by the message digest alone within a window (as B18's retry guard does
  for grants - it would refuse a deliberate re-ask of the same words); or at-least-once presentation - a resume re-emits exactly the
  claimed artifact (the claim holds its kind, task, attempt, index and digest) when it is still accepted; or present again when the
  presented artifact is stale against the live head; or a shorter lease than 10 minutes (it bounds how long a crashed request holds its
  run).

### OD-111 — The durable orchestration record, amended: the resume record (B21-E3, 2026-09-27)

- **Amended:** a sibling aggregate `agent.orchestration-resume.v1` on the same repository and scope as `agent.orchestration-run.v1`,
  one per coordinator run, holding the resume binding (owner, message, provider and plan as digests), the coordinator's first-turn FINAL
  TEXT - provider text, persisted so a resume replays it instead of paying for the turn again: bounded to 60 000 characters, encoded
  exactly, withheld (null, a closed reason, its digest kept) when over the bound or credential-shaped - the redaction authority's shared
  rule plus the record's own shapes (a PEM private key, an AWS key id, a GitHub or Slack token, a JWT, a URL with a password, a lower-case
  `*_secret=` / `*_token=` / `password=` pair; every quantifier bounded); never reasoning, never provider state - the one-artifact claim
  per message with its request's ordinal, the follow-up's answer digest, and each request's start and end (with whether it presented);
  every write a compare-and-set commit, idempotent by its entry's key, no outbox topic; every load verified. Retention and access audit
  stay deferred (RECORDED), as for the run's record.
- **Open for the owner:** a retention bound for this record - it is the one orchestration record that holds model text whole; PROPOSED
  default: no longer than the run record's retention once one is set, and the answer purged once the run is finished (`follow-up`
  recorded). RECORDED: the shared redaction rule the rest of the orchestration record relies on (a specialist request's objective, a
  result's text) does not know the record's own shapes; widening it is a cross-cutting change outside E3.
- **The owner may choose otherwise:** replay no text (only the digest) - a resume would then replay a closed placeholder and the
  follow-up turn would answer without the first answer; or a retention shorter than the run record's.

### OD-107 — DAG caps, amended: the approval window across resumes (B21-E3, 2026-09-28)

- **Amended:** the wall-time clause (the DAG inside the 10-minute proposal TTL minus the 2-minute approval window, so nothing the DAG
  seals expires before the human sees it) holds across a route-level resume: a resume restarts the DAG wall time, and a REPLAYED seal is
  held to the same bound at the resumed DAG's deadline - one with less than `RESUME_REPLAY_APPROVAL_WINDOW_MS` (120 000 ms) left then is not replayed; its specialist runs
  again and seals afresh (`stale_lifetime`).
- **The owner may choose otherwise:** bound the resume itself to the TTL minus the window after the first seal (a coarser rule: every
  specialist re-run and re-paid in a new run).

### The README row (`artifacts/ai-control-plane-b21/README.md`, a new row "B21-E3" after B21-E2 (2/2))

| B21-E3 the route-level resume and the userMessageDigest ledger | `route-resume.md`; code `app/api/chat/route.ts` (four lines in place: the key beside the closed set, the resume judged, the run id reused, the grant handed over; the import in place), `app/api/chat/orchestration-runtime.ts` (the DAG path under a settle-on-throw guard, the replayed first turn, the record's coordinator turn, the ledger's claim once the merge judged, the follow-up's entry and every request's settled end - in place; the resume, the void claim and the guard appended), `app/lib/agent/orchestration/store.ts` (the resume record and its credential shapes, appended; one import name in place), `app/lib/agent/orchestration/scheduler.ts` (a route-level resume's context and seal-lifetime blocker: four lines in place, the rest appended), `app/lib/agent/orchestration/merge.ts` (`already_presented`, in place), `app/lib/project/chat-run-view.ts` (the offer and its restore from the saved log, appended), `app/page.tsx` (ten lines in place, no control), the workflow's one explicit entry | CONFIRMED (the chat body's optional `resumeRunId` admitted beside the unchanged closed key set under the flag only - a flag-off request byte-identical to HEAD's and the key refused as HEAD refuses it; authorized after the wrapper's identity, membership, role and CSRF checks by the record's owner (first), message, provider and plan with nine closed refusals and no provider call; the run id reused; the coordinator's first turn replayed from the record with no model call; the scheduler replaying every committed specialist still current for the resuming request - its design, selection and netlist, seals outliving the approval window at the DAG's deadline - and re-running the rest, the merge judging the LIVE head read at resume time (D21-17's live-head half); the follow-up turn once; one request of a run at a time with a compare-and-set start, a settled end before the terminal (a throw included) and a 10-minute lease; every record write bounded, a timed-out one unknown; one side-effecting artifact per userMessageDigest across resumes - a specialist proposal never presented twice (`already_presented`), a void claim presented once, the coordinator's own artifact keeping every resume's specialists read-only; OD-130's part review reachable from a production POST through the resume (D21-16's route half); "Resume" a run-log line with no control, read back after a reload, a transient refusal keeping it; D21-4 closed at the route; OD-122 applied across resumes, OD-111 and OD-107 amended; the interrupted run's work adopted, verified and completed, then twenty review findings fixed test-first and the lead's follow-up on the check (a start's end marked only by its own request, the replayed seal's window measured at the DAG's deadline); 57 cases in five suites; D2's approval-outcome pin moved with its reason; no generator input changed) |

### The ledger paragraph (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md`)

### B21-E3 — the route-level resume and the userMessageDigest ledger (2026-09-27/28 local; increment workflow + lead; this commit)

- Adopted: a previous E3 run was cut off by a power outage (about 09:06) with partial, unreviewed work in the tree; the adopting run
  verified every changed file against HEAD b4a0ec5 (hashes as found in `e3adopt/start.sha256`), kept most of it, changed what was wrong
  or missing (one request of a run at a time; the store's load bound to its scope; a transient refusal keeping the page's offer) and
  finished the page, the cases and the gates.
- Reviewed: an adversarial review CONFIRMED twenty findings; each fixed test-first (`route-resume.md` section 8, "Review fixes"): the
  claim after the merge judged, with its own line (regressions-1); a throw settles the start (regressions-2); the trace bound stated
  (regressions-4); the record's own credential shapes (security-1); a route-level resume bound to the selection, netlist and schematic,
  the authority deliberately not (security-2); the offer read back after a reload (coverage-1); a replayed seal outliving the approval
  window (coverage-2); true offer lines (coverage-4); a timed-out write unknown, a void claim (coverage-5); the page's counts (coverage-6);
  `resume_unusable` for good (coverage-7, tests-5); every record write bounded and injectable, the compare-and-set, the owner first, the
  load's re-judgement, the moved head, the page's wiring and control scan pinned (tests-1..4, 6, 8..10).
- Test-first: the adopted run's red against HEAD (`e3adopt/red-1-head.log`: 39 of 48 failing) and its mutations (`red-2-mutated.log`: 6
  of 30); the review fixes' red against the adopted code (`e3fix/red-1.log`: 22 of 55 failing; `red-2-prefix.log`: 19 of 45 against the
  adopted production files swapped back in; `red-3`, `red-4`) and eleven mutations each caught (one more proven harmless); then green.
- Code: `route.ts` (the key beside the closed set, the resume judged after the wrapper, the run id reused, the grant handed over - in
  place), `orchestration-runtime.ts` (the guard, the replayed first turn, the coordinator's record, the ledger's claim, the follow-up's
  entry, every request's settled end - in place; the resolution, the record writes, the void claim, the replay and the guard appended),
  `store.ts` (the resume record and its credential shapes, appended), `scheduler.ts` (a route-level resume's blocker: four lines in place,
  the rest appended), `merge.ts` (`already_presented`, in place), `chat-run-view.ts` (the offer and its restore, appended), `page.tsx`
  (ten lines in place, no control), the workflow's one explicit entry. No route, descriptor, run-event type, control or generator input
  changed; census 165/162/3/0; the nine scanned files and `redaction.ts` byte-identical to HEAD.
- Pin move with its reason: D2's approval case 6 (`already_presented` appended).
- Gates re-run one job at a time (the lead re-runs them): every B21 suite with the seven route suites and the CI guard (47 files,
  438); `app/api/chat`, `app/lib/llm` and `app/lib/acquisition` in full (376 passed, one opt-in live file skipped); `app/lib/agent` with the
  exposure and tier suites, the B17-A inventory and the B18-D UI gates (646 of 646); `app/lib/project` with `app/components/chat` (312
  of 312); the proposal families (513 of 513); the import gates and census (104 of 104); `app/lib/mcp` and `app/api/mcp` (737 of 737)
  and `app/lib/mcp/server` (183 of 183); tsc 0; eslint clean on E3's lines (page.tsx's 14 pre-existing errors elsewhere); the B11, B09
  and B17-A generators with zero drift - figures on the page.
- Records: `route-resume.md`; OD-122 applied across resumes; OD-111 and OD-107 amended; D21-4 closed at the route, D21-16's route half
  and D21-17's live-head half closed. Live: BLOCKED-LIVE-QUALIFICATION (LB-9) - no model is called.

### PROGRAM_STATE.json (`artifacts/remaining-builder-program/PROGRAM_STATE.json`)

`currentCheckpoint`: "B21-E3 committed on chapter/b21-specialist-orchestration: the route-level resume - the chat body's optional
resumeRunId under the flag, authorized by the record's owner, message, provider and plan with nine closed refusals, the run id reused,
the coordinator's first turn replayed from the record, the scheduler replaying what is still current against the LIVE head the resuming
request carries (its selection and netlist, seals outliving the approval window), the follow-up turn once, one request of a run at a
time - and the userMessageDigest ledger across resumes (a specialist proposal never presented twice, already_presented, a void claim
presented once); OD-130's part review reachable from a production POST; Resume a run-log line, read back after a reload; twenty review
findings fixed; D21-4 closed at the route, D21-16's route half and D21-17's live-head half closed; next B21-E4".
`nextAction`: "B21-E4: the composer's kind swap (D21-38) and the coordinator's first turn behind the breaker (D21-39); then B21-F
(evaluations); OD-126's older-page question, OD-112's option A, OD-122's across-runs, at-least-once and stale-artifact options and
OD-111's retention question stay with the owner".
The report line for the closeout: `MULTI-AGENT STATUS: ...; the route-level resume and the userMessageDigest ledger (B21-E3) delivered
offline behind SIRKIT_ORCHESTRATION_ENABLED - committed specialist work replayed while still current, never re-run or re-paid otherwise,
one side-effecting artifact per user message across resumes; evaluations pending (B21-F); live disagreement / fallback / quota
BLOCKED-LIVE-QUALIFICATION under LB-9`.

### Discovery closure clauses (`discovery.md` §4, appended to each defect; §10 gains a B21-E3 amendment)

- **D21-4 — Resume does not exist: a retry is a NEW run that restarts from the user message, so committed specialist work would be redone and re-paid; the single-artifact ledger and the mint key are scoped to one runId.** — CLOSED at the route by B21-E3 (OD-122
  across resumes): under the orchestration flag the chat body's optional `resumeRunId` (the run id the client received in
  `X-Sirkit-Run-Id`) re-attaches a later request to its coordinator run - authorized after the wrapper's checks by the run's resume
  record (owner, message, provider, plan) with nine closed refusals before any provider call; the run id reused; the coordinator's
  first turn replayed from the record (no model call); every committed specialist result still current replayed by the scheduler, never
  re-run or re-paid, a stale one re-run; the follow-up turn once; one request of a run at a time; the single-artifact ledger keyed by
  `userMessageDigest` across the run's requests (`already_presented`); the page's offer read back from its saved run log after a refresh
  - `route-resume.md`, `b21-e3-chat-resume.test.ts` cases 5 to 7, 9 and 11, `b21-e3-resume-runtime.test.ts` cases 3 to 6, 9, 15 and 18,
  `b21-e3-resume-offer.test.ts` case 6. RECORDED: the mint key stays per run and call (a resumed request mints nothing: the first turn is
  replayed and the follow-up is read-only); a message sent again without the key is a new run; a run cut by the refresh itself (in
  flight) is not offered after it.
- **D21-16 — A component can be replaced only by its one server-owned exact authority target; a sourcing specialist cannot propose an alternative part through any existing tool.** — the route half CLOSED by B21-E3: OD-130's part review is reachable from a production
  POST through the route-level resume - a replacement sealed while the catalog's exact authority was its earlier part is replayed
  on the resume after that authority moved (the authority deliberately not part of the replay key), the merge contradicts it against the
  authority loaded for the resuming request and writes the part review for `request_atomic_review`, the stream carries its line and no
  artifact event (`b21-e3-chat-resume.test.ts` case 8, `b21-e3-resume-runtime.test.ts` case 16).
- **D21-17 — Artifact lifetimes are fixed and inconsistent with a DAG's wall time; a parallel specialist finishing after any commit is deterministically stale.** — the live-head half CLOSED by B21-E3: a resumed run's merge judges against the LIVE head read at resume time
  - the head the resuming request carries, verified by the route (the chat path has no server-side durable schematic head; the editor
  context is the local working copy) - never the first request's snapshot: a replayed result produced under another scope, schematic,
  selection or netlist is stale and re-run by the scheduler, and the merge's scope is the new head's (`b21-e3-resume-runtime.test.ts`
  cases 6 and 16, `b21-e3-chat-resume.test.ts` case 7); and the wall-time clause holds across resumes - a replayed seal with less than
  the 2-minute approval window left at the resumed DAG's deadline is re-run (OD-107 amended; runtime cases 17 and 20). RECORDED: a commit that lands DURING one request's DAG
  is still not seen by that request's merge (every apply re-verifies against its live head); B21-F's parallel-staleness case runs on the
  resume.
- **§10, B21-E3 (recorded by the lead, 2026-09-27/28):** Section 4: D21-4 closed at the route; D21-16's route half and D21-17's live-head
  half closed. Section 6: OD-122 applied across resumes and OD-111 and OD-107 amended as `route-resume.md` states them; OD-111's
  retention question open. Section 7, B21-E3: as built - the resume key beside the closed set under the flag; the sibling resume record;
  the replayed first turn; the ledger's claim before presentation and `already_presented`, a void claim presented once; the follow-up
  once; one request of a run at a time (a compare-and-set start, a settled end before the terminal - a throw included - a 10-minute
  lease); a route-level resume's context and seal-lifetime blocker; the run-log offer with no control, read back after a reload. Section
  8: the interrupted run's work adopted, verified and completed, then twenty review findings fixed and the lead's follow-up on the
  check (`route-resume.md` section 8).

## 10. Citations

As of the E3 tree (base `b4a0ec5` plus this increment and its review fixes); the anchor is what the tests check - it occurs exactly once
in its file - and, for every production file E3 changed, it is on the line stated.

| id | file | line | within | anchor | what |
|---|---|---|---|---|---|
| C1 | `app/api/chat/route.ts` | 59 | — | `const ALLOWED_BODY_KEYS = new Set(` | the chat body's closed key set, unchanged |
| C2 | `app/api/chat/route.ts` | 140 | — | `!chatResumeBodyKeyAdmitted(key)` | the one key admitted beside it, flag on only - in place |
| C3 | `app/api/chat/route.ts` | 366 | — | `const resume = await resolveChatResume(` | the resume judged after the wrapper, before any provider call; its refusal a JSON answer - in place |
| C4 | `app/api/chat/route.ts` | 367 | — | `const runId = resume.kind === "resume" ? resume.runId` | the run id reused - in place |
| C5 | `app/api/chat/route.ts` | 508 | — | `resumeChatRun(request, resume);` | the grant for THIS request object - in place |
| C6 | `app/api/chat/route.ts` | 35 | — | `resolveChatResume, resumeChatRun, routerFactsOf` | the import, in place |
| C7 | `app/api/chat/orchestration-runtime.ts` | 557 | — | `export const CHAT_RESUME_BODY_KEY` | `resumeRunId` |
| C8 | `app/api/chat/orchestration-runtime.ts` | 558 | — | `export function chatResumeBodyKeyAdmitted(` | admitted under the flag only |
| C9 | `app/api/chat/orchestration-runtime.ts` | 562 | — | `export const CHAT_RUN_ID_PATTERN` | the run-id grammar |
| C10 | `app/api/chat/orchestration-runtime.ts` | 566 | — | `export const CHAT_RESUME_REFUSALS = Object.freeze({` | the closed refusals, in order |
| C11 | `app/api/chat/orchestration-runtime.ts` | 569 | — | `resume_unusable: { status: 409` | [fix: coverage-7] a record that cannot serve a resume, for good |
| C12 | `app/api/chat/orchestration-runtime.ts` | 575 | — | `resume_in_progress: { status: 409` | one request of a run at a time |
| C13 | `app/api/chat/orchestration-runtime.ts` | 580 | — | `export interface ChatResumeGrant` | what a resume hands the runtime |
| C14 | `app/api/chat/orchestration-runtime.ts` | 584 | — | `export const RESUME_LEASE_MS = 600_000;` | the lease |
| C15 | `app/api/chat/orchestration-runtime.ts` | 587 | — | `export const RESUME_RECORD_DEADLINE_MS` | every record call bounded |
| C16 | `app/api/chat/orchestration-runtime.ts` | 591 | — | `export async function boundedRecordCall<T>(` | a closed reason, never a driver's message; a timed-out call is unknown |
| C17 | `app/api/chat/orchestration-runtime.ts` | 602 | — | `"record_mismatch" : "record_unavailable"` | [fix: coverage-7] a verification failure told apart |
| C18 | `app/api/chat/orchestration-runtime.ts` | 610 | — | `export function resumeOwnerDigest(` | the owner: principal and scope |
| C19 | `app/api/chat/orchestration-runtime.ts` | 613 | — | `export function resumePlanDigest(` | the plan as a digest |
| C20 | `app/api/chat/orchestration-runtime.ts` | 621 | — | `export async function resolveChatResume(` | the resolution |
| C21 | `app/api/chat/orchestration-runtime.ts` | 628 | — | `if (!store) return refused("resume_unusable");` | [fix: coverage-7] no durable record bound: for good |
| C22 | `app/api/chat/orchestration-runtime.ts` | 632 | — | `turn.kind !== "coordinator") return refused("resume_unknown");` | unknown in THIS scope |
| C23 | `app/api/chat/orchestration-runtime.ts` | 633 | — | `if (turn.ownerDigest !== resumeOwnerDigest(input.context)) return refused("resume_foreign");` | the owner before anything else about the run |
| C24 | `app/api/chat/orchestration-runtime.ts` | 634 | — | `return refused("resume_mismatch");` | the message and the provider |
| C25 | `app/api/chat/orchestration-runtime.ts` | 636 | — | `return refused("resume_plan_changed");` | the plan |
| C26 | `app/api/chat/orchestration-runtime.ts` | 637 | — | `return refused("resume_completed");` | a finished run |
| C27 | `app/api/chat/orchestration-runtime.ts` | 644 | — | `Date.parse(latest.at) < RESUME_LEASE_MS) return refused("resume_in_progress");` | an unsettled start within the lease |
| C28 | `app/api/chat/orchestration-runtime.ts` | 645 | — | `(entry.entry.kind === "settled" ? [entry.entry.ordinal] : []))) + 1;` | [fix: coverage-5] the next ordinal, past every start and end |
| C29 | `app/api/chat/orchestration-runtime.ts` | 646 | — | `entry: { kind: "resume", ordinal, claim }, expectedRevision:` | the start claimed against the head read |
| C30 | `app/api/chat/orchestration-runtime.ts` | 647 | — | `if (!claimed.ok) { await markUnknownClaim({ store,` | [fix: coverage-5] a claim of unknown outcome: its end marked - [lead] only its own (C122) |
| C31 | `app/api/chat/orchestration-runtime.ts` | 648 | — | `claimed.value.code === "invalid_record") return refused("resume_unusable");` | [fix: coverage-7] a start the record refuses: for good |
| C32 | `app/api/chat/orchestration-runtime.ts` | 654 | — | `export function resumeChatRun(` | the grant keyed by the request object |
| C33 | `app/api/chat/orchestration-runtime.ts` | 657 | — | `export function chatResumeOf(` | read back for that request only |
| C34 | `app/api/chat/orchestration-runtime.ts` | 662 | — | `export function resumedRunLine(` | the resumed line |
| C35 | `app/api/chat/orchestration-runtime.ts` | 666 | — | `export function unrecordedFirstAnswer(` | the closed placeholder |
| C36 | `app/api/chat/orchestration-runtime.ts` | 672 | — | `function replayFirstTurn(` | the first turn replayed, no model call |
| C37 | `app/api/chat/orchestration-runtime.ts` | 698 | — | `async function recordCoordinatorTurn(` | the coordinator entry |
| C38 | `app/api/chat/orchestration-runtime.ts` | 713 | — | `async function claimMessageArtifact(` | the ledger's claim |
| C39 | `app/api/chat/orchestration-runtime.ts` | 721 | — | `could not be claimed on the run's resume record` | [fix: regressions-1] the claim's own stand-down line |
| C40 | `app/api/chat/orchestration-runtime.ts` | 728 | — | `function voidClaim(` | [fix: coverage-5] a claim no request presented |
| C41 | `app/api/chat/orchestration-runtime.ts` | 738 | — | `async function recordFollowUpAnswered(` | the follow-up entry |
| C42 | `app/api/chat/orchestration-runtime.ts` | 751 | — | `async function settleChatRequest(` | a request's settled end, with whether it presented |
| C43 | `app/api/chat/orchestration-runtime.ts` | 764 | — | `export interface OrchestratedChatInput` | [fix] the DAG path's input |
| C44 | `app/api/chat/orchestration-runtime.ts` | 769 | — | `recordDeadlineMs?: number;` | [fix: tests-2] the record deadline, a test seam |
| C45 | `app/api/chat/orchestration-runtime.ts` | 776 | — | `async function settledOnThrow(` | [fix: regressions-2] a throw settles the start first |
| C46 | `app/api/chat/orchestration-runtime.ts` | 195 | — | `return settledOnThrow(input, orchestratedChat);` | [fix: regressions-2] the DAG path under the guard - in place |
| C47 | `app/api/chat/orchestration-runtime.ts` | 210 | — | `const cancelled = async (steps: number, toolCalls: number): Promise<AgentRunResult> =>` | a cancellation settles before its terminal - in place |
| C48 | `app/api/chat/orchestration-runtime.ts` | 217 | — | `const settleStarted = ` | this request's start - in place |
| C49 | `app/api/chat/orchestration-runtime.ts` | 217 | — | `onStart(settleStarted);` | [fix: regressions-2] handed to the guard - in place |
| C50 | `app/api/chat/orchestration-runtime.ts` | 219 | — | `const replayed = chatResumeOf(request); if (replayed)` | the replay in the loop's place - in place |
| C51 | `app/api/chat/orchestration-runtime.ts` | 230 | — | `const standDown = async (reason` | every stand-down settles - in place |
| C52 | `app/api/chat/orchestration-runtime.ts` | 232 | — | `const unsettled = await settleStarted(); if (unsettled) warn(unsettled, true); const terminal` | before its terminal - in place |
| C53 | `app/api/chat/orchestration-runtime.ts` | 238 | — | `const recorded = replayed ? null : await recordCoordinatorTurn(` | before any specialist - in place |
| C54 | `app/api/chat/orchestration-runtime.ts` | 243 | — | `...(replayed ? { resumed: true } : {})` | [fix: security-2, coverage-2] a route-level resume's replay rule - in place |
| C55 | `app/api/chat/orchestration-runtime.ts` | 262 | — | `for (const line of merged.lines) warn(line); judged = merged; const ledger = await claimMessageArtifact(` | [fix: regressions-1] the claim once the merge's verdicts and lines stand - in place |
| C56 | `app/api/chat/orchestration-runtime.ts` | 262 | — | `alreadyPresented: ledger.alreadyPresented` | handed to the presentation - in place |
| C57 | `app/api/chat/orchestration-runtime.ts` | 262 | — | `presented = approval.outcome === "presented";` | [fix: coverage-5] whether this request presented - in place |
| C58 | `app/api/chat/orchestration-runtime.ts` | 294 | — | `await recordFollowUpAnswered(` | the follow-up once - in place |
| C59 | `app/api/chat/orchestration-runtime.ts` | 450 | — | `decision.outcome === "already_presented" ?` | its withheld line - in place |
| C60 | `app/api/chat/orchestration-runtime.ts` | 22 | — | `RESUMES this run under its own id` | the module header's stand-down rule - in place |
| C61 | `app/lib/agent/orchestration/store.ts` | 34 | — | `import { containsTokenAnchoredSecretShapedText, redactPathSegment } from "../redaction";` | the one import name, in place |
| C62 | `app/lib/agent/orchestration/store.ts` | 383 | — | `export const ORCHESTRATION_RESUME_AGGREGATE_TYPE` | the sibling aggregate |
| C63 | `app/lib/agent/orchestration/store.ts` | 389 | — | `export const ORCHESTRATION_RESUME_KINDS = Object.freeze(` | the closed entries |
| C64 | `app/lib/agent/orchestration/store.ts` | 396 | — | `export const ORCHESTRATION_RESUME_ANSWER_WITHHELD` | why an answer is withheld |
| C65 | `app/lib/agent/orchestration/store.ts` | 398 | — | `export const ORCHESTRATION_RESUME_BOUNDS` | the bounds |
| C66 | `app/lib/agent/orchestration/store.ts` | 403 | — | `the claiming request's ordinal */ ordinal: number` | [fix: coverage-5] a claim carries its request's ordinal |
| C67 | `app/lib/agent/orchestration/store.ts` | 406 | — | `whether THIS request presented the message's artifact */ presented: boolean` | [fix: coverage-5] an end says whether its request presented |
| C68 | `app/lib/agent/orchestration/store.ts` | 425 | — | `export function orchestrationResumeIdempotencyKey(` | the keys - the ledger |
| C69 | `app/lib/agent/orchestration/store.ts` | 438 | — | `export function encodeResumeAnswer(` | the answer stored exactly |
| C70 | `app/lib/agent/orchestration/store.ts` | 489 | — | `case "resume": // a resumed` | a start or an end's ordinal |
| C71 | `app/lib/agent/orchestration/store.ts` | 491 | — | `typeof entry.presented !== "boolean") refuse(` | [fix: coverage-5] `presented` closed |
| C72 | `app/lib/agent/orchestration/store.ts` | 501 | — | `function storedResumeEntry(` | an input judged closed |
| C73 | `app/lib/agent/orchestration/store.ts` | 523 | — | `containsTokenAnchoredSecretShapedText(answer) || resumeAnswerCredentialShape(answer) !== null` | [fix: security-1] a credential-shaped answer withheld |
| C74 | `app/lib/agent/orchestration/store.ts` | 528 | — | `function loadedResumeEntry(` | a stored entry re-judged |
| C75 | `app/lib/agent/orchestration/store.ts` | 561 | — | `export class DurableOrchestrationResumeStore` | the store |
| C76 | `app/lib/agent/orchestration/store.ts` | 583 | — | `const expectedRevision = judged.expectedRevision ??` | compare-and-set against the head the caller read |
| C77 | `app/lib/agent/orchestration/store.ts` | 606 | — | `raw.aggregateKey !== identity.aggregateKey` | a load bound to its aggregate and scope |
| C78 | `app/lib/agent/orchestration/store.ts` | 618 | — | `export function orchestrationResumeStoreOf(` | derived from the durable record only |
| C79 | `app/lib/agent/orchestration/store.ts` | 634 | — | `export const ORCHESTRATION_RESUME_CREDENTIAL_SHAPES` | [fix: security-1] the record's own credential shapes, bounded |
| C80 | `app/lib/agent/orchestration/store.ts` | 644 | — | `export function resumeAnswerCredentialShape(` | [fix: security-1] the first shape an answer holds |
| C81 | `app/lib/agent/orchestration/merge.ts` | 1053 | — | `export const SPECIALIST_APPROVAL_OUTCOMES` | `already_presented` appended - in place |
| C82 | `app/lib/agent/orchestration/merge.ts` | 1060 | — | `alreadyPresented?: boolean` | the decision's fact - in place |
| C83 | `app/lib/agent/orchestration/merge.ts` | 1071 | — | `facts.alreadyPresented === true ? withheld("already_presented")` | in `presented`'s place only - in place |
| C84 | `app/lib/agent/orchestration/scheduler.ts` | 362 | — | `export function requestScope(` | the scope a result is replayed under (unchanged) |
| C85 | `app/lib/agent/orchestration/scheduler.ts` | 428 | — | `return refused("plan_mismatch"` | the recorded plan only (unchanged) |
| C86 | `app/lib/agent/orchestration/scheduler.ts` | 440 | — | `report(planEvent({ runId: coordinator.runId` | the plan event, on a resume too (unchanged) |
| C87 | `app/lib/agent/orchestration/scheduler.ts` | 109 | — | `resumed?: boolean;` | [fix: security-2, coverage-2] the coordinator run's fact - in place |
| C88 | `app/lib/agent/orchestration/scheduler.ts` | 462 | — | `const blocker = coordinator.resumed === true` | [fix: security-2, coverage-2] a route-level resume's blocker - in place |
| C89 | `app/lib/agent/orchestration/scheduler.ts` | 462 | — | `const committedScopeDigest = answered &&` | a committed result's scope - in place |
| C90 | `app/lib/agent/orchestration/scheduler.ts` | 463 | — | `if (committedScopeDigest === currentScopeDigest) {` | replayed under the same scope, nothing blocking (unchanged) |
| C91 | `app/lib/agent/orchestration/scheduler.ts` | 468 | — | `// the board moved (or the scope differs): the committed result is STALE` | else stale and re-run (unchanged) |
| C92 | `app/lib/agent/orchestration/scheduler.ts` | 469 | — | `: blocker ? blocker.reason : ` | [fix] the blocker's reason on the dissent - in place |
| C93 | `app/lib/agent/orchestration/scheduler.ts` | 823 | — | `export const RESUME_REPLAY_APPROVAL_WINDOW_MS = 120_000;` | [fix: coverage-2] OD-107's approval window |
| C94 | `app/lib/agent/orchestration/scheduler.ts` | 828 | — | `export const RESUME_REPLAY_CONTEXT_REFS` | [fix: security-2] the context a replay is bound to; the authority deliberately not |
| C95 | `app/lib/agent/orchestration/scheduler.ts` | 831 | — | `function resumeReplayBlocker(` | [fix: security-2, coverage-2] the blocker |
| C96 | `app/lib/project/chat-run-view.ts` | 596 | — | `export const CHAT_RESUME_STAND_DOWN_REASONS` | the stand-down reasons |
| C97 | `app/lib/project/chat-run-view.ts` | 603 | — | `export function observeChatResume(` | the observation |
| C98 | `app/lib/project/chat-run-view.ts` | 611 | — | `export function resumableChatRun(` | what is resumable |
| C99 | `app/lib/project/chat-run-view.ts` | 618 | — | `export function chatResumeFor(` | the same message, provider, project and branch |
| C100 | `app/lib/project/chat-run-view.ts` | 625 | — | `export function chatResumeOfferLine(` | the offer line, naming the provider |
| C101 | `app/lib/project/chat-run-view.ts` | 629 | — | `export function chatResumingLine(` | the resuming line |
| C102 | `app/lib/project/chat-run-view.ts` | 635 | — | `export const CHAT_RESUME_TRANSIENT_REFUSALS` | the refusals that keep the offer |
| C103 | `app/lib/project/chat-run-view.ts` | 636 | — | `export function chatResumeKeptAfter(` | kept or spent |
| C104 | `app/lib/project/chat-run-view.ts` | 653 | — | `export function restoredChatResume(` | [fix: coverage-1] the offer read back from the saved run log |
| C105 | `app/page.tsx` | 62 | — | `chatResumeKeptAfter, chatResumeOfferLine` | the import, in place |
| C106 | `app/page.tsx` | 2557 | — | `const resumableChatRunRef = useRef<ResumableChatRun` | the offer's ref - in place |
| C107 | `app/page.tsx` | 3123 | — | `resumableChatRunRef.current = null; // retries (and` | cleared on a project switch - in place |
| C108 | `app/page.tsx` | 4471 | — | `const offeredResume = resumableChatRunRef.current ?? restoredChatResume(messages,` | [fix: coverage-1] every send spends it; read back after a reload - in place |
| C109 | `app/page.tsx` | 4494 | — | `if (chatResume) appendActivityStep(logId, chatResume.line, "done");` | the resuming line - in place |
| C110 | `app/page.tsx` | 4540 | — | `...(chatResume ? { resumeRunId: chatResume.runId } : {})` | the key, only for a resume - in place |
| C111 | `app/page.tsx` | 4544 | — | `resumableChatRunRef.current = chatResumeKeptAfter(` | a transient refusal keeps it and says so - in place |
| C112 | `app/page.tsx` | 4545 | — | `const streamRunId = res.headers.get("X-Sirkit-Run-Id");` | the run id the route issued - in place |
| C113 | `app/page.tsx` | 4565 | — | `resumeObservation = observeChatResume(resumeObservation, event);` | beside the run view - in place |
| C114 | `app/page.tsx` | 4773 | — | `if (resumable) appendActivityStep(logId, chatResumeOfferLine(resumable.runId, resumable.provider), "done");` | the offer, a run-log line - in place |
| C115 | `.github/workflows/deterministic-manufacturing.yml` | 152 | — | `app/api/chat/__tests__/b21-e3-chat-resume.test.ts` | the route suite's one explicit entry [B24-D1, 2026-10-09] re-pinned +1: B24-D1's prompt-to-gerber start step at `:32` (OD-30) |
| C116 | `app/api/chat/route.ts` | 14 | — | `No silent cross-provider fallback exists;` | the route header stands |
| C117 | `app/page.tsx` | 4491 | — | `lastAiRetryRef.current = () => void send(text);` | the Retry IS `send(text)` (unchanged) |
| C118 | `app/api/chat/route.ts` | 331 | — | `const authority = await loadRunComponentAuthority(source, {` | the authority loaded for THIS request (unchanged) |
| C119 | `app/api/chat/route.ts` | 311 | — | `const recomputed = pcbRevisionId(assembly.context.canonicalState.pcb);` | the revision recomputed server-side (unchanged) |
| C120 | `app/api/chat/route.ts` | 208 | — | `if (editorContext.authoritySource !== "local-working-copy") {` | the editor context is the local working copy (unchanged) |
| C121 | `app/page.tsx` | 4798 | — | `startNewRun: () => void send(text),` | the card's Retry, the same send (unchanged) |
| C122 | `app/api/chat/orchestration-runtime.ts` | 799 | — | `async function markUnknownClaim(` | [lead] a claim of unknown outcome marks only its own end |
| C123 | `app/api/chat/orchestration-runtime.ts` | 790 | — | `function resumeClaimId(` | [lead] a request's own claim id |
| C124 | `app/lib/agent/orchestration/store.ts` | 491 | — | `if (entry.kind === "resume" && !isOrchestrationDigest(entry.claim))` | [lead] a start without its claim id is refused - in place |
| C125 | `app/lib/agent/orchestration/scheduler.ts` | 462 | — | `context, Math.max(now(), dagDeadline)) : null;` | [lead] the approval window measured at the DAG's deadline - in place |
