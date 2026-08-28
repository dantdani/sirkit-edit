# B12.1 §E — production UI adoption and undo evidence

> **SUPERSESSION NOTE (B12.2).** Two claims below were narrower than
> stated: (1) the "replacement project is never mutated" proof handed the
> replacement a FRESH registry — with the SHARED production registry, a
> live foreign scope received the consumed receipt (counterexample R2); and
> (2) the synchronous test host substituted for page.tsx's actual applier,
> which only scheduled a debounced history record — production receipts
> finalized before the real entry existed (counterexample R3). Superseded
> by `../ai-control-plane-b12-2/consumed-replay-scope-contract.md` and
> `../ai-control-plane-b12-2/synchronous-production-adoption-contract.md`.
> Preserved as historical evidence.


What the integration tests actually exercise, and the one substitution they
make.

## The production pieces exercised, for BOTH provider origins

`b12-1-production-integration.test.ts` drives, per scripted OpenAI-origin
and Anthropic-origin flow:

- the REAL `runAgentLoop` + `createAgentToolGateway(sirkitToolRegistry())`
  + `assembleAgentRunContext` + `AGENT_SYSTEM_PROMPT`, with the sealed
  proposal captured from the production `proposal_ready` event (the only
  substitution on the loop side is the scripted `ProviderAgentAdapter` — the
  network boundary that would cost credits);
- the REAL `SchematicEditorSession` over a real `AtomicProjectStore`
  (including a deterministically delayed store for the race orderings);
- the REAL `SchematicGestureCoordinator` — the page's serialization and
  adoption mechanism — with a host implementing the page-host contract;
- the REAL `SchematicHistory`, recorded by the host's
  `applyCanonicalProjection` exactly as `page.tsx`'s applier does;
- the REAL `ProjectCommitInterlock`;
- the REAL `applyApprovedTier1Proposal` service — the exact function
  `page.tsx` calls, with the exact input shape `page.tsx` passes
  (gateway, interlock, stillCurrent, scope ids, originRunId);
- the page's exact `runHistoryStep` request wiring
  (peek/reconcile/commitCursor/applyUi over the real history + session).

**The one substitution:** the host callbacks' React internals.
`page.tsx`'s `applyCanonicalSchematicProjection` writes React state
(`setComponents`…) and defers the history record through a 350 ms debounce
watcher; the test host applies the same contract synchronously (one visible
update, one history entry, one `notifyAuthoritativeProjection`). The host
CONTRACT is typed (`GestureCoordinatorHost`, documented "records ONE
history entry") and the page's implementation of it is CI-gated
(schematic-setter-gate). The tests therefore prove the production
controller, serialization, session, store, interlock, history, and service;
they do not render React.

## What is proven (§E checklist)

| Requirement | Evidence |
| --- | --- |
| No mutation before Apply | visible digest, head sequence 0, store head 0, one history entry — after `proposal_ready`, before Apply |
| One Apply visibly changes the editor state | coordinator-adopted visible state carries the exact edit (`R1 = 4k7`); digest changed |
| Exactly one durable transaction | store envelope head sequence 1 |
| Exactly one SchematicHistory entry | entries = [Opened project, Applied AI edit proposal]; undoLabel pinned |
| Normal UI undo restores the exact pre-apply digest and reconciles the durable lineage | `runHistoryStep("undo")` → applied; visible digest = pre-apply digest; session head canonical digest & lineage = sealed base mark |
| Duplicate Apply: no second transaction/history entry | `already-applied`; store head still 1; entries still 2 |
| Exact replay returns the original receipt | same `receiptId` |
| Altered replay rejected, no receipt | `verification-failed`; store head unchanged |
| A gesture and an approved Apply cannot interleave | gesture-first → `editor-busy`, store untouched; apply-queued → `begin()` refuses |
| Transition-before-commit cancels with zero transaction | `session-superseded`; store head 0; nothing adopted |
| Apply-lease-before-transition settles before retirement | `retire()` unsettled during the critical section (microtask probe); caller told `committed`; adoption + store head 1; retirement settles after |
| Hydration/recovery/session replacement invalidates stale proposals | coordinator invalidation cancels a queued apply before execution, zero durable transaction |
| The replacement project is never mutated by a late completion | replacement (different project id, as a real switch produces) refuses the stale proposal foreign-scope; its store head 0, history 1 entry |

Deterministic barriers only: promise gates on the delayed store and
microtask-flush settlement probes — no wall-clock sleeps, no provider
credits.

## Duplicated single-flow evidence

The updated B12 §H suite (`b12-boundary-and-e2e.test.ts`) asserts the same
adoption facts on its per-provider flows (visible `4k7`, `canUndo`, two
history entries), so the old "commandResult.state = displayed schematic"
labeling is gone from every test that survives.
