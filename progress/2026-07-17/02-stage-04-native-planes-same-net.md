# Stage 4 — Native Planes and Same-Net Copper Correctness

Implemented stable stackup-generated native plane zones, deterministic revision-bound fill provenance, stale-result rejection, pad/via thermal access, keepouts, priority and island controls, and one stable-net-aware copper-pair policy across connectivity, DRC, routing, fill, autoroute, readiness, AI, and export.

DSN, KiCad, and native fabrication now derive plane behavior from native objects. DSN/native outputs carry conservation certificates; stale or failed fill cannot conduct or authorize manufacturing. Plane layer usage now reports filled area, zone/net identity, fill state, and via access instead of only trace length.

Verification: 622 tests passed with 9 intentional skips; TypeScript, focused Stage 4 ESLint, and the production build passed. Detailed evidence: `SIRKIT_STAGE_04_NATIVE_PLANES_SAME_NET_IMPLEMENTATION.md`.

STAGE 4 COMPLETE
