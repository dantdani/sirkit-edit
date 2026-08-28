# B14.1 — final verdict

> **SUPERSEDED IN PART by B14.2** (`../ai-control-plane-b14-2/final-verdict.md`):
> independent verification found four remaining boundary defects — a
> never-settling reauthorization transport (hung under the commit lease),
> the publicly importable authority-bearing controller wrapper,
> buffer-before-measure byte bounds, and a local-only "nonce" that never
> bound the HTTP exchange. All four are closed in B14.2. Historical text
> below is preserved unmodified.


**Stop condition:** "B14.1 is complete only when a real production
proposal-consumer/UI click supplies an unforgeable, one-shot approval
intent; fresh authority provenance cannot be replaced by a structural or
exact stale forgery; scope claims are honest and fail closed; exactly one
canonical replacement transaction commits; and the full suite remains
green."

**Verdict: MET.**

1. **Unforgeable one-shot approval.** The production integration test
   proves the REAL rendered dialog's independent click — through the
   production controller — is what issues the `ReplacementApprovalIntent`,
   and the service refuses `approval-required` (before any journal or
   canonical work) for missing, boolean, string, structural, serialized,
   replayed, wrong-proposal, wrong-scope, stale-head, and expired tenders.
   Direct service invocation without a UI-issued intent cannot commit.
   `approvalActor: "human:interactive"` is earned by consumption, never
   assumed.
2. **Authentic fresh provenance.** The structural seam is gone: only the
   branded one-shot channel (production factory = real same-origin
   transport, zero injection parameters) satisfies reauthorization, consumed
   once inside the serialized gateway. A plain object, a JSON round-trip, a
   fake fetcher, and an EXACT byte-for-byte stale authority copy all refuse
   before `journal.prepare` and before canonical execution. Digest
   byte-match remains content validation and is documented as such.
3. **Honest scope.** No request field is called authenticated. Tenant and
   branch are server-derived local constants (403 cross-checks proven to
   keep foreign values away from the durable loader, invocation count 0);
   projectId is documented as an unauthenticated locator with the
   defence-in-depth chain stated; bounds count UTF-8 bytes; multi-tenant
   authorization is documented as unavailable.
4. **Exactly one transaction.** The full production chain commits once;
   double/concurrent activation, replayed/forged intents, forged
   exact-match facts, project switch, and retirement never produce a
   second one; cancel/dismissal/timeout mutate nothing.
5. **Everything green.** FULL SUITE **2699 passed / 20 skipped / 0
   failures** (2719); tsc clean; scoped ESLint clean; page.tsx at its
   14-problem baseline; NO generated artifact moved (registry untouched —
   pins byte-identical `e66dd9e0…` on re-run); `git diff --check` clean;
   protected original at its 6-entry baseline; zero provider credits; no
   dependency changes.

Classification: **CONFIRMED** — R1–R4 reproductions and all closures above.
**INFERRED** — the browser-served Next.js HTTP layer (handlers invoked
directly, platform fetch stubbed at the boundary, as all route suites do).
**PROPOSED** — none required. **UNKNOWN** — none material.

**B15, PCB mutation exposure, manufacturing release, MCP, external
component APIs, provider expansion, and multi-agent work are NOT started.
Stopped; awaiting independent verification.**
