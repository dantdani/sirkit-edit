# B12.6 — changed files

| File | Change |
| --- | --- |
| `app/lib/project/autosave.ts` | NEW exports `settleAutosaveForTransition` + `AutosaveSettlement` (the production transition-settlement boundary: false AND thrown flushes → typed failure with bounded, secret-redacted detail via the shared `sanitizeTraceText`; missing autosaver / nothing pending → ok); new import of `sanitizeTraceText` from the dependency-neutral redaction module. `createAutosaver` itself: UNCHANGED |
| `app/page.tsx` | `beforeInstall` replaced: the defective inline flush-and-return-ok (with its unreachable catch) becomes `() => settleAutosaveForTransition(autosaverRef.current)`; import extended. No other page change |
| `app/lib/engineering/__tests__/b12-6-autosave-settlement.test.ts` | NEW — 12 permanent tests (real autosaver + real coordinator + production pointer commit; page source gate) |
| `artifacts/ai-control-plane-b12-6/` | 10 stage documents |

No dependency changes. No schema, pin, hash, tool-surface, provider, or
coordinator/journal/pointer code changes. The protected original was not
touched.
