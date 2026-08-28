# B12.2 §B — the consumed-replay scope contract

Modules: [`app/lib/engineering/approved-agent-mutations.ts`](../../app/lib/engineering/approved-agent-mutations.ts) (the gate),
[`app/lib/engineering/schematic-session.ts`](../../app/lib/engineering/schematic-session.ts) (`scopeIdentity()`).
Supersedes: B12.1's replacement-containment claim (which was proven with a
fresh registry and therefore proved nothing about the shared production
registry).

## What was wrong (R2)

The production `approvedMutationRegistry` is ONE object across every
project the page ever opens. §C's ordering authenticated the ARTIFACT
before the one-shot lookup — but the consumed branch returned its receipt
without ever verifying the CURRENT authority (scope/head verification runs
at execution position, which a consumed hit short-circuits). Reproduced: a
LIVE project-B composition invoking project A's exact consumed proposal
received `ok:true / already-applied` **with project A's receipt**
(`receipt.projectId === "proj-A"`).

## The gate

Before a consumed receipt is returned, the service verifies the **trusted
live composition identity** — not merely caller-supplied strings:

```
claim → consumed?
  1. live = session.scopeIdentity()          ← the SESSION's own identity
     live.lifecycle !== "ready"              → refuse session-not-ready
  2. stillCurrent?.() === false              → refuse session-superseded
  3. live.tenantId  === sealed.tenantId
     live.projectId === sealed.projectId
     live.branchId  === sealed.branchId
     live.lineageId === sealed.headMark.lineageId
     AND callerTenant/project/branch === sealed …
     any mismatch                            → refuse verification-failed
  4. only then                               → already-applied + ORIGINAL receipt
```

`scopeIdentity()` is a narrow READ-ONLY accessor (tenant/project/branch/
lineage/lifecycle) — it grants no capability and mints no trust; it makes
the session's own identity the authority the strings are checked against.

## Deliberate properties

- **The original head sequence is NOT required** for exact same-project
  replay: the consumed transaction legitimately advanced that head. Lineage
  (not head position) anchors the authority.
- **Foreign refusals never expose the receipt** — no receipt id, no foreign
  scope ids in the refusal (asserted in tests against the serialized
  outcome).
- **Refusal vocabulary is reused, never widened**: retired/unavailable →
  `session-not-ready`; stale scope → `session-superseded`; identity
  mismatch → `verification-failed`.
- **Altered artifacts still fail BEFORE all registry access** (§C step 2 —
  unchanged), and one-shot/durable idempotency behavior is unchanged
  (in-flight, poison, durable `idempotent_replay` paths untouched).
- A poisoned identity still answers `identity-poisoned` to any scope — a
  controlled code carrying no receipt.

## Evidence

`b12-2-consumed-replay-scope.test.ts` — ONE registry shared across every
composition (as production shares its singleton): same-live-scope exact
replay succeeds with the original receipt; foreign project, foreign branch,
same-project replacement lineage, retired session, and stale scope each
refuse without a receipt; every refusal leaves both projects' stores and
histories unchanged; and same-scope idempotency still works afterwards.
The B12.1 retired-store replay test was updated (a retired session now
refuses instead of answering with the receipt) — recorded as a supersession
on the B12.1 artifact.
