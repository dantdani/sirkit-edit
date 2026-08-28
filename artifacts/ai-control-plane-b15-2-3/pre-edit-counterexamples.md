# B15.2.3 — pre-edit counterexamples (R24), reproduced verbatim

Probe: a genuine proposal was created with `createSealedPcbEditProposal`
(rect board, net 1, track t1, one `update_track` operation). For each
mutation the `impactDigest` and `proposalId` were recomputed with the PUBLIC
checksum algorithms (`engineeringDigest` over
`sirkit.pcb-bounded-edit-impact.v1` and
`sirkit.pcb-bounded-edit-proposal-id.v1`), then
`verifySealedPcbEditProposalIntegrity` was called against the UNMODIFIED
production verifier. Disposable probe
(`b15-2-3-probe.test.ts`) deleted after capture.

## Exact recorded output

```
B15_2_3_PROBE {"r24a_wrongSchema":{"ok":true},"r24b_unknownNestedFields":{"ok":true},"r24c_invalidNumerics":{"ok":true},"genuine":{"ok":true}}
```

- **R24a** — `impact.schema = "sirkit.evil-impact.v999"` → **`{ok:true}`**.
  The verifier required only `typeof impact.schema === "string"`.
- **R24b** — `impact.untrustedAuthority = {allow:true}`,
  `impact.drc.untrusted = "accepted"`, `impact.readiness.extra = "accepted"`
  → **`{ok:true}`**. No nested key set was closed.
- **R24c** — `impact.affectedNetIds = [1.5, -2, Number.MAX_VALUE]`,
  `impact.routingCompletion.beforePercent = Infinity` → **`{ok:true}`**. Any
  JavaScript number was accepted — NaN, ±Infinity, fractions, negatives,
  unsafe magnitudes.

## Cause (confirmed in the pre-edit source)

`validateImpactShape` in `sealed-pcb-edit-proposal.ts` checked only
`typeof`-level shapes: `schema` was "a string", nested objects needed only
the EXPECTED keys to be numbers/strings (extra keys ignored), arrays needed
only element `typeof`, and there were no bounds, no canonical order, and no
arithmetic relationships. The digest recomputation then certified whatever
passed, because the digest is (correctly) an integrity checksum over the
presented body — the STRUCTURAL validation in front of it was incomplete.
