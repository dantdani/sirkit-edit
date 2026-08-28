# B15.1 — final verdict

**Stop condition: NOT MET. Sections A–G are complete and green; Sections
H–K are not built.**

The stage ordered the work explicitly: close R1–R9 first, and expose the
tool "only after Sections A–G are green". A–G are now green. I did not
reach H–K, so the tool remains unexposed — which is exactly the state the
stage requires until the rest is built.

## Complete and verified

| Section | Result |
| --- | --- |
| **Pre-edit R1–R9** | ALL NINE reproduced against the delivered B15 tree with exact output recorded — [pre-edit-counterexamples.md](pre-edit-counterexamples.md) |
| **§A** parser totality and exactness | exact `TextEncoder` UTF-8 ceiling (40,649-byte payload now refuses; emoji width counts); every reflective read guarded so throwing proxy traps refuse instead of throwing; `update_keepout.name` validated exactly as the add form; no getter/coercion/`toJSON` execution; caller's value never mutated |
| **§B** structural and geometry authority | the SHARED `validatePcbBoardStructure` runs on every candidate; the SHARED `DIMENSION_LAYERS` and `pointInPolygon` are imported, not duplicated; keepouts require ≥3 distinct vertices, nonzero area, no self-intersection, and true-outline containment; zero-length tracks/dimensions refuse; locked footprints refuse; footprint move/rotate proven both ways |
| **§C** fabrication minima | the empirical "narrowest existing copper" floor is DELETED; minima resolve from the ACTIVE `DrcRules` (preset default + the net's own class via shared `getNetClass` + per-net override) and cover track width, clearance, via outer, via drill, and annular ring — on rules, preferences, tracks, and vias, including nets with no copper |
| **§D** padstack denormalization | `getPadstack` + the shared `applyPadstackToVia` set id/size/drill atomically; explicit geometry alongside a padstack refuses as `padstack-conflict`; resulting geometry re-checked against active minima |
| **§E** connectivity identity | order-independent `pairKey` identities for shorts and unknown contacts, and `completionByNet` per net — any NEW identity refuses, and every net complete before stays complete; count-only comparisons are gone |
| **§F** honest readiness | routing completion is named `routingCompletion`; `readiness` reports `{state:"unavailable", reason}` because the compiler consumes no pinned fab/DRC/netlist resources. Routing percentage is never labelled manufacturing readiness |
| **§G** seal consistency | sealing consumes the compiler result as ONE object; verification RECOMPUTES the operations and impact digests, requires `candidateDigest === impact.candidateBoardDigest`, pins the exact tool id/version, bounds the TTL window, and checks minted ids — forged pins are detected |

**Tests: 43/43** (28 corrective + 15 core). Full suite **2817 passed / 20
skipped / 0 failures** (2837; 320 files / 3 skipped). `tsc --noEmit` clean;
scoped ESLint clean; `git diff --check` clean; deterministic pins
unchanged; protected original untouched.

Two errors I made and caught during the work are recorded honestly in
[corrective-closures.md](corrective-closures.md): I first duplicated the
dimension-layer set (with the wrong members) instead of importing the
shared one, and my first minima resolver folded every per-class override,
imposing a power-class floor on signal nets.

## Not built

**§H** the tool descriptor and exposure change (registry is **still 11**,
not 12), gateway/loop extension, the `pcb_proposal_ready` event, provider
parity regeneration, and the review dialog; **§I** the approval capability
and the single-transaction apply path; **§J** durability, recovery, and the
new AST importer gates; **§K** the test areas that depend on them
(invocation/cancel no-mutation, one-transaction, undo/redo, double and
concurrent approval, replay/stale/foreign refusal, switch/retirement/
autosave/crash windows, scripted agent loop, fresh-browser end-to-end,
12-tool exposure).

Nothing is half-wired: the registry, gateway, loop, and `PcbEditor` are
byte-unchanged, so the B15 pre-edit baseline still holds and no new
surface is exposed to any provider.

The eight remaining artifacts (`parser-and-schema-contract`,
`geometry-and-structural-contract`, `rule-and-padstack-authority`,
`connectivity-and-readiness`, `sealed-proposal-integrity`,
`provider-and-agent-flow`, `human-review-and-apply`,
`durability-and-recovery`, `import-authority-gates`, `test-evidence`,
`changed-files`) are not written; the material for the first five is
recorded in [corrective-closures.md](corrective-closures.md).

**B16, MCP, multi-agent work, manufacturing release, external parts
acquisition, 3D control, and destructive PCB editing are NOT started.**

---

> **SUPERSEDED IN PART (B15.2).** Independent verification found SEVEN
> further core defects behind this document's "Sections A–G complete and
> green" claim: the parser still threw on array-length/revoked/index/late-read
> proxies (it re-read the caller's proxy-backed value after inspection);
> outline containment was not exact (roundrect clipped corners, concave edge
> crossings, and dimension render geometry); footprint hard placement
> constraints were ignored; global routing minima resolved only the preset
> default and padstack selection was unchecked; rule deltas were appended
> without taking effect; the local pair identity collapsed pads and zone
> regions; and the seal assembler still minted foreign-tool artifacts,
> verification threw on revoked proxies, and the compiler accepted a
> caller-chosen base identity. All seven are closed and pinned in
> `../ai-control-plane-b15-2/`.
