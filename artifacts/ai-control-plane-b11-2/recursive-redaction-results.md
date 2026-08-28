# B11.2 §B/§C — recursive key and value security scan

> **EXTENDED BY B11.5.** The classifier described here is unchanged, but it now
> lives in the dependency-neutral `app/lib/agent/redaction.ts` so the CAPTURE
> layer shares it too — B11.5 R2 showed `plain-capture.ts` had its own
> ASCII-only key sanitizer that leaked untrusted key content into diagnostics.
> Credential-shaped path segments now collapse to a stable `[redacted-key]`
> classification. See
> [../ai-control-plane-b11-5/diagnostic-redaction-proof.md](../ai-control-plane-b11-5/diagnostic-redaction-proof.md).

> **EXTENDED BY B11.4.** The recursive credential scan is unchanged, but it
> now runs on a CAPTURED snapshot rather than the caller's object, so a
> `toJSON` hook can no longer run before it and a later mutation can no longer
> change what was scanned. See
> [../ai-control-plane-b11-4/hook-free-capture-contract.md](../ai-control-plane-b11-4/hook-free-capture-contract.md).

> **UNCHANGED BY B11.3, and re-proven.** The recursive credential scan
> described here still runs over the whole replay context, including board
> content, and still precedes the board shape walk. B11.3 adds a regression
> that buries a credential-shaped string deep inside a structurally exact board
> and proves it refuses without echoing the value.

Closes **R2**, **R3**, and **R4**.

## The single shared classifier

`app/lib/agent/trace.ts` now owns one credential-name authority used by both
boundaries:

```ts
foldFieldName(name)          // lowercase, strip every non-alphanumeric
isCredentialShapedName(name) // folded-EXACT set ∪ unambiguous compound stems
findSecretShapedPath(value)  // bounded recursive walk → redacted path | null
```

`isForbiddenCapsuleKey` in `replay-capsule.ts` delegates to
`isCredentialShapedName`, so the capsule and trace boundaries **cannot drift
apart again** — the drift between them was R2's root cause.

### Why folded-exact ∪ compound stems, and not substring stems alone

A substring denylist containing short generic stems rejects honest data. In
B11.1 the stem `state` rejected the legitimate field `canonicalStateDigest`.
The split is deliberate:

* **folded-exact** — short/generic names that are only ever credentials on
  their own: `secret`, `token`, `password`, `credential(s)`, `authorization`,
  `apikey`, `xapikey`, `accesstoken`, `refreshtoken`, `clientsecret`,
  `clientid`, `bearer`, `sessionkey`, `privatekey`, `signingkey`.
* **compound stems** — unambiguous multi-word forms matched as substrings:
  `apikey`, `authorization`, `bearer`, `credential`, `password`,
  `accesstoken`, `refreshtoken`, `clientsecret`, `privatekey`, `signingkey`,
  `sessiontoken`, `authtoken`, `secrettoken`, `secretkey`, `tokensecret`,
  `reasoning`, `thinking`, `continuation`, `rawbody`, `rawrequest`,
  `rawresponse`, `rawprovider`, `rawsdk`, `rawpayload`, `providerraw`,
  `providerbody`, `providerrequest`, `providerresponse`, `providerclient`,
  `encryptedcontent`, `openaiclient`, `anthropicclient`, `sdkclient`,
  `sdkpayload`, `sdkobject`.

The regression asserts **both directions**: the R2 names are refused, and
fifteen legitimate control-plane and PCB/schematic field names
(`canonicalStateDigest`, `argsDigest`, `stackupConfig`, `constraintState`,
`routingHistory`, `placementPolicy`, `netClassing`, `endpointKeys`,
`kicadComponents`, `identityVersion`, …) are not. A denylist that rejects
honest data is a broken denylist.

An independent sweep of `app/lib/pcb/types.ts` and `lib/schematic-types.ts`
found **no** domain field name that collides with the classifier.

## Scanning ORIGINAL values, not the serialized form (R3, R4)

`JSON.stringify` escapes nested quotes, so `{"apiKey":"…"}` embedded inside a
string becomes `{\"apiKey\":\"…\"}` and every quoted-credential pattern
misses it. `findSecretShapedPath` therefore walks the value **directly**,
inspecting

* every **key name** — via `isCredentialShapedName` and the content denylist;
* every **string value** — the original, unescaped text.

The serialized scan is retained as an independent second net (it catches
patterns that span a document, and it double-covers the direct walk).

### Carriers proven refused

| Boundary | Carrier | Regression |
| --- | --- | --- |
| capsule | `userMessage` | §B "credential-shaped JSON nested inside capsule STRINGS is refused" |
| capsule | step `text` | same |
| capsule | `toolCalls[].argumentsText` | same |
| capsule | step `failure.message` | same |
| capsule | context string (`editorSchematicDigest`) | same |
| trace | `model` | §C "credential-shaped JSON in ANY trace field refuses" |
| trace | `runId`, `promptDigest` | same |
| trace | `warnings[]` | same |
| trace | event `status`, `verification`, `proposalId` | same |
| trace | `scope.projectId` | same |
| trace | a credential-shaped **key name** | §C "a credential-shaped KEY NAME … refuses and is redacted" |

Every refusal names a **path**, never a value. Each assertion additionally
checks that neither the synthetic placeholder nor the offending key name
appears anywhere in the issue list.

## Bounded, non-echoing diagnostics

* Traversal is bounded by `maxScanNodes = 20 000` and `maxScanDepth = 32`;
  exceeding either yields one bounded issue instead of unbounded work.
* Every echoed key name passes through `sanitizeTraceText(key, 60)`, so a
  secret smuggled into a key name is redacted — the B11.1 regression
  asserting `[redacted]` in the report still passes.
* Values are never echoed, under any code path.

## Byte stability preserved

The added validation is **read-only**: it inspects documents, it never
rewrites them. A valid recorder-produced trace is unchanged, which the
regression proves directly (`JSON.stringify` and `agentRunTraceDigest`
equality across two independent builds) and which the 19 committed replay
pins prove end-to-end.

## Schema/exactness checks preserved

All B11.1 §A structural checks remain and run **before** the scan: exact
shape, ledger/summary internal consistency, contiguous `seq`, one
`run_started` first, one terminal last, timeline sanity, outcome/reason
semantics, closed diagnostic vocabulary, and bounded output.
