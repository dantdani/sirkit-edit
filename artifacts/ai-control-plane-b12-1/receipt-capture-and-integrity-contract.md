# B12.1 §D — receipt capture and content integrity

Supersedes: B12's `execution-receipt-schema.md` validator section (the
schema fields themselves are unchanged:
`sirkit.approved-agent-mutation-receipt.v1`, same 20 keys, same bounds).

## What was wrong

B12's validator was reflection-first over the RAW object: `key in receipt`
walked the prototype chain, values were read directly (through getters, if
any), no own-property boundary existed, and no field was bound to the
receipt's identity. R3, all with **zero issues**:

1. `transactionId` + matching `undoReference.transactionId` both forged —
   the only cross-check was undo ≡ transaction;
2. `schematicDigestAfter` forged to another valid `eng1-` digest;
3. `Object.create(validReceipt)` — zero own properties, everything
   inherited.

## The corrected validator

`validateApprovedMutationReceipt(raw)` is now **capture-first**:

1. **`capturePlainJson(raw, "receipt", 32_768)`** — the B11 capture
   discipline: own enumerable DATA properties only; refuses inherited
   properties (`Object.create` captures `{}` → missing keys; a non-Object
   prototype refuses outright), accessors (refused before invocation),
   symbols, cycles, functions, non-JSON values, non-finite numbers,
   hostile/revoked proxies, **depth > 32, > 200k nodes, > 100k-char strings
   — bounds enforced DURING traversal**, plus a 32KB serialized ceiling.
   Work is bounded by the walk itself, not by capping reported issues.
2. **Exact closed key set** over the captured record — unknown and missing
   keys refuse (≤ 12 bounded, sanitized diagnostics).
3. **Per-field structural checks** on the CAPTURED values (patterns,
   bounds, closed vocabularies, exact-two-key head marks and undoReference,
   headAfter = headBefore + 1, undo ≡ transaction).
4. **Content integrity**: `receiptId` is RECOMPUTED from the captured body
   (every field except `receiptId`) with the exact production digest schema
   — `amr-` + `engineeringDigest({ schema:
   "sirkit.approved-mutation-receipt-id.v1", body })` — the same
   `receiptIdFor` function production uses to mint receipts — and compared
   exactly. Canonical JSON (sorted keys) makes the comparison
   insertion-order-independent.

Never throws (capture is total; post-capture data is owned plain JSON; a
final defensive catch remains); returns at most 12 typed diagnostics.

## No field is outside the digest

Every one of the 19 non-`receiptId` fields participates in the recomputed
digest, so **every single-field mutation to another syntactically valid
value fails** — proven by a systematic 20-case battery (one mutation per
receipt key, including consistent multi-field forgeries: both head marks
shifted together, transactionId + undoReference changed together). No
exemption exists, so none needs justification.

## Integrity is not authentication

The recomputed digest proves the receipt **content** is the content the
service minted — it does NOT make a receipt self-authenticating. Anyone who
can run `engineeringDigest` can construct an internally consistent
receipt-shaped object. Receipt **authority** comes from the trusted
execution/adoption service that minted it inside the interactive
composition root, and from the durable canonical transaction
(`transactionId` / `undoReference`) it references, which independent
verification can check against the store's transaction log. The validator's
job is to make undetected TAMPERING impossible, not to mint trust.

## Content exposure, unchanged

Receipts still carry only safe metadata — no schematic payloads, prompts,
provider text, secrets, or credentials (locked by the existing B12 §B
content test, which still passes).

## Evidence

`b12-1-adoption-identity-receipt.test.ts` R3 group: the three original
forgeries fail; the 20-case systematic battery fails every field; inherited
properties, accessors, symbols, cycles, non-finite numbers, depth bombs,
oversized strings, revoked and throwing proxies all refuse without
throwing; issue lists stay ≤ 12. The updated B12 §B suite keeps the
bounded/hostile/tamper cases green under the new validator.
