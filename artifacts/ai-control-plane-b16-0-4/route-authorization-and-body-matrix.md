# B16.0.4 §A/§C — generated route matrices

Protected exported methods: **121** — all load-bearing (zero rejects).
Public exported methods (policy: no auth): **32**.
Direct unbounded body reads across all `app/api` handlers: **0**.

## §A — authorization boundary per protected method

| Method + path | Class | Boundary | Shape |
|---|---|---|---|
| `GET /api/ai/runtime` | public | — | (policy: no auth) |
| `POST /api/architecture/alternatives` | protected | ✅ load-bearing | guard |
| `POST /api/architecture/candidates` | protected | ✅ load-bearing | guard |
| `POST /api/architecture/compare` | protected | ✅ load-bearing | guard |
| `POST /api/architecture/problem` | protected | ✅ load-bearing | guard |
| `POST /api/architecture/propose` | protected | ✅ load-bearing | guard |
| `POST /api/assignment-queue/materialize` | protected | ✅ load-bearing | guard |
| `POST /api/assignment-queue/revalidate` | protected | ✅ load-bearing | guard |
| `GET /api/assignment-queue` | protected | ✅ load-bearing | guard |
| `POST /api/assignment-queue` | protected | ✅ load-bearing | guard |
| `GET /api/auth/callback` | public | — | (policy: no auth) |
| `POST /api/auth/signin` | public | — | (policy: no auth) |
| `POST /api/auth/signout` | public | — | (policy: no auth) |
| `POST /api/bom/cart/digikey` | public | — | (policy: no auth) |
| `POST /api/bom/cart/lcsc` | public | — | (policy: no auth) |
| `POST /api/bom/cart/mouser` | public | — | (policy: no auth) |
| `POST /api/bom/diff` | protected | ✅ load-bearing | guard |
| `POST /api/bom/export-csv` | public | — | (policy: no auth) |
| `GET /api/bom/notifications` | protected | ✅ load-bearing | guard |
| `PATCH /api/bom/notifications` | protected | ✅ load-bearing | guard |
| `DELETE /api/bom/notifications` | protected | ✅ load-bearing | guard |
| `POST /api/bom/procurement-packet` | public | — | (policy: no auth) |
| `POST /api/bom` | public | — | (policy: no auth) |
| `POST /api/bom/snapshot` | protected | ✅ load-bearing | guard |
| `GET /api/bom/snapshot` | protected | ✅ load-bearing | guard |
| `POST /api/calculation/corners` | protected | ✅ load-bearing | guard |
| `POST /api/calculation/evaluate` | protected | ✅ load-bearing | guard |
| `POST /api/calculation/export` | protected | ✅ load-bearing | guard |
| `POST /api/calculation/feedback` | protected | ✅ load-bearing | guard |
| `POST /api/calculation/problem` | protected | ✅ load-bearing | guard |
| `POST /api/calculation/propose` | protected | ✅ load-bearing | guard |
| `POST /api/calculation/report` | protected | ✅ load-bearing | guard |
| `POST /api/calculation/transaction` | protected | ✅ load-bearing | guard |
| `POST /api/chat` | protected | ✅ load-bearing | guard |
| `POST /api/circuit-knowledge/applicability` | protected | ✅ load-bearing | guard |
| `POST /api/circuit-knowledge/compile` | protected | ✅ load-bearing | guard |
| `POST /api/circuit-knowledge/compose` | protected | ✅ load-bearing | guard |
| `POST /api/circuit-knowledge/problem` | protected | ✅ load-bearing | guard |
| `POST /api/circuit-knowledge/propose` | protected | ✅ load-bearing | guard |
| `POST /api/circuit-verification/problem` | protected | ✅ load-bearing | guard |
| `POST /api/circuit-verification/propose` | protected | ✅ load-bearing | guard |
| `POST /api/circuit-verification/readiness` | protected | ✅ load-bearing | guard |
| `POST /api/circuit-verification/run` | protected | ✅ load-bearing | guard |
| `POST /api/component-selection/alternative` | protected | ✅ load-bearing | guard |
| `POST /api/component-selection/catalog` | protected | ✅ load-bearing | guard |
| `POST /api/component-selection/evaluate` | protected | ✅ load-bearing | guard |
| `POST /api/component-selection/export` | protected | ✅ load-bearing | guard |
| `POST /api/component-selection/feedback` | protected | ✅ load-bearing | guard |
| `POST /api/component-selection/problem` | protected | ✅ load-bearing | guard |
| `POST /api/component-selection/propose` | protected | ✅ load-bearing | guard |
| `POST /api/component-selection/solve` | protected | ✅ load-bearing | guard |
| `POST /api/component-selection/sourcing` | protected | ✅ load-bearing | guard |
| `POST /api/component-selection/transaction` | protected | ✅ load-bearing | guard |
| `GET /api/components/atomic` | public | — | (policy: no auth) |
| `POST /api/components/atomic/search` | public | — | (policy: no auth) |
| `POST /api/constraints/explain` | public | — | (policy: no auth) |
| `POST /api/constraints/preview` | public | — | (policy: no auth) |
| `POST /api/engineering-effects` | protected | ✅ load-bearing | guard |
| `POST /api/export/kicad` | public | — | (policy: no auth) |
| `POST /api/firmware-bringup/problem` | protected | ✅ load-bearing | guard |
| `POST /api/firmware-bringup/propose` | protected | ✅ load-bearing | guard |
| `POST /api/firmware-bringup/resources` | protected | ✅ load-bearing | guard |
| `GET /api/footprint-resolution` | protected | ✅ load-bearing | guard |
| `POST /api/footprint-resolution` | protected | ✅ load-bearing | guard |
| `POST /api/full-flow/propose` | protected | ✅ load-bearing | guard |
| `POST /api/full-flow/run` | protected | ✅ load-bearing | guard |
| `POST /api/full-flow/transition` | protected | ✅ load-bearing | guard |
| `POST /api/interfaces/allocate` | protected | ✅ load-bearing | guard |
| `POST /api/interfaces/alternatives` | protected | ✅ load-bearing | guard |
| `POST /api/interfaces/candidates` | protected | ✅ load-bearing | guard |
| `POST /api/interfaces/compare` | protected | ✅ load-bearing | guard |
| `POST /api/interfaces/problem` | protected | ✅ load-bearing | guard |
| `POST /api/interfaces/propose` | protected | ✅ load-bearing | guard |
| `GET /api/kicad/v1/categories.json` | public | — | (policy: no auth) |
| `GET /api/kicad/v1/parts/[id]` | public | — | (policy: no auth) |
| `GET /api/kicad/v1/parts/category/[id]` | public | — | (policy: no auth) |
| `GET /api/kicad/v1` | public | — | (policy: no auth) |
| `GET /api/mapping-verification` | protected | ✅ load-bearing | guard |
| `POST /api/mapping-verification` | protected | ✅ load-bearing | guard |
| `POST /api/model-simulation/denominator` | protected | ✅ load-bearing | guard |
| `POST /api/model-simulation/execute` | protected | ✅ load-bearing | guard |
| `POST /api/model-simulation/measure` | protected | ✅ load-bearing | guard |
| `POST /api/model-simulation/problem` | protected | ✅ load-bearing | guard |
| `POST /api/model-simulation/propose` | protected | ✅ load-bearing | guard |
| `POST /api/model-simulation/readiness` | protected | ✅ load-bearing | guard |
| `GET /api/parts/[id]/alternates` | public | — | (policy: no auth) |
| `GET /api/parts/[id]` | public | — | (policy: no auth) |
| `GET /api/parts/categories` | public | — | (policy: no auth) |
| `POST /api/parts/search` | public | — | (policy: no auth) |
| `GET /api/passive-policy` | protected | ✅ load-bearing | guard |
| `POST /api/passive-policy` | protected | ✅ load-bearing | guard |
| `GET /api/pcb-sync` | protected | ✅ load-bearing | guard |
| `POST /api/pcb-sync` | protected | ✅ load-bearing | guard |
| `POST /api/pcb/ai-rules/from-brief` | protected | ✅ load-bearing | guard |
| `POST /api/pcb/apply-authorization` | protected | ✅ load-bearing | guard |
| `POST /api/pcb/assign/suggest` | protected | ✅ load-bearing | guard |
| `POST /api/pcb/autoroute` | protected | ✅ load-bearing | guard |
| `POST /api/pcb/edit/assist` | protected | ✅ load-bearing | guard |
| `POST /api/pcb/export/gerbers` | protected | ✅ load-bearing | guard |
| `POST /api/pcb/export/kicad-pcb` | public | — | (policy: no auth) |
| `GET /api/pcb/footprints/[id]` | public | — | (policy: no auth) |
| `GET /api/pcb/footprints/resolve` | public | — | (policy: no auth) |
| `GET /api/pcb/footprints/search` | public | — | (policy: no auth) |
| `POST /api/pcb/placement/preview` | public | — | (policy: no auth) |
| `POST /api/pcb/qualify` | protected | ✅ load-bearing | guard |
| `POST /api/pcb/release` | protected | ✅ load-bearing | guard |
| `POST /api/pcb/repair/agent` | protected | ✅ load-bearing | guard |
| `GET /api/physical-bindings` | protected | ✅ load-bearing | guard |
| `POST /api/physical-bindings` | protected | ✅ load-bearing | guard |
| `POST /api/power/alternatives` | protected | ✅ load-bearing | guard |
| `POST /api/power/candidates` | protected | ✅ load-bearing | guard |
| `POST /api/power/compare` | protected | ✅ load-bearing | guard |
| `POST /api/power/problem` | protected | ✅ load-bearing | guard |
| `POST /api/power/propose` | protected | ✅ load-bearing | guard |
| `POST /api/power/reconcile` | protected | ✅ load-bearing | guard |
| `POST /api/release-engineering/problem` | protected | ✅ load-bearing | guard |
| `POST /api/release-engineering/propose` | protected | ✅ load-bearing | guard |
| `POST /api/replacement-authority` | protected | ✅ load-bearing | guard |
| `GET /api/requirements/capabilities` | public | — | (policy: no auth) |
| `POST /api/requirements/compile` | protected | ✅ load-bearing | guard |
| `POST /api/requirements/sources` | protected | ✅ load-bearing | guard |
| `POST /api/schematic-compiler/compare` | protected | ✅ load-bearing | guard |
| `POST /api/schematic-compiler/diff` | protected | ✅ load-bearing | guard |
| `POST /api/schematic-compiler/export` | protected | ✅ load-bearing | guard |
| `POST /api/schematic-compiler/graph/validate` | protected | ✅ load-bearing | guard |
| `POST /api/schematic-compiler/kicad/inspect` | protected | ✅ load-bearing | guard |
| `POST /api/schematic-compiler/layout` | protected | ✅ load-bearing | guard |
| `POST /api/schematic-compiler/problem` | protected | ✅ load-bearing | guard |
| `POST /api/schematic-compiler/propose` | protected | ✅ load-bearing | guard |
| `POST /api/schematic-compiler/transaction` | protected | ✅ load-bearing | guard |
| `POST /api/schematic-compiler/variants` | protected | ✅ load-bearing | guard |
| `POST /api/schematic/build-multi` | protected | ✅ load-bearing | guard |
| `POST /api/schematic/build` | protected | ✅ load-bearing | guard |
| `POST /api/schematic/cross-verify` | protected | ✅ load-bearing | guard |
| `POST /api/schematic/edit-build` | protected | ✅ load-bearing | guard |
| `POST /api/schematic/edit` | protected | ✅ load-bearing | guard |
| `POST /api/schematic/layout-critic` | protected | ✅ load-bearing | guard |
| `POST /api/schematic/review` | protected | ✅ load-bearing | guard |
| `POST /api/schematic` | protected | ✅ load-bearing | guard |
| `POST /api/simulate` | protected | ✅ load-bearing | guard |
| `POST /api/spice/ai` | protected | ✅ load-bearing | guard |
| `POST /api/spice/compile` | public | — | (policy: no auth) |
| `POST /api/spice/models/import` | protected | ✅ load-bearing | guard |
| `POST /api/spice/models/smoke-test` | protected | ✅ load-bearing | guard |
| `POST /api/spice/reports` | public | — | (policy: no auth) |
| `POST /api/spice/run-plans/estimate` | public | — | (policy: no auth) |
| `GET /api/spice/runs/[id]/bundle` | protected | ✅ load-bearing | guard |
| `GET /api/spice/runs/[id]/events` | protected | ✅ load-bearing | guard |
| `GET /api/spice/runs/[id]` | protected | ✅ load-bearing | guard |
| `DELETE /api/spice/runs/[id]` | protected | ✅ load-bearing | guard |
| `GET /api/spice/runs/[id]/waveforms` | protected | ✅ load-bearing | guard |
| `POST /api/spice/runs` | protected | ✅ load-bearing | guard |
| `GET /api/spice/runs` | protected | ✅ load-bearing | guard |

