# B09.1 — Tool Catalog Reconciliation with B07/B08 Truth

| descriptor | obsolete B01-era claim | current truth (recorded at 1.1.0) |
|---|---|---|
| `sirkit.pcb.create-via` | "schema-only; the kernel binding exists but coverage is partial, executor refuses" | B08: canonical `create_via`/`update_via` operations with exact kernel inverses; INTERACTIVE canonical path via the route tool + inspector → `commitPcbCandidate`/`applyEditsCanonical` → CanonicalExecutor (one transaction, change-set audit, verified-replay undo). NO reusable agent/tool adapter exists → callability stays `not-callable`; agentExposed:false. Evidence: route-tool.commands.ts, operations.ts, pcb-commit-gateway.ts, B08 README. |
| `sirkit.pcb.zone-edit` | "partial coverage; not migrated in B03; no shared implementation" | B08 migrated EVERY zone surface (zone tool, plane dialog, inspector) onto the ONE commit gateway (`"pcb.zone"`) → board-delta compiler → CanonicalExecutor. Same interactive-canonical-only distinction; callability closed; agentExposed:false. |
| `sirkit.pcb.dimension` | "missing — no handler, no schema, no operation kind; lifecycle draft, internal-only" | B08 shipped dimensions end-to-end: native BoardDimension model, canonical add/update/remove ops with exact inverses, whole-board validation (INVALID_DIMENSION), three-click `useDimensionTool`, DimensionInspector, persistence + conditional revision participation. Lifecycle now `active`, discoverable; STILL no tool adapter (callability closed, agentExposed:false). |
| `sirkit.schematic.propose-tier1-edit` | evidence cited nonexistent `app/lib/agent/proposal-gateway.ts` | evidence corrected to `app/lib/agent/gateway.ts` (the real ProposalInvocationService module). |

Principles enforced: "canonical human/editor implementation exists" is
explicitly distinguished from "agent tool binding exists" in every
binding note; no dedicated callable tool adapter is claimed anywhere one
does not exist; every PCB mutation stays `agentExposed: false`.

Regenerated (byte-consistent, gated): B04 tool-registry.csv/json,
non-callable-coverage.csv, provider-schema-parity.json (v2),
B09 agent-exposed-tool-manifest.{csv,json}, tool-activation-audit.csv,
provider parity + replay-fixture pins. Exposed count: **8** (unchanged) —
pinned by the b04 exact-set tripwire.
