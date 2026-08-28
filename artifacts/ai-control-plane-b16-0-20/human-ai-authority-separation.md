# B16.0.20 §C — Human/AI authority separation (CONFIRMED, with one correction)

## /problem — AI cannot compile the authoritative problem

- gate: `scope.actorKind !== "human"` → exact 403 "AI may propose CD-10 inputs
  but may not compile an authoritative problem" (pinned; compile never
  invoked);
- caller-supplied actorKind/role/identity cannot satisfy it — the scope comes
  only from the trusted context (the callback receives `{ context, body }`);
- the compiled actor is FORCED `{ actorId: scope.actorId, actorKind: "human",
  sessionId, role }` (captured on the spy, pinned).

## /execute — the corrected gate (§C mandated: reproduce, document, correct)

**Pre-edit** (recorded verbatim in
[pre-edit-counterexamples.md](pre-edit-counterexamples.md)): the condition
`actorKind !== "human" && role !== "automation"` let an AI actor WITH the
automation role pass — end-to-end proof showed ai+automation reaching the 400
required-field check instead of 403, contradicting the route's own error text.

**Mitigating fact (documented):** the trusted-context resolver mints
`actorKind: "human"` for every session principal, so no HTTP caller could
actually present a non-human actor — the flaw lived only in the
defense-in-depth layer, verified by checking the route policy AND callback
condition together as §C requires.

**Correction (a strict narrowing — no authority widened):** the gate is now
`scope.actorKind !== "human"` → 403 regardless of role. Pinned post-fix:
ai+automation → **403**; a human actor carrying the automation role still
passes the gate to input validation; viewer stays 403 by policy;
editor/reviewer/admin behavior matches the route policy exactly (§A pins).
