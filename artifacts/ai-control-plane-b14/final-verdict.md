# B14 — final verdict

> **SUPERSEDED IN PART by B14.1** (`../ai-control-plane-b14-1/final-verdict.md`):
> independent verification found four gaps — unauthenticated approval,
> structurally forgeable reauthorization (an exact stale copy committed with
> zero server contact), a request-body scope mislabeled "authenticated", and
> a capstone that bypassed the UI/consumer path. All four are closed in
> B14.1. Historical text below is preserved unmodified.


**Stop condition:** "B14 is complete only when a real `/api/chat` agent run
can produce a sealed, non-mutating exact replacement proposal and an
independent human click can revalidate fresh server authority and commit
exactly one canonical replacement transaction with durable evidence, UI
adoption, exact undo, and no dropped connected pins."

**Verdict: MET.**

- The REAL exported `/api/chat` POST handler, driving the real loop/gateway
  over injected durable seams, seals `sirkit.schematic-replacement-proposal.v1`
  and emits `proposal_ready` with ZERO mutation (b14-route 52).
- The fresh-browser capstone (b14-apply 54, no provider credits): a
  gateway-sealed proposal → the production
  `applyApprovedReplacementProposal` with fresh reauthorization →
  recompiled byte-match → fresh runtime grant → exactly ONE canonical
  `schematic.replace-component` transaction → verified receipt + durable
  journal + idempotency evidence → exact UI adoption → EXACT undo (prior
  digest AND prior authority fields restored).
- Zero dropped connected pins is enforced at FOUR layers: the planner's
  refusal, the assembler's never-acknowledge rule, the artifact's
  structural zero-drop invariant, and the reviewed impact.
- No provider/model/browser/candidate/permitted-alternative/serialized-grant
  path can choose installed identities (R1–R12 closed; forbidden-input,
  forgery, and substitution tests all refuse with zero mutation).

Explicit exclusions honored: no theory-component replacement, no generic
candidates, no permitted alternatives without exact authority, no
model-selected assets, no multi-component, no automatic approval, no
approval from chat text, no ambiguous mappings, no dropped pins, no partial
application, no direct mutation tools, no PCB mutation, no manufacturing
release, no MCP, no external component APIs, no provider changes, no
multi-agent orchestration. No dependency changes.

Classification:

- **CONFIRMED:** R1–R12 reproductions; all closures via 45 new permanent
  tests; the eleven-tool exposure with regenerated deterministic artifacts;
  FULL SUITE **2684 passed / 20 skipped / 0 failures**; tsc clean; scoped
  ESLint clean; page baseline unchanged; protected original untouched.
- **INFERRED:** live-Postgres behaviour of the new symbol-pin read (proven
  against controllable cancellable query objects and the injected-seam
  route; DB-gated integration remains skipped without `DATABASE_URL`); the
  full Next.js-served HTTP path for the two routes (handlers are invoked
  directly, as all route suites do).
- **PROPOSED (not started):** an authority-bearing replacement replay
  capsule; live-database e2e once a test instance exists.
- **UNKNOWN:** production frequency of certificate-corroboration failures
  on real catalog data (fail-closed either way).

**B15, PCB mutation exposure, manufacturing release, MCP, external
component APIs, provider expansion, and multi-agent work are NOT started.
Stopped; awaiting independent verification.**
