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
| B19-C quarantine-to-authority pipeline | `quarantine-pipeline.md` | I4 CONFIRMED (front half: observation, candidate, evidence bundle); I4b CONFIRMED (approval refuses sourcing-only engineering evidence and unreviewed AI extraction) |
| B19-D import security and licensing | `import-security.md`, `import-security-matrix.md` | I5a CONFIRMED (license at export); I5b–I5e CONFIRMED (53 matrix rows closed: the acquisition path, output injection, KiCad parsing and atomic integrity, project imports, BOM tables, DSN tokens, what reaches a model), each with an adversarial review whose confirmed findings were fixed test-first |
| B19-E product and agent experience | `acquisition-ux.md` | E1–E5 CONFIRMED (`076d542`..`78a0d21`: pricing provenance and workbench labels, bounded external candidate search, exact-revision integrity, import review and two-person publication, lifecycle and successor rebind — each reviewed adversarially); E6 CONFIRMED (two bounded Tier 0 agent reads, `sirkit.parts.external-search` and `sirkit.parts.evidence-read`, through one approved chat runtime boundary; labels only while agentDisclosure is unknown, OD-36; exact MPNs, at most 5 live per run, OD-40) |
| validation | `test-and-validation-report.md`, `changed-files.md`, `unknowns-and-owner-decisions.md`, `final-verdict.md` | CONFIRMED on the final tree: full suite 634 files / 6,560 tests passed / 35 env-gated skips / 0 failures; tsc 0; eslint no new finding on 306 changed files; 14 generators zero drift; ratchets intact (162 = 159 + 3 + 0); CI green on the final code commit `bf88eba`; the live contract check BLOCKED-LIVE-QUALIFICATION (operator-run only) |

Program ledger: `artifacts/remaining-builder-program/`.
