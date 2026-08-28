# B14 — regression evidence

> **SUPERSEDED IN PART by B14.1**: the case-54 "fresh-browser ... capstone"
> below invoked the apply service DIRECTLY — it was not a browser/UI
> integration, and the review test proved only that a callback fires. The
> permanent production UI integration proof (route event → production
> consumer → rendered review → independent click → real reauthorization
> transport → one transaction) now lives in
> `../ai-control-plane-b14-1/production-ui-integration.md`. Historical text
> below is preserved unmodified.


## New permanent suites (45 tests) — mandatory-case map

**`b14-replacement-proposal.test.ts` (20)** — cases 1–23 + 25 + 49–51:
withheld without canonical state / head mark / authority resource (1–3);
unknown/theory component (4–5); unresolved/stale/conflicted authority
(6–8); permitted alternative (9); already installed (10); missing current
atomic authority/pins (11, 14); missing/unpublished/mismatched target facts
(12, 13, 15); pin-count-only + non-identity numbering (16–17); certificate
mismatch (18); connected-pin drop (19); ambiguous label move (20); valid
identity proposal + no-live-grant proof (21); valid certified
moved-geometry proposal + seal determinism (22, 51); gateway receipt
mutates nothing (23); altered/unknown/nonzero-drop integrity (25);
forbidden model inputs (asset ids, pins, authority, approvals, drop acks);
OpenAI/Anthropic parity (49); trace redaction (50).

**`b14-replacement-apply.test.ts` (17)** — cases 24, 26–48, 54: cancel
no-op (24); altered + forged approval claim (25/34); expired (26);
foreign project/branch/lineage (27–29); stale head (30); authority change,
asset substitution, forged reauthorization, unavailable reauthorization
(31–33); no provider-callable apply (35); duplicate (36); concurrent (37);
crash before commit (38); crash after commit before receipt with
byte-identical reconstruction (39); project switch (40); retirement (41);
adoption/autosave failure poisons (42); ONE canonical transaction (43);
exact UI adoption (44); exact undo/redo (45–46); receipt forgery (47);
journal forgery (48); the full fresh-browser gateway-proposal → explicit
apply → durable persistence → exact undo capstone with zero provider
credits (54).

**`b14-route-replacement.test.ts` (5)** — case 52: the REAL exported
`/api/chat` POST seals the replacement proposal (scripted adapter, injected
durable seams, real aggregate under the route-derived board scope), emits
`proposal_ready`, exposes the eleventh tool in the ACTUAL toolset, and
mutates nothing; withheld without the durable source; plus the
reauthorization endpoint: allowlisted bounded result with server-derived
target facts, browser asset identities refused BY NAME, 503 fail-closed.

**`b14-replacement-review.test.tsx` (3)** — case 53: the review dialog
renders the reviewed identity/impact + "nothing has changed", applies ONLY
on explicit click, disables while busy; supplementary page-wiring tripwire.

## Updated existing tests (strengthened/extended, never weakened)

- 13 suites: static exposed count TEN → ELEVEN (+ enumerated set +
  b04 propose-tripwire now covering both propose ids).
- `b06-schematic-mutations` #23: unchanged assertions still pass — the
  propose surface is owned by the NEW propose action, so no mutation command
  is tool-exposed.
- `b06-1` boundary: the approved authority-importer set gained
  `replacement-proposal-assembler.ts` (documented rationale in the test).
- b09/b12 suites: proposal-union narrowing guards (schema discrimination);
  `ProposalInvocationService.invoke` awaited (now async).
- journal strictness: `rprop-` prefix + replacement receipt shape added;
  every Tier-1 rule intact (full B12 family green).

## Results

| battery | result |
| --- | --- |
| B14 suites | 45/45 |
| B06/B06.1/B06.2 + executor | green |
| B09 family (proposals/gateway/loop/closures) | green |
| B10 route/context | green |
| B11 trace/replay/evaluation (regenerated pins) | green |
| B12 family (all) | green |
| B13/B13.1/B13.2 | green |
| FULL SUITE | see [final-verdict.md](final-verdict.md) |

`pnpm exec tsc --noEmit` clean; scoped ESLint clean on every new/changed
file; page.tsx at its exact 14-problem pre-existing baseline.
