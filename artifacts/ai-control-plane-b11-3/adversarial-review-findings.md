# B11.3 — adversarial review findings

After the six required closures were implemented and green, four independent
audit lenses were run against the new code (generator soundness, projector
bypass, context integration, test/gate quality), each required to demonstrate
defects **by execution** rather than by inspection.

They found a real class of bypass that the B11.3 implementation did not close
and that **B11.1 and B11.2 had also missed**; a test that could corrupt a
production source file; four tests that proved much less than they claimed; two
hardening items; and one documentation drift. Every finding below was
independently reproduced before being fixed, and every fix is a permanent
regression.

---

## 1. CRITICAL — the ARRAY blind spot

**Reproduced.** An own property attached to an **array** was invisible to every
gate:

```js
const board = createEmptyBoard();
board.nets.smuggled = { deep: 1 };
```

```
{"boardIssues":[],"roundTripEqual":true,"contextOk":true,
 "readableAfterProjection":true,"jsonStringifySees":false}
```

* `findNonPlainJsonPath` returned early for arrays — the prototype / symbol /
  non-enumerable / accessor discipline applied to **plain objects only**.
* `findSecretShapedPath` had the identical early return, so a credential parked
  on an array (`nets.apiKey = "sk-live-…"`) was never seen.
* `JSON.stringify` and `canonicalJson` both walk arrays **by index**, so the
  serialized secret scan was blind too.
* The projector's `.map` **did** drop the property — but `canonicalJson` was
  equally blind on both sides, so the round-trip compared equal.

Net effect: `validateReplayCapsule` returned `[]`, `validateReplayContext`
returned `ok: true`, and a full `replayCapsule` run executed to the **unchanged
pinned digest** while the smuggled value stayed readable on the object that
became `canonicalState.pcb`.

This is the same species of defect as B11.1's prototype-carried fields, one
container kind further out — and it was **not** specific to the new PCB
projector: it applied to `capsule.steps`, `context.schematic.components`,
`context.netlist.nets`, and `context.selection.refs` too.

## 2. CRITICAL — an accessor at an array INDEX defeated time-of-check/time-of-use

**Reproduced.** `value.entries()` **invokes** a getter, so the accessor refusal
("must be a data property, not an accessor") never fired for array elements:

```js
Object.defineProperty(capsule.context.board.tracks, 0, {
  get: () => (armed ? FORGED : CLEAN), enumerable: true, configurable: true,
});
```

`validateReplayCapsule` returned `[]` against the clean value; after `armed`
flipped, every later read — including `assembleAgentRunContext` building
`canonicalState.pcb` — saw the forged track, and the executed run's digest
drifted from the committed pin. **The board that executed was not the board
that was validated.** The identical accessor one level deeper, on the *object*
`tracks[0].start`, was correctly refused — which is what made the array-only
gap so easy to miss.

## 3. HIGH — function-valued and non-enumerable array properties

Same root cause: a function-valued own property and a non-enumerable own
property both survived `findNonPlainJsonPath` when attached to an array.

## 4. MEDIUM — budget exhaustion made the round-trip vacuous

Once `budget.exhausted` was set, `walk` returned the **raw** subtree with no
issues, so anything walked afterwards was neither projected nor reported. The
round-trip then held *because nothing was projected*, not because nothing was
droppable. The reporter could not turn this into an end-to-end accept (the
bound itself always produced one issue), so it was a soundness-of-argument
defect rather than an exploit — but the argument is the deliverable here.

## 5. HIGH (latent) — generic types would collapse onto one descriptor node

The descriptor node id is `<file>#<TypeName>`, which carries no type arguments.
A local generic `Foo<A>` and `Foo<B>` would collapse onto one node and the
second instantiation would silently be described by the first. **No reachable
PCB type is generic today** (verified: no `export interface X<…>` or
`export type X<…>` in any of the eight contributing files), so this was latent,
not live — but a wrong descriptor is worse than no descriptor.

## 6. CRITICAL — the drift-gate test could corrupt `app/lib/pcb/types.ts`

**Reproduced, and it actually happened during this stage.** The §E drift test
mutated the production declaration in place and restored it in `finally`. Three
of four runs left the file damaged, and once damaged the harm is
self-perpetuating: the next run reads the corrupted file as its own `original`
baseline, so `finally` faithfully restores the corruption and the test's own
`expect(readFileSync(target)).toBe(original)` assertion **passes**.

During this session the file was left at 14 736 bytes (`PcbBoard.texts`
deleted, `formatVersion: 1` duplicated, CRLF normalized to LF) by concurrent
runs. It was caught by the descriptor's **source digest**, repaired, and
re-verified back to `sha256-cf412478820e4a9930a88b8c95e9cdbf`. The test was
then redesigned to generate from a disposable copy — production sources are
never opened for writing.

## 7. HIGH — the EXHAUSTIVE sweep was satisfied by hand-rolled test helpers

**Reproduced.** Mocking `validateBoardShape` to `() => []` and
`projectBoardForReplay` to identity left the sweep **passing verbatim**: its
refusal assertion was satisfied by `validateBoardShapeAt` (a one-level,
test-local key check) and its drop assertion by `projectNodeValue` (a
test-local re-implementation). Measured over 156 object nodes, the production
`validateBoardShape` never mentioned the injected key for 84 of them, and for
the other 72 only as a **root-level** issue — because each synthesized fragment
was validated as if it were an entire `PcbBoard`. No node was validated in its
nested position.

