# B16.0.22 §I — ratchet evidence

- `TRANCHE_15` added to `b16-0-8-migration-ratchet.test.ts`: the 8 methods
  (GET+POST assignment-queue, POST footprint-resolution, GET passive-policy,
  GET pcb-sync, GET+POST physical-bindings, POST replacement-authority),
  each pinned canonical FOREVER — reverting any fails CI.
- `BASELINE_MAX` **29 → 21**; `MIGRATED_FLOOR` **124 → 132**.
- Baseline regenerated ONLY via `scripts/generate-b16-0-8-baseline.ts`:
  "Updated raw-route baseline: 29 → 21 legacy methods (**8 migrated, 0
  added**)".
- Wrapper matrix regenerated via `scripts/generate-b16-0-7-artifacts.ts`:
  "153 methods — **132 canonical wrappers, 3 factories, 18 raw**".
- Both generators run ×2 — byte-stable:
  - `route-wrapper-matrix.csv` sha1 `de1a29050b8b89a4be8d8b152a8718262ac04945`
  - `_raw-route-baseline.json` sha1 `fc3203a5170f827f1b5522ce28b407b93c61652f`
    (21 rows)
- Ratchet suite: **8/8 green** post-edit.
