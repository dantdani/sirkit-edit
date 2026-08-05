# Sirkit Stage 3: Evidence-Based Readiness and Manufacturing Signoff

Date: 2026-07-17  
Branch: `codex/stage-03-readiness-signoff`  
Protected working copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`

## 1. Executive implementation summary

The PCB editor previously had several unrelated decisions that could be presented as readiness: a DRC-only `ready` state, an AI-specific parity boolean, an autoroute completion state, and a KiCad fabrication `overrideDrcFail` bypass. A board with zero DRC errors and zero remaining airwires could therefore appear ready even when its authoritative schematic was unavailable.

Stage 3 replaces that behavior with one versioned `ReadinessReport` for the explicitly scoped `PCB_FABRICATION_CHECKS` claim. The policy distinguishes proven failure, unavailable evidence, and stale evidence; preserves warnings and waivers separately; and is recomputed at the manufacturing-release boundary from the exact immutable snapshot used to generate artifacts.

The motivating case now behaves as required:

```text
schematic parity = unknown
DRC errors = 0
remaining connections = 0
=> overallState = verification_incomplete
=> verified manufacturing release denied
```

The same report now drives the PCB toolbar, DRC/readiness panel, fabrication dialog, AI snapshot and repair service, autoroute API/debug bundle, fabrication API, KiCad-assisted package, native package, and release manifest.

## 2. Prerequisite evidence

Before Stage 3 implementation, the Stage 1 and Stage 2 gate was run:

```text
npx vitest run data-integrity pin-pad-mapping locked-copper-integrity \
  net-reconciliation electrical-truth electrical-consistency dsn-integrity \
  read-ses autoroute-verification
