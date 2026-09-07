/**
 * Locale-free string comparators for identity-bearing canonicalizers.
 *
 * Why this module exists (B16-A review finding F8): every identity in the
 * manufacturing release chain — the recorded-router fixture keys
 * (`pcbRevisionId` of the placed board), board revision and digests, the
 * qualification-authority record digest, the release manifest digest, the
 * ledgered `releaseId`, the archive sha256, plus the pcb-sync snapshot/plan
 * digests and the physical-binding digests — is a hash over a canonical form
 * whose object keys and unordered arrays are SORTED. When that sort is
 * `String.prototype.localeCompare` with no explicit locale, the order (and so
 * the identity) depends on the host's ICU default collation, which Node picks
 * up from `LANG`/`LC_ALL` on POSIX and from the user locale on Windows. Under a
 * Lithuanian default locale `{x, y}` canonicalizes as `{y, x}`; nothing in CI
 * pins a locale. An identity that changes with the machine is not an identity.
 *
 * Both comparators below consult nothing but the code units of their inputs.
 * They never call `localeCompare`, `Intl.Collator`, or any locale-aware
 * case-mapping API, so they produce the same answer on every host, in every
 * process, regardless of ICU data, `LANG`, or `Intl` availability.
 *
 * They are deliberately NOT drop-in reproductions of the ICU root collation:
 * ICU orders punctuation before digits before letters and folds case at the
 * primary level; code-unit order interleaves them (`"A" < "_" < "a"`,
 * `"1" < ":"`). Callers that switch from `localeCompare` therefore get a
 * different (stable) order for mixed-case or punctuated inputs, and any
 * identity recorded under the old comparator must be re-recorded once.
 */

/**
 * Total order on strings by UTF-16 code unit, i.e. the order the ECMAScript
 * `<` / `>` operators define (ES2023 §7.2.13 IsLessThan, string case) and the
 * order `Array.prototype.sort()` uses when given no comparator. Deterministic
 * on every engine; no locale, ICU, or `Intl` involvement.
 *
 * For strings with no surrogate pairs this is exactly code point order. With
 * surrogate pairs it is still a consistent total order (code-unit order), which
 * is all a canonicalizer needs.
 *
 * Use this for every plain `a.localeCompare(b)` in an identity-bearing sort.
 */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export interface NaturalCompareOptions {
  /**
   * Fold case before comparing (the intent of `localeCompare(..., { sensitivity: "base" })`).
   * Folding uses `String.prototype.toLowerCase`, whose mapping is the
   * locale-independent Unicode default case mapping (unlike
   * `toLocaleLowerCase`). Strings that differ only by case are still ordered
   * deterministically by the final code-unit tie-break.
   */
  caseInsensitive?: boolean;
}

const CODE_ZERO = 48; // "0"
const CODE_NINE = 57; // "9"

function isAsciiDigit(code: number): boolean {
  return code >= CODE_ZERO && code <= CODE_NINE;
}

/**
 * Digit-run-aware ("natural") total order for reference designators, pin and
 * pad numbers and similar identifiers, replacing
 * `a.localeCompare(b, undefined, { numeric: true })`.
 *
 * Rules, applied left to right on the (optionally case-folded) inputs:
 *  1. When BOTH strings have an ASCII digit run at the current position the
 *     runs compare by numeric value (leading zeros ignored): `R2 < R10`,
 *     `pin7 < pin12`, `007 == 7` at this step. Only ASCII `0`–`9` count as
 *     digits; no locale digit tables are consulted.
 *  2. Otherwise the current code units compare numerically (`compareCodePoints`
 *     semantics for that position).
 *  3. When one string is exhausted the shorter one sorts first: `R1 < R1A`.
 *  4. Anything still tied (`007` vs `7`, or `r1` vs `R1` under
 *     `caseInsensitive`) is broken by `compareCodePoints` on the ORIGINAL
 *     inputs, so the result is a total order and `sort` is reproducible.
 *
 * The output is a pure function of the two inputs' code units.
 */
export function compareNatural(a: string, b: string, options?: NaturalCompareOptions): number {
  if (a === b) return 0;
  const fold = options?.caseInsensitive === true;
  const x = fold ? a.toLowerCase() : a;
  const y = fold ? b.toLowerCase() : b;
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    const cx = x.charCodeAt(i);
    const cy = y.charCodeAt(j);
    if (isAsciiDigit(cx) && isAsciiDigit(cy)) {
      // Skip leading zeros, then find the end of each digit run.
      let startX = i;
      let startY = j;
      while (startX < x.length && x.charCodeAt(startX) === CODE_ZERO) startX += 1;
      while (startY < y.length && y.charCodeAt(startY) === CODE_ZERO) startY += 1;
      let endX = startX;
      let endY = startY;
      while (endX < x.length && isAsciiDigit(x.charCodeAt(endX))) endX += 1;
      while (endY < y.length && isAsciiDigit(y.charCodeAt(endY))) endY += 1;
      // A run of only zeros has an empty significant part; treat it as 0.
      const lengthX = endX - startX;
      const lengthY = endY - startY;
      if (lengthX !== lengthY) return lengthX < lengthY ? -1 : 1;
      for (let k = 0; k < lengthX; k += 1) {
        const dx = x.charCodeAt(startX + k);
        const dy = y.charCodeAt(startY + k);
        if (dx !== dy) return dx < dy ? -1 : 1;
      }
      i = endX;
      j = endY;
      continue;
    }
    if (cx !== cy) return cx < cy ? -1 : 1;
    i += 1;
    j += 1;
  }
  const remainingX = x.length - i;
  const remainingY = y.length - j;
  if (remainingX !== remainingY) return remainingX < remainingY ? -1 : 1;
  return compareCodePoints(a, b);
}
