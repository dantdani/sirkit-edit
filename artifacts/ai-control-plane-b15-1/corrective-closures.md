# B15.1 — the corrective closures (R1–R9)

Every counterexample is now a permanent fail-closed regression in
`app/lib/pcb/proposal/__tests__/b15-1-corrective-closures.test.ts` (28
tests). The B15 core suite (15 tests) remains green alongside, with its
fixtures corrected where they were themselves wrong.

| # | Defect | Closure | Test |
| --- | --- | --- | --- |
| **R1** | a 40,649-byte payload passed a 32,768-byte "ceiling" — the budget counted string lengths, 8/number, and key names, ignoring structure, quoting, escaping, and multibyte width | the accepted payload is NORMALIZED, serialized, and measured with `TextEncoder` — the ceiling is now EXACT. Serialization is guarded; an unserializable value refuses | §A R1, R1b (emoji payload: 4 UTF-8 bytes per 1 UTF-16 unit counts) |
| **R2** | proxies whose `ownKeys`/`getPrototypeOf` traps throw made the parser THROW | every reflective read (`getPrototypeOf`, `ownKeys`, `getOwnPropertyDescriptor`, and the property read itself) is wrapped; a throwing trap becomes a bounded `hostile-input` refusal. Totality is asserted at BOTH the parser and the compiler entry points | §A R2 (4 trap kinds) |
| **R3** | `update_keepout` accepted `name: 123` and wrote the number into the candidate | the update form validates `name` with the SAME predicate as the add form: non-empty bounded string. Empty is refused (it is not an explicit removal in this contract) | §A R3 (6 rejected shapes + 1 accepted) |
| **R4** | accepted: dimension layer `evilLayer`; a 3-identical-vertex keepout; a keepout and a dimension in the NOTCH of a concave outline (inside the bounding box) | the SHARED `validatePcbBoardStructure` now runs on every candidate, and the shared `DIMENSION_LAYERS` constant is imported rather than duplicated (my first attempt duplicated it — and got the set wrong). Containment uses the shared `pointInPolygon` for polygon outlines. Keepouts additionally require ≥3 DISTINCT vertices, nonzero shoelace area, and no self-intersection. Zero-length tracks and dimensions refuse | §B R4a–R4d |
| **R5** | 1,000 nm track / 1,000 nm clearance / 2,000 nm via / 1,000 nm drill accepted on a bare net, and an illegal routing preference accepted | the empirical "narrowest existing copper" floor is DELETED. Minima are resolved from the ACTIVE `DrcRules` — the preset default plus the net's OWN class override (via the shared `getNetClass`) and its per-net override — and enforced for track width, clearance, via outer, via drill, and annular ring, on rules, preferences, added tracks, and vias | §C R5a–R5d |
| **R6** | assigning a padstack changed `padstackId` but left `size`/`drill` stale; `add_via` kept conflicting provider dimensions | the padstack is AUTHORITATIVE: `getPadstack` resolves it and the shared `applyPadstackToVia` sets id + size + drill atomically. Explicit geometry alongside a padstack refuses as `padstack-conflict` on both add and update; the resulting geometry is re-checked against the active minima | §D R6a–R6d |
| **R7** | forged operations/impact digests, a candidate digest disagreeing with the impact report, and a foreign tool id all verified `{ok:true}` | sealing takes the compiler result as ONE object (`compiled`), so a caller cannot supply the pins independently. Verification RECOMPUTES the operations digest (over the sealed base identity) and the impact digest, requires `candidateDigest === impact.candidateBoardDigest`, pins the exact tool id/version, bounds the createdAt/expiresAt window by the max TTL, and checks minted ids against the impact's changed objects | §G R7a–R7e |
| **R8** | shorts, unknown contacts, and completion compared by COUNT — equal totals hid a swapped short or a net losing completion | stable identities: order-independent `pairKey` for every short and unknown-contact pair, and `completionByNet` per net. ANY new identity refuses; EVERY net complete before must remain complete | §E R8, R8b |
| **R9** | the suite carried a footprint placeholder and never executed move/rotate | `move_footprint` and `rotate_footprint` are exercised for success (all three quarter turns) and for refusal (non-quarter rotation, unknown, LOCKED, off-board, and concave-notch moves) | §K 1–4 |

## Also corrected while closing the above

**§F — honest readiness naming.** The impact field that reported routing
completion as `readiness.beforePercent/afterPercent` is renamed
`routingCompletion`, and `readiness` now reports
`{state: "unavailable", reason}` — because the compiler does not consume the
pinned fab preset, DRC preset, or proven netlist resources that authoritative
fabrication readiness requires. Routing percentage is never labelled
manufacturing readiness. A permanent test asserts the old
`readiness.beforePercent` shape is gone.

**A fixture that was itself wrong.** The B15 core fixtures used
`userDrawings` as a dimension layer; the shared authority accepts only
`silkTop`/`silkBottom`/`fabTop`/`fabBottom`. Adding the structural validator
surfaced this immediately — the fixtures were corrected, not the validator.

**A resolver error I made and caught.** My first minima resolver folded the
strictest value across ALL per-class overrides, which imposed a 1 mm
power-class floor on ordinary signal nets and broke legitimate 0.25–0.4 mm
routing. It now resolves the net's own class through the shared
`getNetClass`.
