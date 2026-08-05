# Sirkit CD-11 Firmware, DFT, Calibration, and Bring-Up Co-Design

Date: 2026-07-18  
Branch: `codex/cd-11-firmware-dft-bring-up`  
Specification SHA-256: `0DF23D6EE1E548B3E1879CA77F4559BEA1FD343CCD68094DBDE0B13858412F03`  
Protected working copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`  
Protected original: `C:\Users\robsa\sirkit` (unchanged)

## Outcome

Sirkit now has a fail-closed CD-11 foundation for exact device knowledge, firmware/hardware resources, lifecycle safety, programming/recovery, DFT, test access, fixture/factory tests, uncertainty, calibration, identity, typed diagnostic scaffolding, unexecuted bring-up, failure isolation, fixed-denominator coverage, and readiness.

Production CD-11 remains `BLOCKED BY CD-10`; CD-10 is itself blocked by CD-9 and has no approved authoritative campaign. CD-11 therefore creates no firmware build, factory pass, calibration record, provisioning action, bench observation, or ready package.

## Repository trust decisions

| Existing surface | Decision |
|---|---|
| CD-4 pin facts and deterministic allocation | Reused as the upstream exact pin/resource planning authority. CD-11 adds lifecycle/internal-resource/test implications; it does not reinterpret pin names. |
| CD-4 clock/reset/boot/debug and firmware handoffs | Extended through digest-pinned CD-11 contracts; planning-only values remain unverified. |
| CD-8 graph, CD-9 oracle, CD-10 campaign | Mandatory immutable gate. CD-11 recomputes CD-10 readiness and verifies its exact CD-9/CD-8 pins. |
| Generic part notes, hand-written headers/scripts/checklists | Quarantined as non-authoritative candidates with provenance. |
| Existing process/spawn paths | Not exposed to CD-11 agents. No programmer, compiler, SCPI, fixture, register, fuse, or secret operation is executable through CD-11. |
| PCB test-point rendering/placement | Coordinate authority remains the PCB engine; CD-11 exports semantic/electrical/mechanical constraints only. |

## Implemented architecture

- `app/lib/firmware-bringup/types.ts`, `stable.ts`, and `capability.ts`: canonical schemas, distinct lifecycle/evidence/readiness states, deterministic IDs, and a bounded low-voltage profile.
- `problem.ts`: exact CD-1 through CD-10 revision manifest, recomputed CD-10 handoff, explicit `BLOCKED BY CD-10`/`BLOCKED BY CD-9`, approved CD-8 graph and device evidence gates.
- `device.ts`: exact part/package/silicon-conditional facts, contradiction retention, license/review gates, raw asset lineage, and secret rejection.
- `resources.ts`: deterministic hard-constraint allocation, active-mode exclusivity, stable alternatives/conflict cores, and independent certificates.
- `lifecycle.ts`: hardware state reachability, complete per-pin behavior requirement, temporal hazard checks, clock DAG and reset/watchdog/brownout validation.
- `dft.ts`: immutable obligation denominator, explicit detectability relations, critical-first deterministic set cover, uncovered-item retention, and PCB-only coordinate handoff.
- `factory.ts`: correlated uncertainty combination, limit/guardband boundary decisions, invalid/overrange/stale-calibration handling, dry-run non-pass, and supported calibration estimators.
- `generation.ts`: provider-neutral configuration IR, preload-before-output safety, reviewed-template/build evidence, drift detection, safe diagnostic command validation, and unreachable raw actions.
- `bringup.ts`: dependency-checked unexecuted bring-up plans plus explicit-prior/likelihood information-gain diagnosis with ambiguity retention.
- `readiness.ts`: fixed coverage partition and fail-closed gates across evidence, resources, lifecycle, recovery, DFT, factory, calibration/identity, build scaffolding, bring-up, and isolation.
- `project.ts` and `agent-tools.ts`: optimistic transactions, exact invalidation, immutable successors, proposal-only AI, and hard blocks on raw/irreversible operations.

## Product integration

- `/firmware-bringup?project=<id>` displays the current CD-10 gate or the review workspace.
- Scoped APIs compile the problem, solve/certify resources, and accept proposal-only agent artifacts.
- `lib/persistence.ts` stores CD-11 state/history and archives it when CD-10 changes.
- `drizzle/0019_cd11_firmware_bringup.sql` stores problems, device evidence, coverage, readiness, packages, and project states.
- The corpus registers 143 required device/lifecycle/clock/debug/DFT/boundary-scan/factory/calibration/identity/generation/bring-up/full-board classes. All remain honestly `manifest_only`.
- Three governed benchmark packages cover corpus integrity, authority boundaries, and supported scale.
- Focused CD-11/API suite: 13 tests passed. Complete serial Sirkit suite: 178 files passed, 1,211 tests passed, 9 skipped, zero failed.
- TypeScript, focused ESLint, production build, migration-journal validation, and the 57-package benchmark manifest passed.

## Security and incident rules

Vendor assets/templates/BSDL remain untrusted until validated; secret-like content is rejected; agent APIs cannot reach raw register, shell, SCPI, programmer, fixture, or irreversible operations; test actions are typed and bounded; dry runs cannot pass hardware; generated files remain scaffolding; and every upstream/tool/evidence revision creates targeted invalidation. On a security or unsafe-action incident: deny execution, preserve redacted digests, quarantine the provider/asset, invalidate dependents, require independent review, and never retry by weakening safety gates.

## Blocker record

| Field | Current evidence |
|---|---|
| Primary blocker | No authoritative CD-10 campaign/readiness permitting CD-11; CD-10 is blocked by CD-9. |
| Affected scope | All variants, modes, pins/resources, lifecycle states, DFT obligations, tests, calibration/identity, diagnostic builds, and bring-up steps. |
| Safety/coverage consequence | Reset/default/back-power/recovery/test/calibration/build/access claims cannot be established; readiness must remain blocked. |
| Witness | Missing CD-10 project/campaign/readiness and therefore no CD-11 problem can be opened. |
| Additional blockers after CD-10 | No production exact device pack, toolchain/programmer/instrument/fixture profiles, approved limits/calibration standards, reproducible build, PCB access closure, hardware observations, or qualified cross-domain review. |
| Minimum action | Close CD-9/CD-10; approve exact device/equipment/tool/policy snapshots; compile the full fixed denominator; obtain PCB access feedback, reproducible build evidence, dry-run qualification, and qualified review. |
| Safe retained work | Contracts, gates, device facts, resource solver/certificates, lifecycle/DFT/factory/calibration/generation/bring-up engines, APIs, persistence, migration, UI, corpus, and tests. |

## Deliverable status

Foundation implemented: schemas/migration, exact evidence architecture, resources/certificates, lifecycle safety, DFT/access, uncertainty/limits, calibration/identity contracts, typed configuration/diagnostics, bring-up/isolation, coverage/readiness, lifecycle/cache semantics, APIs/UI/security/corpus. Partial only: boundary-scan providers, fixture/tool adapters, deterministic target generators/build pipeline, full factory/calibration flows, observability dashboards, mutation/fuzz/property corpus. Missing and blocking: qualified review closure and an authoritative sample ready package.

## Formal verdict

### `BLOCKED`

Primary blocker: `BLOCKED BY CD-10`. No hardware execution, factory/calibration result, product firmware, PCB closure, manufacturing release, or bench-validation claim is made.
