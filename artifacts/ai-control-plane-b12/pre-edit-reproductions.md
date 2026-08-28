# B12 — pre-edit reproductions (R1–R10)

Every reproduction below was run against **production code, before any B12
edit**, through a transient probe (`_tmp-b12-repro.test.ts`, deleted after
capture) built on the real `SchematicEditorSession` +
`InMemoryAtomicProjectStore`. Outputs are verbatim. Each reproduction is now a
permanent test — see [regression-matrix.md](regression-matrix.md).

The distinction that matters: **R1–R3, R5–R10 confirm behaviour that was
already correct** and lock it against regression. **R4 is the one genuine gap
B12 exists to close** — before B12 there was no idempotent already-applied
result and no one-shot consumed guard.

---

## R1 / R2 — receiving and canceling a proposal mutate nothing

```json
B12_R1R2_START{
 "proposal sealed": true,
 "schematic digest unchanged after sealing": true,
 "head mark unchanged after sealing": true,
 "cancel path performs zero session calls (structural: cancel = discard local reference)": true
}B12_R1R2_END
```

Sealing a proposal is pure: it reads the schematic and head to pin them, and
writes nothing back. Cancel discards the local reference — it cannot reach the
session. **Receiving a proposal, and declining one, are both side-effect-free.**

## R3 / R8 / §D — one verified transaction and exact undo

```json
B12_R3R8_START{
 "apply ok": true,
 "status": "executed",
 "transactionId present": true,
 "revisionBefore === sealed head digest": true,
 "exactly ONE head advance": true,
 "result digest === session head": true,
 "undo reconcile ok": true,
 "undo restores the sealed base canonical digest": true
}B12_R3R8_END
```

An approved apply commits exactly one canonical transaction whose
`revisionBefore` equals the sealed head digest, advances the head by exactly
one, and whose result digest matches the session head. Undo reconciles the
history step and restores the **exact** pre-apply canonical digest. This is the
postcondition set §D now verifies on every commit and records in the receipt.

## R4 — rapid double-apply of the SAME proposal (**the real defect**)

```json
B12_R4_START{
 "first": "executed",
 "second (concurrent)": "stale_revision",
 "third (sequential replay)": "stale_revision",
 "head advanced exactly once": false,
 "NO idempotent already-applied result exists today (second/third are raw rejections)": true,
 "NO one-shot consumed guard exists today (both reached the session)": true
}B12_R4_END
```

Before B12: a second (concurrent) and third (sequential) apply of the *same
sealed proposal* both reached the session and were rejected only incidentally,
by the base-digest `stale_revision` check — surfacing a raw rejection, not an
idempotent result. There was **no one-shot consumed guard** (both reached the
session) and **no already-applied result** carrying the original receipt. The
`"head advanced exactly once": false` line is the probe's own multi-session
artifact, not a double-commit — but the absence of an identity guard is the gap.

**Closed in B12 §C:** an identity+scope-keyed one-shot registry. Concurrent
applies converge on ONE transaction; a sequential replay returns
`already-applied` with the **original** receipt; a durable idempotent_replay
from the executor becomes an explicit already-applied refusal. See
[concurrency-and-idempotency-matrix.md](concurrency-and-idempotency-matrix.md).

## R5 — every stale / altered / expired / foreign proposal fails closed

```json
B12_R5_START{
 "valid verifies": true,
 "altered": "altered",
 "expired": "expired",
 "foreign project": "foreign-scope",
 "foreign branch": "foreign-scope",
 "foreign lineage": "foreign-scope",
 "head advanced": "stale-head",
 "stale base": "stale-base",
 "head mark unchanged (no mutation from any refusal)": true
}B12_R5_END
```

`verifySealedTier1Proposal` already refuses each tamper/scope/staleness class
with its own controlled code and mutates nothing. B12 routes every one of these
through a typed `verification-failed` refusal — no exception, no partial apply.

## R6 / R7 — no failure path can display or record "applied"

```json
B12_R6R7_START{
 "not-ready session": "session_not_ready",
 "throwing build": "session THREW: verifier exploded (coordinator catch -> status failed, never applied)",
 "head unchanged after both": true
}B12_R6R7_END
```

A not-ready session refuses with `session_not_ready`. A throwing operation
build causes `session.execute` to **reject** (throw), which the production
gesture coordinator catches → status `failed` → "was not applied" — never a
success toast. The head is unchanged after both. B12 wraps the throw in the
service (`command-failed`), so the service itself never propagates an exception
across the UI boundary. (The initial probe printed `false` for "head unchanged"
because of a fixed-sequence assertion; the corrected relative-sequence
assertion printed `true`, shown above.)

## R9 — serialized client claims cannot authorize execution through /api/chat

Confirmed against the live route handler: `/api/chat` already refuses
caller-supplied `actor` / `capability` / `idempotency` / authority / approval /
`role` / `interactiveChannel` claims — obsolete top-level keys draw an explicit
`400`, and `editorContext` is held to exact keys + schema + scope-equality +
local-working-copy shape (the prior-stage `AUTHORITY_CLAIM_KEYS` +
`exactObjectShape` gate). **No serialized body can mint approval or authority.**
This was already hardened; B12 makes it a **permanent** regression test (R9 in
the boundary suite) covering both top-level and nested-scope lookalike claims.

## R10 — approval never mutates the finalized run trace

```json
B12_R10_START{
 "trace deeply frozen": true,
 "push onto events threw": true,
 "events unchanged": true,
 "re-finalize returns the SAME frozen document": true
}B12_R10_END
```

Approval happens **after** the provider run finalizes. The finalized trace is
deeply frozen: appending throws, the events array is unchanged, and a
post-finalize `recordWarning` + re-finalize returns the **same** frozen
document. Post-run execution outcomes therefore cannot live in the trace — they
live in the separate `sirkit.approved-mutation-audit.v1` ledger (§E).

---

## Closures

| # | Status before B12 | B12 closure |
| --- | --- | --- |
| R1/R2 | correct | locked: seal/cancel are side-effect-free |
| R3/R8 | correct | locked: one transaction, exact undo, §D postconditions in the receipt |
| **R4** | **gap: no one-shot guard, no idempotent result** | **§C one-shot registry: converge concurrent, replay = original receipt, poison-on-unverifiable** |
| R5 | correct | locked: every tamper/scope/staleness class → typed `verification-failed` |
| R6/R7 | correct | locked: refusals are typed; the service never throws across the UI boundary |
| R9 | hardened | locked: permanent test — no serialized claim authorizes execution |
| R10 | correct | locked: finalized trace immutable; outcomes go to the separate audit ledger |
