# R05-RC02 Autorouter, SES, and DRC Boundary Integrity

## 1. Verdict and repository fingerprints

**Verdict: `COMPLETE`.** The exact board returned by the autoroute API now owns its statistics, semantic revision, connectivity, DRC result, and pass evidence. A pass cannot be accepted unless its pass ID, authoritative source revision, router-input revision, parser provenance, and candidate revision are consistent. Complete status requires zero reconstructed remaining connections, zero shorts, and zero route-blocking DRC errors.

| Item | Evidence |
|---|---|
| Working repository | `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit` |
| Protected original | `C:\Users\robsa\sirkit` exists and was not modified |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Starting status fingerprint | `105663b976ef91644ca548d5ddfd4bef9b4ac60236b483a59f7b254812d84531` |
| Final status fingerprint | `0edee71a1a715fb6902a9c8a77b5b624cb2276de3019c59b0134200f7a5ea275` |
| Starting full TypeScript | exit 0, zero diagnostics |
| Final full TypeScript | exit 0, zero diagnostics |
| RC01 prerequisite | `artifacts/prompt-to-gerber/r05-rc01-report.md`: `COMPLETE` |
| FreeRouting | bundled `2.2.4`, 57,766,203 bytes, SHA-256 `f5ed374182900ccc78e473518bbb9f6b869f4a07159495f663a76f52bb10523b` |
| Java | bundled Temurin OpenJDK `25.0.3+9` LTS |

The repository was substantially dirty before RC02. All pre-existing dirty/untracked work was preserved. No reset, clean, stash, stage, commit, push, rebase, migration, dependency update, lockfile update, router binary update, or broad formatting was performed.

## 2. Current autoroute call graph

```text
authoritative PcbBoard + semantic revision
  -> completeAutoroute (bounded pass controller)
     -> API pass executor
        -> engine-only routing projection
        -> RC01 boardToDsn + validateDsn + writeDsn
        -> SHA-256 DSN evidence
        -> bundled headless/offline FreeRouting runner
        -> process/output-file evidence
        -> strict parseSes (all-or-nothing)
        -> semantic/session/import evidence
        -> buildAutorouteCandidate
        -> restore protected human/imported/locked copper
        -> candidate semantic revision
     -> pass/source/parser/candidate identity gates
     -> reconstructed electrical truth + DRC
     -> monotonic acceptance/retry or explicit rejection
  -> exact returned candidate
  -> fabrication readiness
  -> response stats calculated from returned candidate
  -> bounded internal debug manifest keyed by opaque artifact ID
```

## 3. Audit reproductions and dispositions

| Finding | Baseline reproduction | Final disposition |
|---|---|---|
| C-06 same-net clearance | Existing focused tests already proved close `3V3` tracks emitted no inter-net clearance while identical different nets did. | `ALREADY_FIXED`; strengthened with live-route, batch-DRC, net-zero/orphan, and route-blocking verification regressions. |
| C-07 empty/unsuccessful SES | Runner already rejected missing/empty output and parser threw `SesImportError` with `wasSuccessful:false`; partial zero-improvement remained non-complete. | `ALREADY_FIXED`; strengthened with zero-byte, whitespace, malformed-after-exit-success, and explicit evidence tests. |
| C-12 unknown SES unit | Parser already hard-failed missing/unknown/invalid resolution. | `ALREADY_FIXED`; canonical unit table and both Unicode micro aliases are now explicitly tested/normalized. |
| C-10 pass/candidate mismatch | API used `bestAcceptedAttempt.parsed` counts even when a later rejected pass existed and the returned board was the prior candidate. It also exposed a local debug directory. | `FIXED`; returned-board delta/total stats, pass manifests, returned-candidate marker, and opaque debug artifact ID are now consistent. |

Additional reproductions passed: truncated syntax, unknown layer/net/padstack, unsupported arc, conflicting duplicates, genuine partial routing, later-pass DRC rejection, protected copper, and stale source authority.

## 4. Clearance rules

- Same verified nonzero stable net: ordinary inter-net copper clearance is not emitted; intentional joins/touching/overlap remain electrically legal.
- Different verified nonzero stable nets: resolved clearance is enforced exactly and geometric contact remains a short.
- Net `0`, missing identity, ambiguous identity, or orphan copper: no same-net exemption is inferred. The conservative existing policy remains active.
- Width, via diameter/drill, annular ring, hole-to-hole, edge, containment, keepout, courtyard, and other independent fabrication rules remain active regardless of net equality.
- Live routing and batch DRC consume the same `decideCopperPair`/`violatesOrdinaryCopperClearance` policy path.

## 5. SES process/file/parse/semantic contract

The boundary now records separate states instead of treating Java exit zero as route success:

