# B14.1 — pre-edit reproductions (R1–R4)

R1/R2 captured with a disposable vitest probe (deleted after capture)
against the unmodified B14 tree; R3/R4 by source inspection with exact
locations.

## R1 — human approval is not authenticated
## R2 — fresh reauthorization is structurally forgeable

ONE probe demonstrates both: a DIRECT `applyApprovedReplacementProposal`
call — no UI, no click, no approval capability of any kind — supplying a
plain structural object whose `fetchFreshFacts` returns an EXACT
JSON-round-tripped STALE COPY of the proposal-time records and pin facts
(zero server contact):

```json
R1R2 {"ok":true,"status":"committed","approvalActor":"human:interactive","approvalCapabilityRequired":false,"serverContacts":0,"headAdvanced":true,"visibleChanged":true}
```

- The commit succeeded and the receipt UNCONDITIONALLY stamped
  `approvalActor: "human:interactive"` (`REPLACEMENT_APPROVAL_ACTOR` was a
  constant written into every receipt body — approved-replacement-mutations.ts).
- `ApprovedReplacementApplyInput.reauthorize` was the STRUCTURAL interface
  `{ fetchFreshFacts(...) }` — any object satisfies it; the B14 happy-path
  harness itself supplied one. The B14 forgery tests (31–33) only changed
  the target and therefore failed by digest mismatch; an exact stale copy
  byte-matches and commits without ever contacting the server. Digest
  equality validated CONTENT, and B14's artifacts misrepresented it as
  source authentication.

## R3 — the reauthorization route does not use authenticated server scope

`app/api/replacement-authority/route.ts` (pre-edit) read the scope DIRECTLY
from the request body and passed it to the durable loader:

```
55:  const scope = body.scope;
65:  const { tenantId, projectId, branchId } = scopeRecord;
     … resolveComponentAuthoritySource(requestScope) / loadRunComponentAuthority({ scope: { ...requestScope, … } })
```

while its header comment and the B14 artifact
(`authority-reauthorization-boundary.md`) claimed it "derives authority
from the AUTHENTICATED server scope". No authenticated server session
exists in this application (local-only, single-tenant "local"; no auth
layer) — the claim was false. Additionally both the request and response
bounds counted JavaScript characters (`raw.length` at route.ts:37,
`text.length` at replacement-reauthorization.ts:46), not UTF-8 bytes.

## R4 — the claimed fresh-browser capstone is not a browser/UI integration

- B14 apply test 54 ("full production path") invoked **`h.apply(proposal)`
  directly** (b14-replacement-apply.test.ts:490) — no proposal consumer, no
  rendered review UI, no click, no production reauthorization transport.
- The review test proved only that a callback prop fires
  (b14-replacement-review.test.tsx) and checked the page integration with
  SOURCE-STRING assertions (lines 81–85: `page).toContain(...)`).
- Nothing permanently proved: route event → production proposal consumer →
  rendered review → independent click → real reauthorization boundary →
  canonical transaction → receipt/adoption/undo.
