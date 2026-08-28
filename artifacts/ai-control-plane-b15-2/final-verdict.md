# B15.2 — final verdict

**Stop condition MET for this stage's scope.** R10–R16 all fail closed
permanently, every core test passes, and the agent-exposed tool count is
**exactly 11** — unchanged, as B15.2 requires.

## Evidence

| item | result |
| --- | --- |
| R10–R16 reproduced pre-edit with exact output | [pre-edit-counterexamples.md](pre-edit-counterexamples.md) |
| all seven closed and pinned | [corrective-closures.md](corrective-closures.md) |
| B15.2 closure suite | **20/20** |
| B15 core + B15.1 corrective suites | 15/15 + 28/28 |
| B15 family + B08 canonical/authority + B11.5 exposure + B14.4/B14.5 gates | **145/145** |
| **FULL SUITE** | **2837 passed / 20 skipped / 0 failures** (2857; 321 files passed / 3 skipped) |

`tsc --noEmit` clean; scoped ESLint clean (dead `outlineBounds` removed
once containment moved to the shared authority); `git diff --check` clean;
deterministic pins byte-identical (`e66dd9e0…`, `72ad7c77…`,
`5501d810…`); protected original at its 6-entry baseline. The full suite
passed on its first invocation — no timing flakes to classify.

## What changed

Three files, all core, none exposed:

- `bounded-edit-operations.ts` — §A totality (guarded array primitives, a
  final exception boundary, and the inspect → normalize → measure →
  validate-inert → freeze ordering that stops the parser re-reading the
  caller's value).
- `bounded-edit-compiler.ts` — §B exact containment via `pointInOutline`,
  edge sampling, and `dimensionGeometry`; §C footprint hard constraints and
  `courtyardFitsOutline`; §D board-wide effective minima, padstack
  validation, and updated-track checks; §E semantic `applyRuleDeltas` with
  verified effect, minted/changed id reporting, and truthful AI provenance;
  §F canonical `copperItemId` pair identity; §G internally derived
  `baseIdentity`.
- `sealed-pcb-edit-proposal.ts` — §G `assemblePcbEditProposal` with a
  hard-coded tool identity and full pin recomputation, plus total
  verification.

Two B15 fixtures were corrected because the §E closure made rules
genuinely effective, which correctly surfaced real DRC regressions. No
validator was weakened.

## Not started (correctly)

Registry exposure, gateway/loop integration, `pcb_proposal_ready`, review
UI, approval/apply, durability/recovery, B16, MCP, multi-agent work, and
manufacturing release are all untouched. The registry, gateway, loop, and
`PcbEditor` remain byte-unchanged.

The stage's §G also asks for an AST importer gate on the internal sealer
with an exact current importer set. **That gate is not added** — the sealer
currently has no production importers at all (nothing outside tests imports
it), so an exact-set gate would pin the empty set and would need updating in
B15.3 anyway. It is listed in [unknowns.md](unknowns.md) as the one
deliberate omission from this stage's scope.

**B15.3 may complete H–K once this core is accepted.**

---

> **SUPERSEDED IN PART (B15.2.1).** Independent behavioral verification found
> FIVE remaining fail-open boundaries behind this stage's green suite: the
> compiler read `footprint.placement` instead of the production
> `placementConstraints` (and the fixtures faked that property through
> `never`), so every hard placement constraint was ignored (R17); the
> segment-in-outline test SAMPLED 64 points and missed an arbitrarily narrow
> notch, and collinear-overlap / vertex-on-edge polygons were accepted
> (R18); `update_dimension` skipped rendered-geometry validation (R19);
> `applyRuleDeltas` reset a legacy no-base netClassing to Default and moved
> unrequested fields (R20); and the raw `sealPcbEditProposal` /
> `assemblePcbEditProposal` were public and accepted a fabricated structural
> compiled object, so a forged proposal sealed and verified (R21). All five
> are closed and pinned in `../ai-control-plane-b15-2-1/` — a new exact
> BigInt geometry authority (no sampling), canonical `placementConstraints`
> + full envelope, dimension-update validation, semantic rule verification,
> and a closed import-gated seal boundary with an AST gate. Exposure remains
> exactly 11.