## 8. HIGH — the whole suite passed with a projector broken below depth 5

**Reproduced.** A mechanically-derived copy of the projector that carried
objects wholesale below depth 5 (and below depth 8) passed all 26 non-§E tests.
The deepest probe in the suite was `board.tracks[0].start`; there are 570
legitimate object positions at depth ≥ 6.

## 9. MEDIUM — the "no second key table" gate was trivially evadable

**Reproduced.** It checked 10 of 21 `PcbBoard` field names, and only in
double-quoted form. A complete single-quoted table, an object-literal table
with bare keys, and a double-quoted table of the 11 unchecked names all passed.

## 10. MEDIUM — the "rich board" had no nested elements at all

**Reproduced.** `synthesize()` returned `[]` for every array, so the "rich"
board was 934 characters with every array empty — which is why the depth-5
broken projector still passed its byte-equivalence round-trip.

## 11. HIGH (found while fixing 7–10) — the credential denylist rejected a DECLARED PCB field

Building a genuinely maximal board immediately surfaced a false positive:
`authorizationPolicyId` (a constraint waiver policy identifier, one of 388
declared PCB field names) trips the `authorization` stem and made a completely
legitimate board refuse. A denylist that rejects honest data is a broken
denylist.

## 12. LOW — stale version strings in B11 documentation

`artifacts/ai-control-plane-b11/deterministic-replay-contract.md` still
advertised capsule v2 / context v1 after the B11.3 bump.

---

## Fixes

| # | Fix |
| --- | --- |
| 1, 2, 3 | `findNonPlainJsonPath` now applies the **full discipline to arrays**: `Array.prototype` required, no symbol keys, own property names must be dense index strings only, every index descriptor must be an **enumerable data property** (descriptors are read, never values), and sparse arrays refuse. `findSecretShapedPath` walks array **own property names**, not just indices. `walkDiscipline` (replay-context) and `Walker.walkArray` (projector) each repeat the check so all three gates are sound independently. |
| 4 | Union attempts now **charge their work** to the shared node counter (so N variants cannot multiply the traversal allowance) and never count as clean if their own attempt exhausted; `validateBoardShape` refuses unconditionally when the traversal exhausted with no other issue. |
| 5 | The generator **fails closed** on a local generic named type, naming the file and type and stating the two ways forward. |
| 6 | `--entry=` / `--emit-to=` were added to the generator so the drift proof generates from a **disposable copy**; the test now proves *mutation ⇒ descriptor moves* and, separately, *descriptor differs ⇒ `--check` fails*. Production sources are never opened for writing, and the test asserts byte-identity afterwards. |
| 7, 8, 10 | The sweep now synthesizes a **MAXIMAL board** (every optional slot, one element per array, one entry per record), asserts it validates clean and round-trips, then injects an unknown key at **every object position inside that value** and asserts the **production** validator refuses it there and the **production** projector drops it. The two hand-rolled helpers are deleted. A **mutation test** re-runs the depth ≥ 6 positions and asserts none survives. |
| 9 | The gate now measures **density** after stripping comments — no statement may mention three or more of the 21 declared field names in any spelling (double-quoted, single-quoted, backticked, bare key). A **mutation test** proves it catches every evasion the review proposed and does not fire on a comment-only mention. |
| 11 | Field names the authoritative schema **declares** are exempt from the credential **name** check — and only the name check; their values are still scanned. The exemption set is derived from the generated descriptor (`PCB_DECLARED_FIELD_NAMES`), never hand-typed, and a regression pins the tripping set to exactly `["authorizationPolicyId"]` so a newly declared credential-shaped field fails CI. |
| 12 | The B11 and B11.1 documents were corrected to the current versions. |

## Verification after the fixes

| Probe | Result |
| --- | --- |
| array-attached own property | `capsule.context.board.nets.smuggled` → refused at board, context and capsule level |
| array-attached credential | `["capsule.context.board.nets.apiKey: an array must carry only index properties"]`, no value echoed |
| accessor at array index | `["capsule.context.board.tracks[0]: must be a data property, not an accessor"]`, `replayCapsule` throws `ReplayCapsuleInvalidError` |
| function-valued array property | `board.tracks.hook: an array must carry only index properties` |
| `capsule.steps` / `selection.refs` / `schematic.components` / `netlist.nets` | all refuse |
| budget exhaustion | refuses (`board.nets: exceeds 20000 entries`) |
| **honest data** | all 19 capsules still validate and replay to their unchanged pinned digests |

Seven permanent regressions were added for the array family, plus three
mutation tests that check the tests themselves and one pinning the declared-name
exemption — bringing the suite to **33 tests**.

| Probe | Result |
| --- | --- |
| sweep against a depth-cut projector | every depth ≥ 6 position is caught; zero survivors |
| key-table gate against four evasion tables | all caught; a comment-only mention is not |
| `authorizationPolicyId` carrying a credential VALUE | refuses, value never echoed |

## A note on scope

Finding 1 is a defect in **B11.1/B11.2 code**, surfaced by a B11.3 review. It
is fixed here rather than deferred, and the affected B11.1/B11.2 documents'
claims about the whole-capsule secret scan should be read with this correction
in mind: before this fix, that scan was blind to array-attached keys.

Findings 6–10 are defects in **B11.3's own tests**, i.e. in the evidence rather
than in the product. They are recorded at full severity because a test that
passes against a broken implementation is worse than no test: it converts an
open question into a false claim.
