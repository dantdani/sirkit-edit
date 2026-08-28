# B12 §B — the execution receipt schema

> **SUPERSESSION NOTE (B12.1).** The validator described here was
> reflection-first and digest-free: a consistent transactionId+undoReference
> forgery, a forged schematicDigestAfter, and `Object.create(validReceipt)`
> each validated with zero issues (counterexample R3). Superseded by
> `../ai-control-plane-b12-1/receipt-capture-and-integrity-contract.md`
> (capture-first validation, receiptId recomputed from the captured body).
> The receipt schema id and field set are unchanged. Preserved as
> historical evidence.


Schema id: **`sirkit.approved-agent-mutation-receipt.v1`**
Type: `ApprovedMutationReceipt`
Validator: `validateApprovedMutationReceipt(raw: unknown): string[]` — total, bounded, never throws.

A receipt is a **bounded plain-JSON proof of one verified canonical commit**. It
exists only for a commit that passed every §D postcondition. It contains **only
safe metadata** — never schematics, boards, prompts, provider bodies, tool
arguments, credentials, or unrestricted error strings.

## Fields

| Field | Type | Meaning / constraint |
| --- | --- | --- |
| `schema` | `"sirkit.approved-agent-mutation-receipt.v1"` | exact literal |
| `receiptId` | `string` | `amr-<hex16..64>`; a digest over the receipt body |
| `proposalId` | `string` | `prop-<hex8..64>` |
| `operationsDigest` | `string` | `eng1-<hex8..64>` — the sealed operations digest |
| `originRunId` | `string \| null` | originating agent run/trace identity, stored OUTSIDE the sealed proposal and OUTSIDE the frozen trace; ≤128 chars |
| `commandId` | `"schematic.edit-tier1-apply"` | the one canonical command — the closed vocabulary |
| `tenantId` / `projectId` / `branchId` | `string` | `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$` |
| `lineageId` | `string` | `lin1-<hex8..64>` |
| `headBefore` | `{ headSequence:int≥0, canonicalStateDigest: eng1-… }` | exactly two keys |
| `headAfter` | `{ headSequence:int≥0, canonicalStateDigest: eng1-… }` | exactly two keys; must advance `headBefore` by **exactly one** |
| `schematicDigestBefore` / `schematicDigestAfter` | `string` | `eng1-…` |
| `transactionId` | `string` | 1..128 chars — the canonical transaction |
| `operationCount` | `int` | 1..256 |
| `destructive` | `boolean` | mirrors the sealed proposal's impact |
| `postconditions` | `"verified"` | a receipt exists **only** for a verified commit |
| `undoReference` | `{ kind:"canonical-transaction", transactionId }` | exactly two keys; `transactionId` **must equal** the receipt's |
| `completedAt` | `number` | finite; deterministic/injectable clock |

## The validator is total and bounded

```ts
validateApprovedMutationReceipt(raw: unknown): string[]
```

- Accepts **arbitrary hostile input** and returns issues instead of throwing —
  the entire reflective body is inside a `try`, so a revoked proxy or hostile
  accessor yields `["receipt is not reflectable (revoked or hostile proxy)"]`.
- **Bounded:** at most 12 issues (`push` no-ops past the cap); unknown keys are
  sanitized (`[^\x20-\x7e]→?`, sliced to 40 chars) before being echoed.
- **Closed key set:** unknown keys and missing keys are reported; a
  structurally wrong object short-circuits before value checks.
- **Cross-field invariants:** `headAfter.headSequence === headBefore + 1`;
  `undoReference.transactionId === transactionId`; `postconditions === "verified"`.

## Self-validation before the receipt is claimed

`applyApprovedTier1Proposal` builds the receipt, then runs it through
`validateApprovedMutationReceipt`. If any issue is returned, the identity is
**poisoned** and the outcome is `postcondition-failed` — the service refuses to
present an unvalidated receipt as proof of a verified commit.

## What a receipt deliberately omits

No schematic state, no operation payloads, no component values, no prompt text,
no provider request/response, no credentials, no raw exception strings. A
receipt is safe to log, display, and persist. The permanent test
*"the receipt contains no schematic, prompt, or unrestricted content"* asserts
this against the serialized receipt.

## The separate audit ledger (§E)

Schema: **`sirkit.approved-mutation-audit.v1`** — a bounded (256-entry),
append-only, deep-frozen in-memory ledger. Because approval happens **after**
the run trace finalizes (R10), post-run execution outcomes live here, not in the
immutable trace. Events: `approval-displayed`, `canceled`, `apply-started`,
`refused`, `committed-verified`, `undo-observed`. Refusal codes are a closed
vocabulary: `session-not-ready`, `verification-failed`, `already-in-flight`,
`already-applied`, `identity-poisoned`, `command-rejected`, `command-failed`,
`postcondition-failed`. Never raw exception or provider text.
