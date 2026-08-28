# B11.7 — regression matrix

**10 tests** in
[`b11-7-primitive-discipline.test.ts`](../../app/lib/agent/__tests__/b11-7-primitive-discipline.test.ts).
Every assertion drives production code; the reusable JSON-invariant helper only
inspects results, it never substitutes for a production check.

| # | Required proof | Test |
| --- | --- | --- |
| 1 | All five non-JSON primitive roots refuse from all projection entry points | §A "1: all non-JSON primitive roots REFUSE from every projection entry point" — six values (both infinities) × three projectors + `validateBoardShape`, each agreeing with capture, each bounded ≤ 12 and deterministic across repeated calls |
| 2 | BigInt never escapes in a result | §A "2/3/4" — refused, and `JSON.stringify` of the refusal itself does not throw |
| 3 | NaN and Infinity are not silently normalized to null | §A "2/3/4" — refused at the root, and a NESTED `NaN` refuses the whole board with a `finite` issue |
| 4 | undefined and Symbol cannot disappear from an ok:true serialized result | §A "2/3/4" — they can no longer reach an `ok: true` result at all; refusal results are value-free by construction; §C additionally proves `value` survives serialization for every `ok: true` case |
| 5 | Valid JSON primitive roots receive structural board/context issues | §A "5" — `must be a plain object` for all six roots through both projectors, closing the empty-issue case; `validateReplayContext` never accepts them |
| 6 | `isCapturedRecord` is truthful for every listed case | §B "6" — ordinary/frozen/Date/benign-proxy false; revoked false without throwing; captured object and nested captured object true; captured array false; projected containers false with the wrong-typed carried-subtree exception asserted true |
| 7 | Every successful result satisfies the recursive JSON invariant | §C "7" — primitives, valid/invalid boards, valid/invalid contexts, all 19 committed contexts, and `__proto__`/`constructor`/`prototype` special keys |
| 8 | No successful projection shares caller object identity | §D "8" — identity-walk over a board with a wrong-typed carried subtree |
| 9 | Hostile proxy totality remains green | §D "9" — revoked, all-throwing, stateful-ownKeys × six boundaries |
| 10 | All previous B11.6 counterexamples remain closed | §D "10" + the full `b11-6-projection-ownership` suite (17) green |
| 11 | All 19 pins remain unchanged | §D "11" + generator byte-identical ×2 |
| 12 | No test writes repository paths | §D "12" + the repo-wide scan in `b11-5-capture-exactness` |

## Carried forward, unchanged and green

B11 16 · B11.1 30 + 9 · B11.2 20 · B11.3 34 · B11.4 17 + 4 · B11.5 18 ·
B11.6 17 — **B11 family 175 / 175** (10 files). Evaluation matrix 19 / 19
cases, 59 / 59 checks.

No test, schema, security rule, performance threshold, or exposure gate was
weakened. No existing test needed modification: the corrected behaviours were
untested surface.
