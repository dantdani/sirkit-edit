# B14.1 §B — authentic fresh reauthorization

> **SUPERSEDED IN PART by B14.2** (see `../ai-control-plane-b14-2/`): the
> channel consumption below had NO execution deadline or AbortSignal — a
> never-settling transport hung the apply while the commit lease was held
> (the 30 s result TTL never bounded transport execution), the response was
> buffered via `response.text()` before the byte check, and the "nonce" was
> a LOCAL tag that never appeared in the HTTP exchange. B14.2 adds the hard
> settlement race, streaming response bounds, and a real request/response
> nonce echo. Historical text below is preserved unmodified.


## The defect (R2)

`ApprovedReplacementApplyInput.reauthorize` was the STRUCTURAL interface
`{ fetchFreshFacts }` — any object satisfied it; the B14 harness itself
supplied one. An attacker could serve an EXACT stale/revoked byte copy of
the reviewed records and pin facts: it byte-matched the recompile and
COMMITTED with zero server contact (reproduced:
`{"ok":true,"serverContacts":0,...}`). B14's artifacts misrepresented digest
equality (content validation) as source authentication.

## The closure

[replacement-reauthorization.ts](../../app/lib/project/replacement-reauthorization.ts)
— `ReplacementReauthorizationChannel`: an OPAQUE runtime capability (private
constructor, `static {}` factory, frozen, `toJSON()` inert). The production
apply contract takes the channel (validated `instanceof` inside the
service); the structural seam is GONE.

- **Production factory** `createReplacementReauthorization()` — ZERO
  parameters (asserted): the transport is the platform's same-origin
  `fetch("/api/replacement-authority")`. No public fetcher injection can
  mint trusted results.
- **One-shot consumption INSIDE the serialized gateway**
  (`consumeReplacementReauthorization`): the channel is burned before any
  I/O, performs the REAL request NOW, tags the result with per-consumption
  provenance (nonce, requestedAt, 30 s bounded lifetime checked by the
  service), and validates the allowlisted shape with a UTF-8 byte bound.
  Provenance = "this channel's own transport call just returned it" — it
  cannot be reconstructed from response bytes.
- **Binding**: the consume request carries the exact proposalId, component,
  current revision, scope, lineage/head, and the nonce; downstream, the
  deterministic recompile + operation/impact digest byte-match remain
  CONTENT validation (explicitly documented as a different guarantee from
  source authenticity).
- **Test seam**: `__createTestReplacementReauthorizationChannel` (a REAL
  branded channel over an injected transport) exists for test fixtures only
  and is protected by a permanent production-import walker.

## Proofs

- A structural adapter carrying an EXACT stale byte copy refuses
  `authority-unavailable` BEFORE `journal.prepare` (zero journal entries)
  and before any canonical execution (zero transactions).
- JSON round-trips and spread-clones of a real channel authenticate nothing.
- A consumed channel never serves a second consumption.
- The §D integration test traverses the PRODUCTION transport (platform
  fetch → real endpoint handler) exactly once per commit.
