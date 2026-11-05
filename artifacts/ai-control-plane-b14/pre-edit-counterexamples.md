# B14 — pre-edit reproductions (R1–R12)

Behavioural probes ran in a disposable vitest file (deleted after capture)
against the unmodified B13.2 tree; the rest are source-inspection findings
with exact locations.

## R1 — no agent-exposed replacement proposal tool exists

- `grep -rn "propose-component-replacement" app/` → **0 hits**.
- `tool-catalog.ts` carries exactly **ten** `agentExposed: true` entries; the
  only propose-class tool is `sirkit.schematic.propose-tier1-edit` (line 130).
- The AI can inspect authority (`sirkit.component-authority.inspect`,
  line 273) but has no path to propose a replacement.

## R2 — `schematic.replace-component` has no provider-neutral proposal path

`action-registry.ts:84`: the canonical action exists (`kind: "destructive"`,
`status: "implemented"`, `domainCommand: "schematic_replace_component"`,
handler "BOM part swap → SchematicEditorSession replacement plan") with
**`toolExposure: "none"`**. The executor binds it (executor.ts:131); the only
invoker is the BOM swap UI (page.tsx:5522). No proposal artifact, no agent
path.

## R3/R4 — the Tier-1 schema/service cannot carry or execute a replacement

A replacement-shaped artifact (schema
`sirkit.schematic-replacement-proposal.v1`, `componentInstanceId`, `target`)
fed to the REAL `applyApprovedTier1Proposal` over a ready session:

```json
R3R4 {"ok":false,"status":"refused","code":"verification-failed","message":"The proposal artifact carries an unknown field (componentInstanceId). Nothing was changed."}
```

The service is hard-wired to `SealedTier1Proposal`: closed `PROPOSAL_KEYS`
(approved-agent-mutations.ts:298–301), Tier-1 schema constants (339/349),
Tier-1-only verifiers (365, 820), the single command id
`schematic.edit-tier1-apply` (77) and the Tier-1 receipt vocabulary (84–116).
There is no injection point for another proposal kind.

## R5 — a plain serialized object claiming verified authority is refused

`planSchematicReplacement` with a structurally complete forged authority
object (all five asset ids + `status: "verified-atomic"` + a grantId):

```json
R5 {"ok":false,"refusal":"ambiguous-authority"}
```

The planner accepts only `{ status: "catalog-unverified" }` or an
`instanceof VerifiedReplacementAuthority` (schematic-plans.ts:342–353).

## R6 — a runtime grant cannot be serialized and reused

```json
R6 {"serializedForm":{"carrier":{"grant":"[verified-replacement-authority]"}},"forgedGrantIdCheck":{"ok":false,"code":"grant_missing","detail":"No registered runtime authority grant matches this operation; serialized operation fields are never authority."}}
```

`VerifiedReplacementAuthority.toJSON()` collapses to an inert string
(schematic-authority.internal.ts:89–91); the class has a private constructor
with a module-private factory and registry (96–115), so a deserialized or
forged object is never the registered instance and
`verifyReplacementAuthorityGrant` fails `grant_missing` (157–159).

## R7 — the agent context exposes no raw pin facts (and must remain so)

`app/lib/agent/context.ts` contains no pin/terminal exposure (grep: zero pin
table fields). Pin definitions live in the parts catalog / atomic symbol
payloads (`SymbolAssetVersion.pins`, atomic/types.ts:224) — never in
`AgentRunContext`, never in the schematic state
(`KicadComponentInstance`, lib/schematic-types.ts:111–132, carries no pins).

## R8 — a B13 inspection result alone cannot authorize a replacement

`consumeReplacementAuthority` fed an inspection-summary-shaped object instead
of a sealed resource bundle:

```json
R8 {"ok":false,"code":"invalid_bundle"}
```

Authority consumption requires the FULL sealed `ReadResourceBundle`
(validated envelopes + manifest + canonical pin), not any summary.

## R9 — receiving a proposal mutates nothing

The REAL gateway sealing a Tier-1 proposal over a run context:

```json
R9 {"outcomeKind":"proposal","digestUnchanged":true}
```

## R10 — the manual/BOM replacement is UI-loaded, not an agent bridge

`page.tsx:5502–5555` (`handleSwapPart`): pins come from the client parts
cache (`ensurePartLoaded` → `newPart.pins`), authority is explicitly
`{ status: "catalog-unverified" }`, and the flow swaps EVERY instance of a
partId from the BOM drawer. No sealed artifact, no server-owned authority, no
provider provenance — not a production agent proposal path.

## R11 — stale/foreign/expired protections exist ONLY for Tier-1

`verifySealedTier1Proposal` (schematic-proposals.ts:200–228) enforces
foreign-scope/stale-head/expired/stale-base for Tier-1 artifacts, and the B12
service adds journal/idempotency/interlock protections — but no replacement
proposal artifact exists at all (R1–R4), so no replacement-shaped apply can
carry those protections today.

## R12 — dropped connected pins require an EXPLICIT caller acknowledgement

`planSchematicReplacement` with a connected pin absent from the target and an
explicit mapping for the rest:

```json
R12 {"unacknowledged":{"ok":false,"refusal":"unacknowledged-dropped-connections","pins":["2"]},"acknowledgedByCaller":{"ok":true,"dropped":["2"]}}
```

The acknowledgement (`acknowledgeDroppedPins`, schematic-plans.ts:150–156) is
a CALLER decision. B14 must never let the model supply it: the new tool's
input schema carries no such field, and the server assembler never populates
it — a would-be-dropped connected pin is a structured blocker, period.
