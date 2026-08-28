# B14.1 §D — real production integration evidence

## The defect (R4)

B14's "fresh-browser capstone" invoked `h.apply(proposal)` directly; the
review test proved a callback fires; page integration was source-string
matching. No permanent test proved the production chain.

## The production chain, extracted and tested

Two production modules now exist so THE TESTED PATH IS THE SHIPPED PATH:

- [replacement-approval-controller.ts](../../app/lib/project/replacement-approval-controller.ts)
  — `receiveReplacementProposalEvent` (the proposal-consumer discrimination
  page.tsx delegates to) and `approveAndApplyReplacement` (the ONLY
  invoker of the apply service: issues the one-shot intent, constructs the
  production reauthorization channel, retires the intent on every path);
- page.tsx's `proposal_ready` case and Apply handler now call these
  directly (behavioural tripwire kept as supplementary only).

## The permanent no-credit test

[b14-1-production-integration.test.tsx](../../app/lib/project/__tests__/b14-1-production-integration.test.tsx)
(jsdom; scripted provider adapter; durable seams; zero credits):

1. invokes the REAL `/api/chat` POST handler;
2. consumes the REAL `proposal_ready` NDJSON event through the PRODUCTION
   consumer;
3. renders the REAL `ReplacementReviewDialog` with the received proposal;
4. proves rendering, chat text, proposal receipt, cancel, dismissal
   (unmount), and timeout (expired artifact) perform ZERO mutation;
5. fires an INDEPENDENT click on `Apply exact replacement`, whose handler
   is the PRODUCTION controller — issuing the one-shot approval intent;
6. traverses the PRODUCTION reauthorization transport: the channel's own
   same-origin `fetch` crosses the PLATFORM boundary (stubbed at the
   platform level only) into the REAL `/api/replacement-authority` handler
   — exactly one transport call per commit;
7. commits exactly ONE canonical replacement transaction;
8. verifies the receipt (`approvalActor` earned, not assumed), durable
   journal/idempotency evidence, exact UI adoption (visible digest =
   receipt digest; installed identity = the verified target), and EXACT
   undo restoring the prior digest and every prior authority field;
9. proves double/concurrent activation commits once; forged intents and
   forged exact-match structural reauthorization refuse; project switch and
   retirement never produce a second transaction.

No source-string assertion is load-bearing anywhere in this suite.
