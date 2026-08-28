# B15.2.2 — changed files (exact paths)

## Production

- `app/lib/pcb/geometry-exact.ts` — **added** the exact outline authority:
  `ExactOutline`, `pointInExactOutline` (BigInt corner-circle predicate for
  roundrect), `segmentInExactOutline` (documented convexity invariant for
  rect/roundrect; the full polygon algorithm is retained unchanged). No
  existing predicate was weakened.
- `app/lib/pcb/proposal/bounded-edit-compiler.ts` — `withinBoard` and
  `segmentInsideOutline` now route the board outline through the exact
  authority as-is; removed the `outlinePolygon` import, the
  `OUTLINE_CORNER_SEGMENTS` constant, and the `boardPolygon` chord/rounding
  helper.
- `app/lib/pcb/proposal/sealed-pcb-edit-proposal.ts` — **added**
  `validateProposalShape` (complete closed nested validation) with its
  helpers (`isPlainRecord`, `exactKeys`, `boundedId`, `boundedDigest`,
  `boundedText`, `safeInteger`, `first`), called FIRST in `verifyInner`;
  imports the canonical `parseBoundedEditRequest` and
  `BOUNDED_EDIT_LIMITS`; replaced the partial ad-hoc identity checks.

## Tests

- `app/lib/pcb/proposal/__tests__/b15-2-2-exact-outline-and-shape.test.ts` —
  **new**, 14 permanent tests (§A R22–R22e including the ~9,900-point fuzz,
  §B R23a–R23f, §C allowlist + negative tripwire + exposure).
- `app/lib/pcb/proposal/__tests__/b15-1-corrective-closures.test.ts` — R7c's
  foreign-tool assertion now accepts `malformed` OR `altered`, because the
  refusal correctly moved EARLIER (complete shape validation runs before any
  digest is trusted). The assertion still requires a refusal.

## Not touched

Registry, action registry, agent gateway/loop, `PcbEditor`, provider
adapters, approval/apply, durability/recovery, and every deterministic
artifact generator are byte-unchanged.

---

**SUPERSESSION NOTE (B15.2.3, 2026-08-20):** the "complete closed nested
validation" added here did NOT close the impact certificate — its
`validateImpactShape` remained typeof-level and fail-open (R24). Replaced
in B15.2.3 with the producer-aligned closed contract; see
`../ai-control-plane-b15-2-3/changed-files.md`.
