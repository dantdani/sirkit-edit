# B15.2.2 §C — the seal import boundary is fixed

Unchanged from B15.2.1 and now carrying a standing forward-looking
assertion:

- `rawSealPcbEditProposal` remains in
  `pcb-edit-proposal-sealer.internal.ts` and is NOT exported from any public
  proposal module.
- `pcb-edit-proposal-service.ts` remains the **sole production importer** of
  the raw sealer. The approved set is exactly two modules (the sealer itself
  and the service) and the permanent test asserts that exact list, not just
  "no offenders".
- **B15.3 must NOT extend this allowlist.** The future tool handler must
  import and call `createSealedPcbEditProposal` only. The suite documents
  this explicitly: if a B15.3 change needs the set extended, that is a design
  error in the handler, not a gate update.
- The NEGATIVE tripwire is kept and sharpened: an injected
  `app/lib/pcb/proposal/pcb-propose-tool-handler.ts` importing the raw sealer
  trips the gate — i.e. the exact future filename a careless B15.3 might add.
- Exposure is asserted in the same suite: exactly **11** agent tools, no PCB
  propose tool.
