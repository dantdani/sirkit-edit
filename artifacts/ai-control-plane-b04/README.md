# B04 — Provider-Neutral Tool Registry and Contextual Discovery

Truthful tool metadata and discovery ONLY. B04 activates no agent execution,
connects nothing to chat, migrates no additional editor mutations, changes no
providers/prompts/routing, and exposes **zero** tools to agents.

## What exists now

- **Versioned tool contract** (`app/lib/engineering/tool-registry.ts`):
  `ToolDescriptor` with explicit enums for lifecycle, operation class, side
  effects, binding status, discovery, callability, idempotency, audit, and
  budget class, plus capability/role/approval/project-state/selection/
  authority/revision/lineage requirements, JSON input/output schemas,
  timeout metadata, validation/verification strategies, deprecation and
  evidence fields. Validation fails closed: missing security metadata is an
  error; `callable` requires a named binding; agent-exposed mutation
  capability is structurally rejected.
- **Canonical registry API** (`ToolRegistry`): registration with duplicate
  id/version detection, lookup by id/version and by B01 command, category and
  lifecycle listings, binding inspection (structured `not_callable`, never
  silent success), deterministic digest, provider-neutral schema rendering,
  and a coverage report that also names the mutation-capable B01 commands NOT
  yet represented as tools. The registry references B01 command ids as its
  action authority — it does not duplicate the inventory, import UI/routes,
  or depend on the executor at runtime.
- **Catalog** (`tool-catalog.ts`): 26 descriptors — 18 callable (proven
  reusable implementations only: PCBToolService, runDrc,
  computeElectricalTruth, selection-queries, parts-search, physical-binding
  service, readiness evaluate, placement engine, routing service, repair
  planner, revision functions, plus the 6 B03 canonical-mutation commands
  bound to the editor session), 8 not-callable (schematic accessor gap,
  release, 2 view/session controls, schema-only via/zone, UI-only schematic
  add, missing dimensions). 0 agent-exposed.
- **Discovery engine** (`tool-discovery.ts`): pure, deterministic,
  deny-by-default, with 20 explicit exclusion reason codes, stable ordering,
  deterministic budgeting, and discovery/context digests. See
  `tool-discovery-policy.md`.
- **Provider adapters** (`tool-provider-adapters.ts`): pure OpenAI/Anthropic
  schema renderers with no SDK imports, no calls, no execution, no chat
  wiring. Parity is proven by fixture tests and rendered to
  `provider-schema-parity.json` (all 26 tools semantically equivalent;
  documented differences: name character mapping, registry-only output
  schemas, omitted OpenAI strict mode).

## Generated artifacts (CI byte-matched)

Regenerate with `npx tsx scripts/generate-tool-registry-artifacts.ts`:
`tool-registry.csv`, `non-callable-coverage.csv`,
`provider-schema-parity.json`. The B04 test suite fails if committed
artifacts drift from the registry rendering, and re-asserts B01 matrix
byte-consistency.

## Verification

`npx vitest run app/lib/engineering/__tests__/b04-tool-registry.test.ts` —
30 tests over the required matrix. Full engineering suite (B01 gates, B02
kernel, B03 adapter, B03.1 hardening, B03.2 boundary, B04): 135/135.
