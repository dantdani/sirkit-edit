# Final verdict — section M, resolving and replacing missing parts (2026-10-20)

[PR-L7, 2026-10-20] Branch `codex/astra-foundation` at `deaf15ca`. Governing text:
`artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md` section M (`:700-807`; M.5 at `:790-807`). Design and increment
pages: `m2-acquisition-design.md`, `m4-board-impact.md`; commands and exit codes: `../persistent-generation/validation.md` (headings
"M2", "M4", "Increment 5"). Path shorthand: `CR/` = `app/lib/component-resolution/__tests__/`.

## Verdict: PARTIAL

From a schematic with no PCB, the assistant (from the Missing parts list's "Find a replacement in the library" or a chat sentence)
inspects the unresolved instances, searches the library by requirements, proves the pin mapping, seals one batch, and the human's Approve
commits one canonical transaction with a receipt and a new schematic revision, then the recomputed Prepare PCB preflight. When no local
part fits, a durable acquisition task obtains real KiCad bytes from an admitted source, validates them, stores a library candidate and
hands it to the existing two-human review and publication; the published revision is then offered through the same replacement path.
With a durable board, the dialog shows the PCB impact before Approve and the page refuses qualify and release while the board is behind
the schematic. All of this is proven over the production services with fixture evidence (the fixture CAD source's committed bytes, the
bundled KiCad library at the pinned commit, PGlite, the scripted agent). M is not complete: the online source is blocked on owner
decisions, publication needs the governance configuration and two named people, a bound part cannot yet be rebound from the page, and no
live source, live provider or engineering-quality evidence exists for M.

## M.5, item by item

| # | M.5 item | verdict | permanent test (production path) | evidence class; reason |
|---|---|---|---|---|
| 1 | no PCB, two unresolved instances: the real inspection / search / replacement services are discovered and invoked; board-only tools withheld; no fake board or browser authority | CONFIRMED | `CR/m1-led-dimmer-resolution.test.ts` cases 1-3; `CR/m1-page-intake-fixture.test.ts`; `CR/m1-boundaries.test.ts`; `e2e/m1-resolve-missing-parts.spec.ts` | fake-backed + fixture browser |
| 2 | the LED-dimmer D1 / D2 reproduction selects an eligible compatible local revision, the right batch mapping and diff, the normal confirmation, a new canonical revision; nothing hard-coded | CONFIRMED | `CR/m1-led-dimmer-resolution.test.ts` cases 3, 4, 12 (the model picks FROM the search results); `e2e/m1-resolve-missing-parts.spec.ts` step 1 | fake-backed + fixture browser; the candidate search works by requirements, not known ids |
| 3 | refDes, connectivity, polarity, values / roles and unaffected parts preserved; display-only edits cannot satisfy; unknown / incompatible / withdrawn refuse precisely | CONFIRMED | `CR/m1-compatibility.test.ts` cases 1-11; `CR/m1-led-dimmer-resolution.test.ts` cases 4, 5, 8, 9; `e2e/m1-resolve-missing-parts.spec.ts` (the saved state keeps every reference, value, placement, net and polarity) | fake-backed + fixture browser |
| 4 | no local candidate -> permitted fixture source -> real bytes -> parsing and mapping validation -> durable candidate -> review / publication -> eligible replacement -> checks and preflight | CONFIRMED for the fixture source and the bundled KiCad library; the online source BLOCKED | `CR/m2-5-resolution-after-acquisition-pglite.test.ts`; `CR/m2-3-acquisition-pipeline-pglite.test.ts`, `m2-3-cad-validation`, `m2-3-object-store`; `CR/m2-1-schematic-acquisition-discovery.test.ts`; `e2e/m2-acquire-missing-part.spec.ts` | fake-source evidence over the production egress, store, parser and publication services. `kicad-gitlab` is refused whatever the environment until OD-M2-3; a closed parse engine is required before any live adapter (OD-M2-12); the live qualification run needs OD-M2-13 |
| 5 | reopen / reuse with no network, download or model work; a second project reuses; a foreign or private one cannot read; changes and withdrawal handled | CONFIRMED | `CR/m2-6-reuse-isolation-pglite.test.ts` (zero transport, embedding and reranker calls on reuse; a foreign tenant reads nothing; a withdrawn revision is never newly selected; an upstream byte change is a new object and candidate) | fake-backed, PGlite. A tenant-private library tier does not exist (OD-M2-11) |
| 6 | approval refusal, missing credentials / evidence, unavailable source, hostile assets, cancel, stale, revoked, duplicate clicks, an ambiguous commit cannot forge authority, corrupt the library, duplicate or cross projects | CONFIRMED | `CR/m2-6-acquisition-refusals-pglite.test.ts`; `CR/m2-4-handoff-boundaries.test.ts`; `CR/m1-led-dimmer-resolution.test.ts` cases 6, 7, 10, 11; `app/api/parts/__tests__/m2-acquisitions-route.test.ts`; `CR/m1-channel-and-receiver.test.ts` | fake-backed, PGlite. Missing credentials has no reachable producer: no admitted CAD source takes a credential (the optional GitLab token is OD-M2-6 and is never read) |
| 7 | an existing board: footprint / pin / route effects and stale manufacturing evidence; undo / redo / save / reload; multi-sheet identity | PARTIAL | `CR/m4-schematic-drift`, `m4-board-impact`, `m4-board-impact-agrees-with-preflight`, `m4-receipt-board-impact`, `m4-reresolve-after-undo`, `m4-journal-size`, `CR/m2-7-existing-board-acquired-binding`; `app/lib/workflow/__tests__/m4-journey-board-behind.test.ts`, `m4-board-rebind.test.ts`; `app/components/pcb/__tests__/m4-manufacturing-gate.test.ts`; `app/components/schematic/__tests__/m4-resolution-dialog-impact.test.tsx`; `e2e/m4-existing-board-resolution.spec.ts` | CONFIRMED: impact before approval, Approve fail closed and bound at Approve, receipt v2, the board-behind notice, journey fact and in-page qualify / release refusals recomputed by Undo, Redo and reload. Open: a part already bound on the board cannot be rebound to another revision from the page (`PB_ACTIVE_SELECTION_CONFLICT`; proven only at the API level, so the browser proof re-resolves to the bound revision); no server-side currency guard on qualify / release; the B14 exact-replacement dialog does not consume the impact; a net-membership change raises `PS_REMOVED_NET_RECONCILIATION_REQUIRED`; the browser proof uses an unrouted board; multi-sheet identity is not exercisable until section J |
| 8 | fresh-browser Build and chat proofs: the action, review, commit receipt and updated PCB-preparation state; descriptors, manuals, coverage and discovery agree | CONFIRMED (fixture browser) | `e2e/m1-resolve-missing-parts.spec.ts` (the Missing parts action and the chat sentence reach the same dialog), `e2e/m2-acquire-missing-part.spec.ts`, `e2e/m4-existing-board-resolution.spec.ts`; the drift gates `pr-d-tool-manuals`, `pr-d-coverage-matrix`; `CR/m2-1-schematic-acquisition-discovery.test.ts` | fake-source and scripted agent only; no live-source, live-provider or engineering-quality evidence |

## The completion sentence (`:807`), assessed

The owner can ask Sirkit to resolve or replace missing parts and the assistant does the inspection, search, proposal and — after the
human's Approve — the application, then continues to Prepare PCB: CONFIRMED with fixture evidence. Acquisition, validation and storage
are real for the bundled KiCad library and the fixture source; publication stays a two-human act by design. The online acquisition path
is implemented as far as the egress, store, parser and handoff, and blocked at the source by owner decisions (OD-M2-1 … OD-M2-14 in
`m2-acquisition-design.md` section 6; listed in `../remaining-blockers.md`). M therefore stays PARTIAL.

## What this verdict does not claim

No live CAD source was contacted, no manufacturer datasheet was fetched or stored, no part was published into the owner's catalog, and
no live model ran a resolution. The fixture parts' pin facts come from the KiCad library files, not manufacturer tables.
