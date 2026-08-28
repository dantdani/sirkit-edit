# B15.3 — secure PCB proposal exposure, human review, one-shot approval, atomic apply, durability and recovery

**Status: B15 sections H–K COMPLETE. Agent exposure exactly 12 (one PCB
proposal tool). The AI can only PROPOSE; only an explicit human click can
apply the exact proposal, through one canonical transaction.** See
[final-verdict.md](final-verdict.md).

- [pre-edit-counterexamples.md](pre-edit-counterexamples.md) — the 10
  discovery items, and the item-10 gate (unpinned validation policy)
  reproduced and closed BEFORE exposure.
- [tool-and-event-contract.md](tool-and-event-contract.md) — §H: the tool,
  gateway, loop gate, and the distinct `pcb_proposal_ready` event.
- [human-review-safety-contract.md](human-review-safety-contract.md) — §I:
  the review surface, complete evidence, and safety statements.
- [approval-and-apply-authority.md](approval-and-apply-authority.md) — §J:
  why the AI can never mutate, how approval is authenticated/consumed, the
  exact live-state checks, one-transaction proof.
- [durability-and-recovery.md](durability-and-recovery.md) — §J: the PCB
  journal, honest integrity model, all crash windows, authentic vs forged
  recovery.
- [provider-parity-and-redaction.md](provider-parity-and-redaction.md) ·
  [boundary-and-import-gates.md](boundary-and-import-gates.md) — parity,
  redaction, and the AST import boundaries with negative tripwires.
- [test-and-validation-report.md](test-and-validation-report.md) — exact
  counts and commands. [changed-files.md](changed-files.md) ·
  [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md) ·
  [rollback.md](rollback.md).

Full suite **2931 passed / 20 skipped / 0 failures**. 47 new permanent
tests. tsc 0 · scoped ESLint clean · git diff --check clean · artifacts
byte-stable.
