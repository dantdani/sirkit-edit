# B16.0.23 §K — ratchet evidence

- `TRANCHE_16` added to `b16-0-8-migration-ratchet.test.ts`: the 13 SPICE
  methods (POST ai/compile/models·import/models·smoke-test/reports/
  run-plans·estimate, GET+POST runs, GET+DELETE runs/[id], GET
  runs/[id]/{bundle,events,waveforms}), each pinned canonical FOREVER —
  reverting any fails CI.
- `BASELINE_MAX` **21 → 8**; `MIGRATED_FLOOR` **132 → 145**.
- Baseline regenerated ONLY via `scripts/generate-b16-0-8-baseline.ts`:
  "Updated raw-route baseline: 21 → 8 legacy methods (**13 migrated, 0
  added**)".
- Wrapper matrix regenerated via `scripts/generate-b16-0-7-artifacts.ts`:
  "153 methods — **145 canonical wrappers, 3 factories, 5 raw**".
- Both generators run ×2 — byte-stable:
  - `route-wrapper-matrix.csv` sha1 `4a8d6980011f168429389f67c1cac25d010c72c4`
  - `_raw-route-baseline.json` sha1 `494229f5c45c2be0e974cb791e3679ff0cd1cc8e`
    (8 rows)
- Ratchet suite green post-edit; no new raw method introduced; factories
  remain 3 (pcb-sync POST, passive-policy POST, + one prior).
