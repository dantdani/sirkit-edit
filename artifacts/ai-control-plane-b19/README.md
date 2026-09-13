# B19 — External component and evidence acquisition (`chapter/b19-external-acquisition`)

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised),
**RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Base: `5a59a1f` (B18 merged normally in PR #8, 2026-09-12). Mission: Sirkit may discover and ingest component data from
approved external services **without** treating distributor text, model output, downloaded CAD, or a matching MPN as
authoritative engineering truth.

| checkpoint | artifact | state |
|---|---|---|
| discovery | `discovery.md` (six read-only readers over the connectors, the outbound boundary, the quarantine-to-authority pipeline, import security, the product surfaces and the existing tests) | INFERRED — to be confirmed by reproduction in I1 |
| B19-A source and connector registry | `source-registry.md`, `source-registry.csv` (generated, gated) | I3 CONFIRMED (registry 1.0.0; connectors enforce it; Mouser disabled OD-32, LCSC blocked) |
| B19-B safe acquisition boundary | `acquisition-boundary.md` | I1 CONFIRMED (the egress path and the three clients); I2 CONFIRMED (who may spend quota; no failure text repeated); I2b CONFIRMED (cross-verify's call through the same boundary); I3b CONFIRMED (registered quotas, circuit breakers, in-flight coalescing) |
| B19-C quarantine-to-authority pipeline | `quarantine-pipeline.md` | I4 CONFIRMED (front half: observation, candidate, evidence bundle); I4b planned (approval evidence rules) |
| B19-D import security and licensing | `import-security.md` | planned |
| B19-E product and agent experience | `acquisition-ux.md` | planned |
| validation | `test-and-validation-report.md`, `changed-files.md`, `unknowns-and-owner-decisions.md`, `final-verdict.md` | planned |

Program ledger: `artifacts/remaining-builder-program/`.