```

Result: 9 test files passed, 55 tests passed.

The verified prerequisites include stable component/net/pad identity, deterministic pin-to-pad mapping, protected copper integrity, authoritative intended/assigned/realized electrical truth, strict DSN/SES conservation, native remaining-connection counts, short detection, unresolved physical facts, and consumer revision consistency.

## 3. Readiness claim specification

Claim: `PCB_FABRICATION_CHECKS`  
Claim version: `1`  
Policy version: `pcb-fabrication-checks/1.0.0`  
Report schema: `sirkit.pcb-readiness.v1`

For one exact semantic PCB revision and manufacturing profile, `ready` means all implemented required checks are current and passing:

- persistent identity and reference integrity;
- authoritative schematic presence and stable identity-set parity;
- complete, unambiguous logical-pin-to-physical-pad assignment;
- complete native electrical realization with no shorts or unresolved facts;
- complete blocking DRC execution under the selected preset;
- supported current manufacturing representation, stackup, zones, and fills;
- revision-bound exporter structural and conservation preflight.

This claim does not prove circuit function, datasheet application rules, product requirements, signal integrity, power integrity, thermal behavior, EMC, reliability, sourcing, regulatory compliance, fabricator process capability, or production qualification. Those domains remain unsupported or later-stage work and are never defaulted to pass.

## 4. State and aggregation table

| State | Exact meaning | Release effect |
|---|---|---|
| `stale` | Revision, profile, policy, checker, or evidence binding does not match the requested release | No verified or overridden release |
| `blocked` | At least one current required check proved a failure | No verified release; only explicitly waivable cases may authorize a non-verified engineering artifact |
| `verification_incomplete` | No proven failure is required, but at least one required fact is unknown, unsupported, unavailable, or not run | No verified release; only explicitly waivable cases may authorize a non-verified engineering artifact |
| `ready` | Every required current check is `pass` | Verified manufacturing release allowed |
| warning | Nonblocking diagnostic under the active rule/profile severity | Retained in report and manifest; does not rewrite a check |
| waiver | Separate revision-bound risk acceptance record | Never changes fail/unknown to pass; can authorize only `engineering_prototype_export` |

Aggregation precedence is deterministic: stale, then any failure, then unknown/not-run/unsupported, then all-pass. Stable check ordering, diagnostic ordering, semantic hashing, and report IDs make identical inputs reproducible.

## 5. Required-check matrix

| Check code | Evidence source | Pass condition | Fail condition | Unknown condition | Blocking? | Waivable? |
|---|---|---|---|---|---|---|
| `IDENTITY_INTEGRITY` | Stage 1 identities and reference audit | Stable component/net identities, references, reserved net, and net ownership are valid | Duplicate/missing/ambiguous identity or invalid net reference | None; absence is a failure | Yes | No |
| `SCHEMATIC_PARITY` | Authoritative netlist plus stable identity-set parity certificate | Component, endpoint, stable-net membership, mapping, and no-connect sets are conserved | Missing/extra/ambiguous/mismatched identity or invalid schematic graph | Authoritative schematic unavailable | Yes | Only the unavailable-schematic case for an explicitly non-verified engineering artifact |
| `PHYSICAL_ASSIGNMENT` | Stage 2 assigned graph | Every required terminal maps to valid physical pads without ambiguity/conflict | Missing, ambiguous, conflicting, or unaccounted assignment | Assigned evidence unresolved | Yes | No |
| `ELECTRICAL_REALIZATION` | Stage 2 native conductive graph | All required terminal groups are connected, with zero shorts and zero unresolved facts | Open connection or short | Plane/fill/net realization cannot be proven | Yes | Only intentional open connections; shorts and unresolved facts are not waivable |
| `PCB_DRC` | `sirkit.pcb-drc.v2`, `pcb-drc/2` | Every required DRC stage completed for the exact revision/preset with zero blocking errors | Current blocking violation | Aborted/not-run checker | Yes | Only `DRC_INCOMPLETENET`, `DRC_UNCONNECTED`, `DRC_SILKOVERPAD`, and `DRC_COURTYARDOVERLAP` when no other DRC error is present |
| `MANUFACTURING_REPRESENTATION` | Stackup plus native zone/fill evidence | Supported physical layers and current native conductive representation exist | Structural manufacturing defect reported by its owning checker | Configuration-only plane or stale/unresolved fill | Yes | No in Stage 3 |
| `EXPORT_PREFLIGHT` | DSN conservation and target exporter serialization | Exact-snapshot structure, units, layers, padstacks, and conservation preflight pass | Unsupported/malformed/mismatched export representation | Exporter explicitly cannot evaluate | Yes | No |

Waiver authorization additionally requires exact diagnostic codes and every affected component, stable net, and object ID. A broad check-name-only waiver is not sufficient.

## 6. Consumer migration table

| Consumer | Previous decision | Problem | New authority |
|---|---|---|---|
| DRC engine/panel | `DrcResult.readiness.state = ready` | DRC-only result looked like fabrication readiness | DRC has a scoped `summary`; panel separately consumes `ReadinessReport` |
| PCB toolbar | Error/warning count implied ready | Schematic and unresolved evidence were absent | `readinessViewModel(ReadinessReport)` |
| AI PCB snapshot | Caller-supplied `schematicParity` plus local boolean | Caller could assert parity and AI could diverge | `sirkit.ai-pcb.v3` embeds the authoritative report |
| Repair/planning service | Final DRC readiness | DRC-clean could be mistaken for release-ready | Separate `finalDrcSummary` and `fabricationReadiness` |
| Autoroute workflow | Route status `complete` | Route completion did not explain fabrication claim | Route completion remains scoped; API/result/debug bundle carry the post-route report |
| Fabrication dialog | Generic DRC gate and “Export anyway” | Broad bypass and unscoped green state | Server report, scoped labels, reasoned engineering disposition |
| Fabrication API | `overrideDrcFail` | One flag bypassed broad evidence | Retired flag; `verified` or explicit `engineering` release mode with exact waiver |
| KiCad-assisted export | Client badge plus DRC gate | Time-of-check/time-of-use mismatch | `prepareManufacturingRelease` re-evaluates immutable snapshot |
| Sirkit native export | `native-beta-verified` | Overbroad signoff wording | `pcb-fabrication-checks-passed` or `engineering-prototype-unverified` |
| Release/debug evidence | Scattered stats | No common certificate | Embedded readiness report and revision-bound release manifest |
| Project persistence | No release history | Downloaded proof existed only inside ZIP | Up to 100 immutable release manifests retained as non-semantic project history |

## 7. Release transaction specification

Both manufacturing engines use this transaction:

```text
structuredClone live board into immutable snapshot
-> compute semantic revision
-> reject stale prior badge/report
-> recompute electrical truth, complete DRC, parity, and exporter preflight
-> evaluate PCB_FABRICATION_CHECKS
-> authorize verified release only if ready
-> generate every artifact from the checked snapshot
-> hash generated artifacts
-> create release manifest bound to revision/report/policy/profile/exporter/waivers
-> package readiness evidence and manifest
-> persist the returned manifest as historical project metadata
```

KiCad-assisted output contains `SIRKIT_ELECTRICAL_TRUTH.json`, `SIRKIT_READINESS_REPORT.json`, and `SIRKIT_RELEASE_MANIFEST.json`. Native output contains `release-manifest.json` and a v2 native manifest associated with the readiness report and release transaction.

No success record is created before authorization and artifact generation. A gate failure occurs before the external exporter is invoked. Temporary KiCad work is removed in `finally`. The client validates the embedded release manifest before recording the release or presenting the download as complete.

Interchange/debug operations remain separately scoped and never acquire verified-manufacturing wording merely because they can be generated.

## 8. Override policy

An engineering override requires:

- stable waiver ID;
- claim and exact check codes;
- exact diagnostic codes;
- affected component, stable-net, and object IDs;
- user-entered reason of at least eight characters;
- actor when available;
- exact semantic design revision;
- policy and manufacturing-profile versions;
- creation time;
- `engineering_prototype_export` disposition.

Any semantic design change invalidates it. It cannot authorize a verified release and never changes underlying evidence.

Non-waivable conditions include identity/reference ambiguity, pin-pad ambiguity, shorts, aborted DRC, stale evidence, unresolved native plane/fill conductivity, malformed serialization, unsupported units/layers/padstacks, conservation failure, profile/revision mismatch, and exporter structural failure.

## 9. Files changed for Stage 3

Production policy and evidence:

- `app/lib/pcb/readiness/types.ts`
- `app/lib/pcb/readiness/parity.ts`
- `app/lib/pcb/readiness/preflight.ts`
- `app/lib/pcb/readiness/evaluate.ts`
- `app/lib/pcb/readiness/waiver.ts`
- `app/lib/pcb/readiness/release.ts`
- `app/lib/pcb/drc/types.ts`
- `app/lib/pcb/drc/run-drc.ts`
- `app/lib/pcb/index.ts`

Manufacturing, API, AI, autoroute, and persistence:

- `app/lib/pcb/fab/build-bundle.ts`
- `app/lib/pcb/fab/types.ts`
- `app/lib/pcb/fab/native/compiler.ts`
- `app/lib/pcb/fab/native/types.ts`
- `app/api/pcb/export/gerbers/route.ts`
- `app/api/pcb/autoroute/route.ts`
- `app/api/pcb/repair/agent/route.ts`
- `app/lib/pcb/ai/snapshot.ts`
- `app/lib/pcb/ai/pcb-tool-service.ts`
- `app/lib/pcb/ai/pcb-tool-schemas.ts`
- `app/lib/pcb/autoroute/debug-bundle.ts`
- `app/lib/pcb/board-persistence.ts`
- `lib/persistence.ts`

UI/view adapters:

- `app/components/pcb/PcbEditor.tsx`
- `app/components/pcb/PcbToolbar.tsx`
- `app/components/pcb/DrcPanel.tsx`
- `app/components/pcb/BoardRepairPanel.tsx`
- `app/components/pcb/FabDialog.tsx`
- `app/components/pcb/AutorouteSetup.tsx`
- `app/components/pcb/hooks/useFabExport.ts`
- `app/components/pcb/hooks/useAutoroute.ts`
- `app/components/pcb/hooks/usePcbRepair.ts`

Stage 3 tests:

- `app/lib/pcb/__tests__/readiness-policy.test.ts`
- `app/lib/pcb/__tests__/schematic-parity.test.ts`
- `app/lib/pcb/__tests__/release-persistence.test.ts`
- `app/lib/pcb/__tests__/build-bundle.test.ts`
- `app/lib/pcb/__tests__/native-fab.test.ts`
- `app/lib/pcb/__tests__/drc-readiness.test.ts`
- `app/lib/pcb/__tests__/pcb-repair-agent.test.ts`
- `app/api/pcb/export/gerbers/__tests__/route.test.ts`
- `app/api/pcb/autoroute/__tests__/route.test.ts`

## 10. Test evidence

Final verification commands:

```text
npx tsc --noEmit
npx eslint <Stage 3 production and test files>
npm test
npm run build
npm run lint
```

Results:

- TypeScript: passed.
- Focused Stage 3 ESLint: passed with zero findings.
- Full Vitest suite: 102 files passed, 613 tests passed; 2 files/9 tests were intentionally skipped integration tests.
- Next.js production build: passed. Turbopack emitted five existing dynamic-process/file-tracing warnings for FreeRouting/NGSpice paths.
- Repository-wide ESLint was executed and reported 32 errors and 15 warnings in pre-existing unrelated BOM/editor/schematic hook code. No Stage 3 file appeared in those failures.

Dedicated regression coverage includes unknown schematic plus clean DRC, deterministic aggregation, stale badge rejection, identity-set parity, equal-count net-membership mismatch, intentional no-connects, aborted/old DRC evidence, configuration-only planes, exact immutable release snapshots, preflight failure, failed-release atomicity, strict waivers, waiver invalidation, manifest/artifact association, persisted historical release records, and UI/AI/API/autoroute/debug/manufacturing report consistency.

## 11. Compatibility notes

- Existing projects have no cached live readiness; they load normally and receive a fresh evaluation.
- Missing identity schemas continue through the Stage 1 migration and must be freshly checked before release.
- Historical release manifests are optional additive project metadata and never alter the PCB semantic revision.
- Old release history remains historical; it cannot authorize a new package.
- AI snapshot schema is now `sirkit.ai-pcb.v3`.
- DRC-only `readiness` was renamed to `summary` to remove the ambiguous readiness claim.
- Native fabrication manifest schema is now `sirkit.native-fab-manifest.v2`.
- The old `overrideDrcFail` API field is explicitly rejected with HTTP 400.
- KiCad and native package readers must use the embedded versioned release manifests for signoff evidence.

## 12. Remaining risks

- Unsupported verification domain: circuit function and all application/datasheet, SI, PI, thermal, EMC, reliability, regulatory, sourcing, and production-qualification claims remain unverified.
- Later-stage requirement: native conductive plane/zone generation and same-net behavior remain Stage 4. Stage 3 correctly reports configuration-only plane intent as unresolved.
- Later-stage requirement: external CAM/fabricator qualification of the native-beta compiler remains necessary; KiCad-assisted output remains the fallback.
- Confirmed repository debt: full ESLint still has 32 unrelated React hook errors outside the Stage 3 surface.
- Unverified hypothesis: very large historical release manifests may eventually need server-side/project-file archival rather than the current capped browser project history.

## 13. Completion verdict

STAGE 3 COMPLETE
