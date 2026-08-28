# B15.2.2 — true roundrect containment and complete proposal-shape validation

**Status: R22 and R23 behaviorally closed; tool remains UNEXPOSED (registry
exactly 11); raw-sealer allowlist unchanged at two modules.** See
[final-verdict.md](final-verdict.md).

- [pre-edit-counterexamples.md](pre-edit-counterexamples.md) — both
  reproduced against production code with exact output.
- [exact-roundrect-contract.md](exact-roundrect-contract.md) — R22: the
  BigInt corner-circle outline authority (no chords, no rounding).
- [complete-proposal-shape-contract.md](complete-proposal-shape-contract.md)
  — R23: closed nested validation before any digest is trusted.
- [seal-import-boundary.md](seal-import-boundary.md) — §C, including the
  standing assertion that this allowlist must NOT grow in B15.3.
- [validation-evidence.md](validation-evidence.md) — counts, and the
  isolated reproduction of one pre-existing unrelated flake.
- [changed-files.md](changed-files.md) · [unknowns.md](unknowns.md).

Suite: `b15-2-2-exact-outline-and-shape.test.ts` (14). Full suite 2866 pass
/ 20 skip / 0 failures.
