# B14 §A — the replacement proposal tool contract

`sirkit.schematic.propose-component-replacement` v1.0.0
([tool-catalog.ts](../../app/lib/engineering/tool-catalog.ts)) — the ELEVENTH
agent-exposed tool.

- `operationClass: "propose"`, `sideEffects: "proposal-artifact"`,
  `binding: bound-proposal` → `assembleReplacementProposal`;
- owned by the NEW propose action `schematic.replace-component-propose`
  (action-registry) — the destructive `schematic.replace-component` command
  keeps `toolExposure: "none"` and apply is NEVER provider-callable (no
  apply tool exists; the gateway refuses every non-read/propose class);
- statically exposed; per-run availability requires ALL of: canonical state,
  a verified schematic snapshot + digest, the canonical head mark + lineage,
  and the B13 `component-authority-records` resource (loop gating with
  truthful withholding reasons);
- the gateway re-checks context integrity, fresh discovery inclusion,
  role+capability against the effective actor, snapshot, head mark, and the
  authority resource before the assembler ever runs.

## Input — intent, never authority

```json
{ "componentId": "stable component instance id", "expectedMpn": "optional assertion" }
```

`expectedMpn` is an expected-value assertion that must equal the B13
exactAuthority MPN — it can never choose the target. UNKNOWN KEYS REFUSE:
`atomicPartRevisionId`, `symbolAssetVersionId`, `footprintAssetVersionId`,
`mappingCertificateId`, `selectionRecordId`, pin definitions, authority
statuses, approval claims, and dropped-pin acknowledgements were each proven
refused as `invalid_input` (b14-replacement-proposal suite).

## The strict envelope (structured blockers, zero mutation)

| out of scope | blocker |
| --- | --- |
| unknown component | `unknown-component` |
| theory component | `theory-component-unsupported` |
| authority not verified-exact (unresolved/stale/conflicted/no exactAuthority) | `authority-not-verified-exact` |
| expectedMpn ≠ server target (incl. permitted alternatives) | `expected-mpn-mismatch` |
| target already installed (all six identity fields) | `already-installed` (structured no-op) |
| instance without atomic/symbol identity | `current-authority-missing` |
| current pin facts absent/mismatched | `current-pin-authority-unavailable` |
| target pin facts absent/unpublished/mismatched | `target-pin-authority-unavailable` |
| certificate cannot be corroborated | `mapping-certificate-mismatch` |
| run context not at the claimed head | `canonical-head-mismatch` |
| consume refusal (bundle/scope/revision/asset) | `authority-consumption-refused` |
| non-identity mapping, pin-count-only match, would-drop connected pin, ambiguous label move | `replacement-plan-refused` |

A valid call returns the sealed artifact; it NEVER executes, and the
proposal-time runtime grant is retired before the artifact leaves the server
(proven: the sealed `authorityGrantId` fails `grant_missing` immediately
after sealing).
