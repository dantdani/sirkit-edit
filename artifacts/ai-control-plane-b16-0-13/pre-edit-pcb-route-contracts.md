# B16.0.13 §A — Pre-edit PCB route contracts (pinned BEFORE migration)

[`app/api/__tests__/b16-0-13-tranche-parity.test.ts`](../../app/api/__tests__/b16-0-13-tranche-parity.test.ts)
was written against the PRE-migration raw handlers and run GREEN first
(**36 / 36** after one guessed error string was corrected against the recorded
pre-edit output — the autoroute empty-body refusal is
`body.board must be a PcbBoard`), then kept green unchanged post-migration.

Fakes: `llmRouter.generate`, `runFreerouting` + `resolveFreeroutingRuntime`,
`buildFabBundle` + `compileNativeFabPackage` — no provider credit, no live
process, no DB.

## Shared boundary pins (×5 routes)

| Pin | Contract |
|---|---|
| anonymous | 401 `AUTH_UNAUTHENTICATED`, **0 body pulls**, 0 provider/process/export calls |
| production cross-origin | 403 CSRF, 0 pulls, 0 work |
| insufficient role (viewer) | 403, 0 pulls, 0 work |
| revoked membership | 403, 0 work |
| text/plain | 415, 0 pulls |
| malformed JSON | 400 `AUTH_INVALID_JSON` |
| oversized (16 MB + 1) | 413 |
| empty-body required-field | exact per-route text (below), 0 work |

## Per-route required-field contracts (exact)

| Route | Refusal |
|---|---|
| from-brief | 400 `brief (string) and board.{netNames:string[], hasIcs:boolean} are required` |
| autoroute | 400 `body.board must be a PcbBoard` |
| edit/assist | 400 `instruction (string) and digest (object) are required` |
| export/gerbers | 400 `{error:"bad-request", message:"body.board must be a PcbBoard"}` |
| repair/agent | 400 `board must be a PcbBoard` |

## Additional pins

- repair/agent valid: `generate` EXACTLY once (requested provider), no-tool →
  plan path, 200 `{ok, plan, snapshotRevisionId}`, board input NOT mutated;
- from-brief / edit-assist provider failure → normalized 503 with `generate`
  exactly once; inputs unchanged;
- autoroute PRE-ABORTED signal → 400 `AUTH_BODY_ABORTED` with ZERO
  runtime/runner calls (no process can spawn);
- gerbers forbidden attribution keys ×8 (`actor`, `projectIdentity`, `actorId`,
  `role`, `tenantId`, `projectId`, `branchId`, `principalId`) → exact
  `bad-request` message; `releaseMode:"verified"` refused, zero export work.

Deep valid-path parity (DSN/SES, protected copper, sourceRevision conflicts,
readiness, engineering waivers, archive bytes/headers) is carried by the
STANDING suites — `autoroute/route.test` (24), `gerbers/route.test` +
`b16-0-2-engineering-export`, `from-brief.test`, `assist-validation` +
`assist-live` — all green unchanged post-migration (51 pass / 4 pre-existing
skips).
