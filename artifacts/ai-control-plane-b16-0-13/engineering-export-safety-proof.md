# B16.0.13 §H — Engineering Gerber export safety proof

The route remains an explicitly labelled ENGINEERING/PROTOTYPE export; nothing
about the verified-release machinery was touched.

| Requirement | Evidence |
|---|---|
| Forbidden attribution/authority body fields | pinned ×8 keys (`actor`, `projectIdentity`, `actorId`, `role`, `tenantId`, `projectId`, `branchId`, `principalId`) → exact `bad-request` message, zero export work |
| Trusted actor/project attribution | `engineeringExportAttribution(context)` — the wrapper's trusted context only (was `authorized.context`; same object) |
| Fab/DRC preset validation, source/netlist/readiness checks | route code byte-preserved; standing gerbers suites green |
| **Verified-release refusal** | `releaseMode: "verified"` refused with zero export work (pinned); only `engineering` is producible here |
| Engineering waiver requirements, preflight behavior, native-beta + KiCad-assisted engines | unchanged code; standing `route.test` + `b16-0-2-engineering-export` suites green |
| Archive bytes / filenames / Content-Disposition / no-store + engineering-export + readiness/disposition headers / bounded stderr / error codes | standing suites pin them (fake `buildFabBundle` + fake native compiler); unchanged — [export-byte-and-header-parity.md](export-byte-and-header-parity.md) |
| A browser board cannot become verified manufacturing-release authority | the refusal above + the untouched internal-only chain: authoritative MFG01 source loading, `/api/pcb/release`, verified release publication, and release capability minting are all UNCHANGED and remain internal-only (release/qualify routes excluded from this tranche; the manufacturing-release gate passes inside the full run) |

The kind-guard branch note: the old in-route non-authenticated kind branch
(401 `unauthenticated`) is unreachable under the authenticated policy row and
is now the wrapper's uniform 403 `AUTH_UNSUPPORTED_PRINCIPAL` — recorded in
[unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md), observable
in no pinned contract.