1. `processStatus`: not-started, exit-success, exit-nonzero, timeout, cancelled, or spawn-failed;
2. `outputFileStatus`: not-checked, missing, empty, or nonempty;
3. `parserStatus`: not-run, rejected, or success;
4. `semanticStatus`: not-run, rejected, or success;
5. candidate revision and reconstructed connectivity/DRC;
6. acceptance decision and exact reasons.

The runner rejects missing, zero-byte, and whitespace-only output. `parseSes` is all-or-nothing: malformed/truncated S-expressions, missing routes/resolution, stale manifest, unknown/disabled layer, unknown net/padstack, unsupported arcs, invalid/non-finite/unsafe coordinates, and conflicting duplicates throw `SesImportError` with empty conductive output and `wasSuccessful:false`. Exact duplicate segments/vias are deterministic and do not inflate imported counts. A valid no-geometry SES can only become a no-improvement partial/failed pass; it cannot become final success while connections remain.

## 6. Supported coordinate units

| SES spelling | Nanometres per unit at resolution factor 1 |
|---|---:|
| `nm` | 1 |
| `um`, `µm`, `μm`, `micrometer`, `micrometers` | 1,000 |
| `mm` | 1,000,000 |
| `mil` | 25,400 |
| `inch`, `in` | 25,400,000 |

The scale is `nanometres-per-unit / units-per-coordinate`. Missing, non-finite, zero, negative, or unknown resolution is a hard semantic rejection; there is no one-nanometre fallback.

## 7. Partial, retry, and terminal semantics

- Completion is reconstructed from stable-net pad/copper connectivity, never engine prose, route counts, or SES presence.
- `remainingConnections > 0` is `partial`/`blocked`, never complete.
- Bounded retries target incomplete nets without regressing previously complete stable nets or assigned endpoints.
- New unresolved electrical facts, shorts, DRC errors, or increased route-blocking DRC reject a candidate without mutation.
- Safe partial progress remains supported by the existing product and is explicitly returned as `job.status: partial`, `completion.status: blocked`, and not fabrication-ready.
- No safe improvement returns the best prior/original board. Metrics are recomputed from that returned board.

## 8. Protected copper and stale authority

Human, imported, and locked copper is restored from the exact pass source board and tested byte-for-byte. Generated replacement remains limited to the exact routing projection/target nets. The controller separately records:

- authoritative pass-source revision;
- DSN/router-input revision (which may differ because selected-net rerouting removes replaceable generated copper);
- SES parser source revision;
- exact candidate semantic revision.

A nominally successful output with a wrong pass ID, stale authoritative revision, mismatched parser provenance, or candidate revision mismatch fails before verification. The API also rejects an explicitly stale caller revision with HTTP 409 before launching FreeRouting.

## 9. Pass/candidate evidence schema

Every response pass contains: pass ID; reported pass ID; authoritative source revision; reported/DSN source revision; target nets; effort and max passes; SHA-256 DSN/SES digests; safe runtime/command profile; process/file/parser/semantic states; SES byte length; imported track/via counts; candidate revision; connectivity and DRC before/after; decision; rejection reasons; elapsed time; and `returnedCandidate`.

Exactly the best accepted pass is marked `returnedCandidate:true`, or all attempts are false when the original board is returned. Client responses contain only the opaque `debugArtifactId`, never a local filesystem path or unbounded router output. Internal debug manifests contain the same bounded pass ledger and no secrets.

Final statistics are calculated from the exact returned candidate:

- imported track/via delta versus the submitted board;
- total returned tracks/vias;
- candidate revision;
- completed/remaining connections;
- route-blocking DRC count;
- authoritative per-layer usage.

## 10. Real bundled FreeRouting qualification

Final combined qualification run:

| Fixture | Engine time | Imported tracks | Vias | Layers | Remaining | Shorts | Blocking DRC | Result |
|---|---:|---:|---:|---|---:|---:|---:|---|
| Simple authoritative 2L | 9,001 ms | 1 | 0 | top | 0 | 0 | 0 | PASS |
| Forced-crossing authoritative 2L | 6,140 ms | 7 | 2 | top + bottom | 0 | 0 | 0 | PASS |

The crossing uses a locked human top-copper barrier extending to the legal edge corridor. FreeRouting was forced through two through-vias onto bottom copper and back. The protected barrier remained byte-identical. Same-net/different-net/partial/invalid-SES/stale-authority fixtures are deterministic focused boundary tests; invalid and rejected candidates leave the returned authority unchanged.

An earlier diagnostic attempt used a barrier with a routable top-layer path around it and correctly produced no vias; a second overly tight 30 mm variant timed out. Neither was counted as acceptance evidence. The final 20 mm fixture is geometrically forced and passed twice, including the combined suite.

## 11. Commands and results