## §C — request-body consumption per route

| Route | Reader | Direct unbounded reads |
|---|---|---|
| `/api/ai/runtime` | — | ✅ none |
| `/api/architecture/alternatives` | bounded reader | ✅ none |
| `/api/architecture/candidates` | bounded reader | ✅ none |
| `/api/architecture/compare` | bounded reader | ✅ none |
| `/api/architecture/problem` | bounded reader | ✅ none |
| `/api/architecture/propose` | bounded reader | ✅ none |
| `/api/assignment-queue/materialize` | bounded reader | ✅ none |
| `/api/assignment-queue/revalidate` | — | ✅ none |
| `/api/assignment-queue` | — | ✅ none |
| `/api/auth/callback` | — | ✅ none |
| `/api/auth/signin` | bounded reader | ✅ none |
| `/api/auth/signout` | — | ✅ none |
| `/api/bom/cart/digikey` | bounded reader | ✅ none |
| `/api/bom/cart/lcsc` | bounded reader | ✅ none |
| `/api/bom/cart/mouser` | bounded reader | ✅ none |
| `/api/bom/diff` | bounded reader | ✅ none |
| `/api/bom/export-csv` | bounded reader | ✅ none |
| `/api/bom/notifications` | bounded reader | ✅ none |
| `/api/bom/procurement-packet` | bounded reader | ✅ none |
| `/api/bom` | bounded reader | ✅ none |
| `/api/bom/snapshot` | bounded reader | ✅ none |
| `/api/calculation/corners` | — | ✅ none |
| `/api/calculation/evaluate` | — | ✅ none |
| `/api/calculation/export` | — | ✅ none |
| `/api/calculation/feedback` | — | ✅ none |
| `/api/calculation/problem` | — | ✅ none |
| `/api/calculation/propose` | — | ✅ none |
| `/api/calculation/report` | — | ✅ none |
| `/api/calculation/transaction` | — | ✅ none |
| `/api/chat` | bounded stream | ✅ none |
| `/api/circuit-knowledge/applicability` | — | ✅ none |
| `/api/circuit-knowledge/compile` | — | ✅ none |
| `/api/circuit-knowledge/compose` | — | ✅ none |
| `/api/circuit-knowledge/problem` | — | ✅ none |
| `/api/circuit-knowledge/propose` | — | ✅ none |
| `/api/circuit-verification/problem` | — | ✅ none |
| `/api/circuit-verification/propose` | — | ✅ none |
| `/api/circuit-verification/readiness` | — | ✅ none |
| `/api/circuit-verification/run` | — | ✅ none |
| `/api/component-selection/alternative` | — | ✅ none |
| `/api/component-selection/catalog` | — | ✅ none |
| `/api/component-selection/evaluate` | — | ✅ none |
| `/api/component-selection/export` | — | ✅ none |
| `/api/component-selection/feedback` | — | ✅ none |
| `/api/component-selection/problem` | — | ✅ none |
| `/api/component-selection/propose` | — | ✅ none |
| `/api/component-selection/solve` | — | ✅ none |
| `/api/component-selection/sourcing` | — | ✅ none |
| `/api/component-selection/transaction` | — | ✅ none |
| `/api/components/atomic` | — | ✅ none |
| `/api/components/atomic/search` | bounded reader | ✅ none |
| `/api/constraints/explain` | bounded reader | ✅ none |
| `/api/constraints/preview` | bounded reader | ✅ none |
| `/api/engineering-effects` | — | ✅ none |
| `/api/export/kicad` | bounded reader | ✅ none |
| `/api/firmware-bringup/problem` | — | ✅ none |
| `/api/firmware-bringup/propose` | — | ✅ none |
| `/api/firmware-bringup/resources` | — | ✅ none |
| `/api/footprint-resolution` | — | ✅ none |
| `/api/full-flow/propose` | — | ✅ none |
| `/api/full-flow/run` | — | ✅ none |
| `/api/full-flow/transition` | — | ✅ none |
| `/api/interfaces/allocate` | bounded reader | ✅ none |
| `/api/interfaces/alternatives` | bounded reader | ✅ none |
| `/api/interfaces/candidates` | bounded reader | ✅ none |
| `/api/interfaces/compare` | bounded reader | ✅ none |
| `/api/interfaces/problem` | bounded reader | ✅ none |
| `/api/interfaces/propose` | bounded reader | ✅ none |
| `/api/kicad/v1/categories.json` | — | ✅ none |
| `/api/kicad/v1/parts/[id]` | — | ✅ none |
| `/api/kicad/v1/parts/category/[id]` | — | ✅ none |
| `/api/kicad/v1` | — | ✅ none |
| `/api/mapping-verification` | — | ✅ none |
| `/api/model-simulation/denominator` | — | ✅ none |
| `/api/model-simulation/execute` | — | ✅ none |
| `/api/model-simulation/measure` | — | ✅ none |
| `/api/model-simulation/problem` | — | ✅ none |
| `/api/model-simulation/propose` | — | ✅ none |
| `/api/model-simulation/readiness` | — | ✅ none |
| `/api/parts/[id]/alternates` | — | ✅ none |
| `/api/parts/[id]` | — | ✅ none |
| `/api/parts/categories` | — | ✅ none |
| `/api/parts/search` | bounded reader | ✅ none |
| `/api/passive-policy` | — | ✅ none |
| `/api/pcb-sync` | — | ✅ none |
| `/api/pcb/ai-rules/from-brief` | bounded reader | ✅ none |
| `/api/pcb/apply-authorization` | bounded reader | ✅ none |
| `/api/pcb/assign/suggest` | bounded reader | ✅ none |
| `/api/pcb/autoroute` | bounded reader | ✅ none |
| `/api/pcb/edit/assist` | bounded reader | ✅ none |
| `/api/pcb/export/gerbers` | bounded reader | ✅ none |
| `/api/pcb/export/kicad-pcb` | bounded reader | ✅ none |
| `/api/pcb/footprints/[id]` | — | ✅ none |
| `/api/pcb/footprints/resolve` | — | ✅ none |
| `/api/pcb/footprints/search` | — | ✅ none |
| `/api/pcb/placement/preview` | bounded reader | ✅ none |
| `/api/pcb/qualify` | — | ✅ none |
| `/api/pcb/release` | — | ✅ none |
| `/api/pcb/repair/agent` | bounded reader | ✅ none |
| `/api/physical-bindings` | — | ✅ none |
| `/api/power/alternatives` | bounded reader | ✅ none |
| `/api/power/candidates` | bounded reader | ✅ none |
| `/api/power/compare` | bounded reader | ✅ none |
| `/api/power/problem` | bounded reader | ✅ none |
| `/api/power/propose` | bounded reader | ✅ none |
| `/api/power/reconcile` | bounded reader | ✅ none |
| `/api/release-engineering/problem` | — | ✅ none |
| `/api/release-engineering/propose` | — | ✅ none |
| `/api/replacement-authority` | bounded stream | ✅ none |
| `/api/requirements/capabilities` | — | ✅ none |
| `/api/requirements/compile` | bounded reader | ✅ none |
| `/api/requirements/sources` | bounded reader | ✅ none |
| `/api/schematic-compiler/compare` | — | ✅ none |
| `/api/schematic-compiler/diff` | — | ✅ none |
| `/api/schematic-compiler/export` | — | ✅ none |
| `/api/schematic-compiler/graph/validate` | — | ✅ none |
| `/api/schematic-compiler/kicad/inspect` | — | ✅ none |
| `/api/schematic-compiler/layout` | — | ✅ none |
| `/api/schematic-compiler/problem` | — | ✅ none |
| `/api/schematic-compiler/propose` | — | ✅ none |
| `/api/schematic-compiler/transaction` | — | ✅ none |
| `/api/schematic-compiler/variants` | — | ✅ none |
| `/api/schematic/build-multi` | bounded reader | ✅ none |
| `/api/schematic/build` | bounded reader | ✅ none |
| `/api/schematic/cross-verify` | bounded reader | ✅ none |
| `/api/schematic/edit-build` | bounded reader | ✅ none |
| `/api/schematic/edit` | bounded reader | ✅ none |
| `/api/schematic/layout-critic` | bounded reader | ✅ none |
| `/api/schematic/review` | bounded reader | ✅ none |
| `/api/schematic` | bounded reader | ✅ none |
| `/api/simulate` | bounded reader | ✅ none |
| `/api/spice/ai` | bounded reader | ✅ none |
| `/api/spice/compile` | bounded reader | ✅ none |
| `/api/spice/models/import` | bounded reader | ✅ none |
| `/api/spice/models/smoke-test` | bounded reader | ✅ none |
| `/api/spice/reports` | bounded reader | ✅ none |
| `/api/spice/run-plans/estimate` | bounded reader | ✅ none |
| `/api/spice/runs/[id]/bundle` | — | ✅ none |
| `/api/spice/runs/[id]/events` | — | ✅ none |
| `/api/spice/runs/[id]` | — | ✅ none |
| `/api/spice/runs/[id]/waveforms` | — | ✅ none |
| `/api/spice/runs` | bounded reader | ✅ none |
