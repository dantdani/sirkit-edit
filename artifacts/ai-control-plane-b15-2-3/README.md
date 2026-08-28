# B15.2.3 — closed impact-certificate validation

**Status: R24a/b/c behaviorally closed; tool remains UNEXPOSED (registry
exactly 11); raw-sealer allowlist unchanged at two modules.** See
[final-verdict.md](final-verdict.md).

- [pre-edit-counterexamples.md](pre-edit-counterexamples.md) — all three
  R24 variants reproduced against production code with exact output
  (`{ok:true}` each, with recomputed public checksums).
- [closed-impact-contract.md](closed-impact-contract.md) — the complete
  closed impact contract, aligned with the one authoritative producer
  (`compileBoundedPcbEdit`), including the producer-exported
  `BOUNDED_EDIT_IMPACT_LIMITS` ceilings and the canonical-order rules
  (and where order is deliberately NOT invented).
- [validation-evidence.md](validation-evidence.md) — exact counts.
- [changed-files.md](changed-files.md) · [unknowns.md](unknowns.md).

Suite: `b15-2-3-impact-certificate.test.ts` (18). Supersession notes added
to three B15.2.2 documents that overstated "complete" nested validation.
