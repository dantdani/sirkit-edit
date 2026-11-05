# Build generation failure correction — 2026-10-17

> Subsequent owner retry: the request reached the 180-second design deadline. The user
> journey remains unresolved; the targeted tests below are historical evidence for the
> narrower cancellation/diagnostics correction, not proof of a live drone-design success.
> The persistent-task corrective assignment is section L of
> `artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md`.

## Scope and observed evidence

The owner's four-motor drone request ended with `All 3 subsystem blocks failed to design.`
Work was performed in `C:/Users/robsa/Desktop/sirkit-edit`, starting at HEAD `60424880` with
another builder's substantial existing changes present. Those changes were preserved; no
commit, push, provider configuration, migration, project design or protected-original edit
was performed by this correction.

CONFIRMED by source inspection: `BUILD_BUDGET.deadlineMs` was 40,000; that one clock began
before planning and included catalog searches, correction turns and subsystem design. The
45,000 ms canonical route-wrapper setting limits **body reading**, not generation. The
old loop checked time only before a new model turn; it did not cancel a hung turn or
consistently reject late results. The all-failed branch replaced the individual reasons
with the generic message above.

CONFIRMED by read-only call-record metadata for the latest recorded build request
`llmr-908b2df8-a6b9-4f6b-b38c-ad30eeb0b5c9`: nine successful main-model calls, 61 successful
embedding calls, and 39 optional reranker calls refused for insufficient quota. The
planner alone used about 13 seconds. The main-model calls continued beyond 40 seconds;
catalog work continued to about 61 seconds after the planner started. Reranker failure
already degrades to the fused catalog order and was not a main-model failure.

INFERRED: shared-deadline starvation is a strong explanation of this specific historical
request, consistent with those timings. Its individual subsystem error bodies were not
retained in the metadata; claiming their exact historical cause would exceed the evidence.
The permanent regressions reproduce the relevant slow/hung orchestration boundaries with
the real generation service and build loops, not a hard-coded drone answer.

## Correction

- `app/lib/schematic/build-result.ts`: finite shared generation budget is now 180 seconds;
  the iteration ceiling (20), concurrency ceiling (3) and operator's ability to lower the
  iteration ceiling are unchanged. A caller's tighter deadline still wins.
- `app/lib/schematic/build-boundary.ts`: one hard wall-clock/cancellation boundary;
  pre-aborted work starts nothing, pending provider calls receive cancellation, late
  results cannot become proposals, and timers/listeners are cleaned up.
- `app/lib/schematic/build-multi-generation.ts`: applies that boundary to the planner and
  design/merge pipeline. Local failures identify the stage; all-subsystem failures carry
  bounded, redacted block names, failure classes and reasons instead of losing the cause.
- `app/lib/build-loop.ts`: checks time/cancellation around asynchronous stages, forwards
  the signal, and uses the shared provider-retry classification. Authentication, model
  access, bad requests and cancellation are not advertised as retryable.
- `app/lib/llm/{types,openai-provider,anthropic-provider}.ts`: optional request cancellation
  reaches both SDKs for generation and streaming. Calls without a signal retain their
  historical SDK arity. Cancellation is classified as `cancelled`.
- `app/lib/parts-search.ts`: cancellation prevents new follow-up retrieval/rerank work
  after a preceding await. Optional reranking receives the signal. **Already-running SQL
  and embedding requests are not claimed to be cancelled.** Non-cancellation fallbacks,
  ranking and component-authority rules are unchanged.
- `app/api/schematic/build-multi/route.ts` and
  `app/api/chat/schematic-generation-runtime.ts`: both callers forward their existing
  cancellation into the same generation function. Authorization, CSRF and body limits
  are unchanged.
- `app/lib/engineering/tool-catalog.ts`: the generation descriptor allows 185 seconds,
  encompassing the generation's 180-second ceiling. An agent run's remaining budget
  still tightens it. Tool identities, schemas, exposure and approval requirements are
  unchanged. The generated manual also lists `build_cancelled`.

No ERC/DRC gate, pin validation, publication authority, approval/apply path or manufacturing
release was bypassed. A generated draft with electrical findings is not an approved or
flight-qualified drone controller.

## Verification

New permanent suites:

- `app/lib/schematic/__tests__/generation-recovery.test.ts` — 7 cases: slow three-block
  success beyond the former 40-second ceiling, tighter caller deadline, bounded/redacted
  failure causes, pre-cancellation, hung planner/subsystems, late-result refusal and
  provider-quota precedence.
- `app/lib/llm/__tests__/generation-request-cancellation.test.ts` — 12 cases against both
  real adapters, including injected SDK transports, zero-transport pre-abort and in-flight
  cancellation for generate/stream, without live calls.
- `app/lib/__tests__/parts-search-cancellation.test.ts` — 14 cases over the real retrieval
  pipeline with fake catalog/provider seams, including stage-by-stage refusal and
  unchanged successful/fallback behavior.

The existing provider, API-parity, generation-proposal, discovery, authority, replay and
manual tests were also run. An existing deployment-configuration source-line pin was
re-pointed from Anthropic-provider line 190 to 196 after the SDK cancellation additions;
its exact guard/import assertions remain intact.

Final combined selection: **37 files passed; 488 tests passed; zero failures; exit 0**
(73.29 seconds, one worker, no file parallelism). This selection includes all three new
suites plus the provider subsystem, schematic checks, B16 route parity, B19 injection and
catalog authority, PR-D proposal/manual/coverage gates, B04/B05 discovery, B09 provider
contracts, B10 context, B11 replay, B21 least-privilege, and B24 readiness/configuration/call
records. No full-repository-suite result is claimed.
Typecheck: `pnpm exec tsc --noEmit --incremental false` — exit 0. Scoped ESLint — exit 0.
The repository's sanctioned generators refreshed registry-derived artifacts/manuals and
the parity coverage index against the current working tree. Transient Windows file-open
errors in two generator invocations were retried successfully; generators were not weakened.

The existing local server returned HTTP 200 at `http://localhost:3000/`; it was not restarted.
The temporary read-only diagnostic script was removed. No paid model, embedding, rerank,
simulator, distributor or purchase call was initiated by this correction.

UNKNOWN: a fresh live-model run of the owner's exact drone request and its electrical
adequacy. No live success, PCB completion, full-suite pass or flightworthiness is claimed.
The builder's existing cumulative live-spend ledger was not changed or charged: the
available meter does not prove a pre-call input-token cap for the entire fan-out path,
so no additional paid test was launched under the owner's finite authorization.
