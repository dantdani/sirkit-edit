# Stage 8 professional interactive routing

- Worked only in the protected copy at `work/sirkit-edit`; the original `C:\Users\robsa\sirkit` was not edited.
- Added a versioned immutable routing snapshot, layer-aware topology graph, exact contact anchors, stable route IDs, central copper-protection policy, candidate deltas, stale-checked commit/revert, exact path measurement, bounded shove foundation, native-segment tuning, and typed differential-pair foundations.
- Reworked the live route tool so a multi-click route and its vias remain candidate-only until a valid same-net destination. Backspace/cancel do not touch board history; finish is one immutable history command.
- Removed the binary top/bottom via assumption. Through-via choices now traverse the configured 2/4-layer stackup and respect compiled layer/via rules.
- Added persisted Highlight/Walk around/Shove and 90°/45°/Any-angle controls. Arbitrary-angle straight copper is accepted end to end by the active preview path.
- Default right-click rip-up is selection-scoped and centrally preserves locked, imported, unknown, and out-of-scope manual copper.
- Added provider-neutral AI operations based on stable anchor IDs; the LLM cannot submit raw route points or directly commit copper.
- Added the 18-fixture corpus declaration plus focused behavioral tests.

Verification:

- `npx tsc --noEmit` — passed.
- Focused Stage 8/route tests — 35 passed.
- `npm test -- --reporter=dot` — 125 files passed, 2 skipped; 792 tests passed, 9 skipped.
- Targeted ESLint — passed.
- `npm run build` — passed; only pre-existing Turbopack executable-discovery warnings.

Verdict remains incomplete because topology-preserving multi-object shove, cornered differential-pair routing/neckdown/uncoupling, pair/bus tuning, via/junction drag, all 18 concrete executable fixtures, and the full required performance/import-export matrix are not yet implemented and proven.
