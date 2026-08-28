# B14 §B — server-owned pin and target authority

## Authority and pin-source table

| fact | source | module |
| --- | --- | --- |
| target exact MPN + manufacturer | B13 `exactAuthority` (durable binding + published atomic cross-check) | component-authority-source.ts |
| target atomic revision | `exactAuthority.atomicPartRevisionId` | " |
| target symbol/footprint revisions, mapping certificate, selection record | `exactAuthority.*` | " |
| target pin definitions | PUBLISHED atomic symbol payload (`SymbolAssetVersion.pins`) of the target revision's primary CAD bundle | `loadPublishedSymbolPinFactsCancellable` (authority-cancellable-reads.ts) |
| target mapping-certificate corroboration | APPROVED `atomic_mapping_certificates` row (bounded projection) | " |
| current part identity | the instance's `partId` (`expectedCurrentPartId` precondition) | schematic state |
| current atomic/symbol revisions | the instance's `atomicPartRevisionId`/`symbolAssetVersionId` (absent ⇒ blocker) | schematic state |
| current pin definitions | PUBLISHED atomic symbol payload of the CURRENT instance's revision | `loadPublishedSymbolPinFactsCancellable` |
| current canonical schematic digest | the head mark's canonical-state digest (session domain) | schematic-session |

## Rules enforced

1. Target identity comes ONLY from the B13 exactAuthority block (the request
   and the model cannot name assets).
2. Both revisions must be PUBLISHED and internally consistent: the read
   returns null for unpublished/incomplete revisions or unapproved mappings
   (fail closed ⇒ pin-authority blockers).
3. Reads reuse the B13.2 cancellable adapter (`sql.unsafe` + `query.cancel()`;
   no query starts once aborted), wrapped per-request in the B13.2 §C
   abort/deadline settlement machine (`loadRunReplacementPinFacts` —
   pre-aborted ⇒ no I/O; abort settles immediately; deadline cancels).
4. NOTHING raw reaches the model: pin facts are server-side PLANNING INPUTS —
   they never enter the agent context, provider messages, or traces; the
   provider sees only the bounded proposal-sealed impact summary. No
   `PortableAtomicSnapshot`, blobs, rows, supplier data, credentials, or SDK
   objects cross the boundary (the `PublishedSymbolPinFacts` projection is a
   closed allowlist).
5. Any missing, stale, conflicted, unpublished, or mismatched authority
   blocks the proposal (structured blocker table in
   [replacement-tool-contract.md](replacement-tool-contract.md)).

## Mapping policy (§C)

The old→new pin mapping is EXACT NUMBER+NAME IDENTITY computed by the ONE
existing `planSchematicReplacement` — never pin-count equality, display-name
inference, or provider-generated mappings (the tool input has no mapping
field, and the assembler never passes `explicitPinMapping` or
`acknowledgeDroppedPins`). The target's APPROVED durable mapping certificate
is a REQUIRED CORROBORATION LAYER over that identity mapping
(`certificateCorroborates`: exact certificate id, exact symbol version, no
missing/ambiguous entries, full symbol-pin coverage) — recorded on the
artifact as `mappingEvidence: "exact-pin-identity+certificate"`. No durable
artifact maps OLD part pins to NEW part pins in this system (the certificate
maps manufacturer terminals ↔ symbol pins ↔ pads), so cross-part renumbering
mappings are OUT OF SCOPE and block — consistent with the stage's exclusion
of ambiguous pin mappings. A connected pin that would be dropped always
blocks; the model can never supply the acknowledgement (R12 closure).