| Gate | Result |
|---|---|
| Baseline focused autoroute/DRC/SES/runtime/API | 11 files, 79/79 passed |
| Clean combined affected + RC01 DSN parity + real-router suite | 15 files, 111/111 passed, 1 environment-gated database test skipped before two additional Unicode-unit cases |
| Final parser/unit suite | 21/21 passed |
| Final isolated route-tool suite | 25/25 passed; direct-preview p95 31.016 ms and walk-around p95 3.012 ms |
| Full TypeScript | `npx tsc --noEmit`: exit 0, zero diagnostics |
| Focused lint | `npx eslint <13 product/test paths>`: exit 0, zero warnings |
| Diff whitespace check | exit 0; only Git's existing LF-to-CRLF checkout warnings |

The combined command included clearance DRC, route-tool, SES parser, autoroute integration/completion/verification/command/runtime/API, the real boundary fixture, and RC01 `dsn-integrity`, `write-dsn`, and `electrical-identity-boundary` regressions. A later all-in-one repeat ran every correctness and real-router case successfully but the 500-track timing test exceeded Vitest's five-second wall-clock timeout under concurrent Java/test contention. Its isolated rerun passed 25/25 with the performance figures above. Across the final split gates, all 113 unique focused tests passed; the one PostgreSQL-only test remained intentionally skipped.

## 12. Database and runtime identity

No database was needed or started. The one RC01 PostgreSQL-only durability case remained intentionally skipped without `R05_RC01_DATABASE_URL`. The routing boundary used the bundled Temurin Java 25.0.3+9 runtime and exact FreeRouting 2.2.4 JAR identified in Section 1. No external API key or network autorouter was used.

## 13. Exact files and churn

RC02 changed 13 product/test files:

1. `app/lib/pcb/dsn/read-ses.ts`
2. `app/lib/pcb/autoroute/runner.ts`
3. `app/lib/pcb/autoroute/completion.ts`
4. `app/lib/pcb/autoroute/verification.ts`
5. `app/lib/pcb/autoroute/debug-bundle.ts`
6. `app/api/pcb/autoroute/route.ts`
7. `app/lib/pcb/__tests__/drc-clearance.test.ts`
8. `app/lib/pcb/__tests__/route-tool.test.ts`
9. `app/lib/pcb/__tests__/read-ses.test.ts`
10. `app/lib/pcb/__tests__/autoroute-completion.test.ts`
11. `app/lib/pcb/__tests__/autoroute-verification.test.ts`
12. `app/api/pcb/autoroute/__tests__/route.test.ts`
13. `app/lib/pcb/__tests__/autoroute-boundary-integrity.test.ts`

Task-local patch ledger: **+619 / -76** (695 total churn), below 14 files and 1,600 total churn. The ledger counts only RC02 patch hunks; several files already had authorized pre-existing changes at the captured baseline, so raw HEAD-to-working-tree numstat is not a valid RC02 attribution.

## 14. Forbidden paths and cleanup

No schematic/component/footprint/mapping/RC01 DSN writer, editor/assignment queue/auth/durable sync, placement, stackup/plane/zone model, Gerber/manufacturing, schema/migration, dependency/lockfile, or bundled runtime path was changed by RC02. No generated artifact was added outside the one authorized report. API test debug bundles remain bounded OS-temporary diagnostics identified by opaque IDs and are not repository content. No server, Java process, database, container, staged file, commit, or pushed branch was left by this batch.

## 15. Authorization

All RC02 completion gates pass. **R05-RC03 autonomous placement/routing capability qualification is authorized.** This does not authorize R04D final qualification, Gerber release, or manufacturing release.

```text
R05-RC02 VERDICT: COMPLETE
SAME-NET CLEARANCE SEMANTICS: PASS
DIFFERENT-NET CLEARANCE ENFORCED: PASS
EMPTY/UNSUCCESSFUL SES REJECTED: PASS
UNKNOWN SES UNIT REJECTED: PASS
PARTIAL ROUTE REMAINS NOT-READY: PASS
RETURNED BOARD/EVIDENCE CONSISTENT: PASS
PROTECTED COPPER PRESERVED: PASS
STALE ROUTE RESULT REJECTED: PASS
SIMPLE 2L REAL ROUTE: PASS
FORCED-CROSSING 2L REAL ROUTE: PASS
FULL TYPESCRIPT: PASS
FOCUSED TESTS: 113/113 (1 environment-gated skip)
PRODUCT/TEST FILES CHANGED: 13
PRODUCT/TEST DIFF CHURN: +619 / -76
MIGRATION OR SCHEMA CHANGED: NO
FORBIDDEN FILES CHANGED: NO
R05-RC03 AUTHORIZED: YES
R04D FINAL QUALIFICATION AUTHORIZED: NO
GERBER RELEASE AUTHORIZED: NO
REPORT: artifacts/prompt-to-gerber/r05-rc02-report.md
```
