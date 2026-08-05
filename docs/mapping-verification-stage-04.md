# Pin-pad mapping verification Stage 4

## Purpose and boundary

Stage 4 proves whether one exact project component/assembly variant has a defensible physical connectivity mapping:

`logical symbol pin -> manufacturer package terminal -> exact footprint pad`

It does not choose a part or footprint, approve its own result, certify land-pattern geometry, modify a schematic, create a PCB, place components, route copper or export manufacturing data. Verification is pure. Persistence and approval are separate lifecycle operations.

## Contracts

- Context: `sirkit.mapping-context.v1`
- Candidate: `sirkit.physical-terminal-mapping.v1`
- Request/result: `sirkit.mapping-verification-request.v1` / `sirkit.mapping-verification-result.v1`
- Policy: `sirkit.mapping-verification-policy/1.0.0`
- Verifier: `sirkit.mapping-verifier/4.0.0`
- Record/audit/invalidation: `sirkit.mapping-record.v1`, `sirkit.mapping-audit.v1`, `sirkit.mapping-invalidation.v1`
- Canonical digest: `sirkit.mapping-canonical/1`, `mv1-` SHA-256 identifiers

The dependency snapshot pins scope, symbol version/content/semantic digest, exact-part and package revision, footprint version/content/semantic digest, evidence digests, parser versions, policy and verifier.

## Data model

Logical pins retain stable identity, raw/normalized number and name, electrical/function and polarity class, hidden state, alternate functions, every unit/body representation, stacked group and mapping requirement. Manufacturer terminals retain exact designator/function, classification, connection requirement, common group, polarity, source revision and freshness. Footprint pads retain exact stable pad ID/number, type, layers, drill/plating, classification and repeated-pad group.

Relationships model ordinary one-to-one edges, commoned terminals/pads, multiple symbol representations, exposed pads, shield/chassis, NC/DNC and explicitly evidenced equivalence/permutation. Mechanical and mounting pads require an explicit non-electrical disposition. Required electrical identities cannot be waived by an `explicitUnmapped` label.

## Verification algorithm

`DeterministicMappingVerifier` validates:

1. request/context/candidate identity and exact scope;
2. frozen dependency, parser, symbol, exact-part, package and footprint revisions;
3. endpoint existence, unique edges and bounded graph size;
4. symbol-to-terminal function, polarity, DNC and cardinality;
5. terminal-to-pad mechanical, thermal, shield and cardinality;
6. direct-pair restrictions;
7. equivalence membership, permutations, evidence and risk compatibility;
8. valid explicit-unmapped dispositions;
9. complete required coverage at all three layers;
10. evidence existence, accepted source class, review, freshness and conflicts;
11. the minimum verification tier for the component risk class.

Results contain all findings plus first-class conflicts/ambiguities, exact affected identities, per-layer coverage, evidence assessment, status/tier and immutable technical digest. Display text, request IDs, actor and evaluation time do not alter the technical result digest.

## Tiers and layout gate

| Tier | Meaning | Layout-ready under Stage 4 policy |
|---|---|---|
| `exact_part` | exact part/package/symbol/footprint with reviewed current authoritative evidence | yes |
| `package_family` | proven package-family terminal truth with compatible exact assets | yes where risk matrix permits |
| `curated_pair` | human-reviewed organization/official pairing | only low-risk profiles permitted by matrix |
| `limited_direct_pair` | two-layer direct proof for a symmetric nonpolar passive when package-terminal truth is unavailable | no |

Polarized parts, diode/LED, transistor, power/regulator, thermal/high-density, keyed connector, electromechanical and RF/high-speed profiles require exact-part proof. Unknown risk is unsupported. Limited direct-pair output is explicitly excluded from layout readiness.

## Lifecycle

`verify` stores only an ephemeral result needed for qualification lifecycle tests. `persistVerification` requires an authorized human and creates an immutable unreviewed candidate. `approve` and `reject` require reviewer/admin roles. `revoke` and `markStale` create immutable successor revisions. Every mutation uses optimistic revision, optional expected mapping digest, per-scope lock and idempotency key. Audit and invalidation events bind predecessor/successor and actor provenance.

An approved record projects a richer Stage 1 mapping reference containing tier, mapping/result/dependency/content digests, lifecycle, approval, freshness and conflict state. Changes record a disabled Stage 2 cache dependency and stale affected Stage 3 plans without touching a board.

## API and rollout

`GET /api/mapping-verification` reports truthful capability/versions and qualification authority. `POST` supports inspect, verify, history and gated lifecycle operations. Scope and actor come from authenticated headers; client values are overwritten. The endpoint requires JSON, caps input at 4 MB and rejects uploaded contexts, candidates, snapshots, evidence, paths and URLs. Confidential evidence locators are redacted by inspection.

`SIRKIT_MAPPING_STAGE4` supports `off`, `observe`, `opt_in`, and `authoritative_supported_profile`; absent/invalid values are `off`. Mutation additionally requires `x-sirkit-mapping-mutation-opt-in: true`. The checked-in route uses trusted but empty server-side providers and an in-memory repository/projector. It is not a production authority.

## UI

`MappingVerificationPanel` displays the three identity layers, exact coverage, result status/tier, separate approval state, every finding and affected stable identity. Its action is explicitly “Verify mapping (read only).” The component is qualified but not mounted into the legacy production editor while rollout is off and no durable provider feeds it.

## Security and operations

- Human-only mutation; reviewer/admin-only approval.
- Project/tenant/branch/component/variant scope enforcement on read and mutation.
- No arbitrary path, URL, evidence or CAD payload ingestion at the public API.
- Fixed non-weakenable policy gates and bounded pins/terminals/pads/edges/evidence/findings/batch/timeout.
- Abort/cancellation propagation and eight-at-a-time batch chunks.
- Pseudonymized telemetry with counts, durations, versions, status/tier and reason codes only.
- No secret, raw design, tenant or project identifier in telemetry.

## Supported and deferred

The verifier, adapters, policy, immutable lifecycle, Stage 1 projector, Stage 3 invalidation, API boundary, UI and representative qualification corpus are implemented for the supported in-memory profile. Production durability, atomic catalog publication, cross-service database transaction, live PostgreSQL apply/rollback/restart and process-kill recovery are deferred blockers. The feature must remain off until those are proven.
