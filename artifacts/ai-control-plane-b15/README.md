# B15 — sealed bounded PCB-edit proposals (INCOMPLETE — partial increment)

**Status: the stop condition is NOT met.** See
[final-verdict.md](final-verdict.md) for the precise built/not-built split.

This directory documents a verified PARTIAL increment of B15: the
server-side proposal core. The AI cannot yet create a PCB proposal — the
tool is not exposed and the gateway does not know the class — so the
pre-edit baseline recorded in
[pre-edit-counterexamples.md](pre-edit-counterexamples.md) still holds
exactly (11 exposed tools, no PCB proposal class, no provider route to
`commitPcbCandidate`). Nothing is half-exposed.

## Built and green

| piece | file |
| --- | --- |
| bounded operation contract (13 forms, 9 mandated intents, strict/hostile-input validation, bounds, deterministic id minting) | `app/lib/pcb/proposal/bounded-edit-operations.ts` — [contract](bounded-operation-contract.md) |
| the ONE shared compiler (resolve → mint → isolated candidate → canonical B08 delta → DRC/connectivity validation → deterministic impact) | `app/lib/pcb/proposal/bounded-edit-compiler.ts` |
| the sealed PCB proposal `sirkit.pcb-bounded-edit-proposal.v1` (PCB-specific identity; no schematic fields) | `app/lib/pcb/proposal/sealed-pcb-edit-proposal.ts` |
| the safe, authority-free event discriminator | `app/lib/project/pcb-proposal-events.ts` |
| 15 permanent tests | `app/lib/pcb/proposal/__tests__/b15-bounded-edit-core.test.ts` |

## Not built

The tool descriptor and exposure change (still **11**, not 12), gateway/loop
wiring and the `pcb_proposal_ready` event, the review UI, the approval
capability, the apply/commit path, durability and recovery, the import
gates, and test areas 12–27. Listed precisely in
[final-verdict.md](final-verdict.md); open questions for the owner are in
[unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md).
