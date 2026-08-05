# B04 — Tool Discovery Policy

Authoritative code: `app/lib/engineering/tool-discovery.ts` (engine),
`app/lib/engineering/tool-registry.ts` (descriptors + validation),
`app/lib/engineering/tool-catalog.ts` (the classified catalog).

## State model (strictly distinguished)

| State | Meaning | Where decided |
|---|---|---|
| Registered | A descriptor exists | tool-catalog.ts |
| Discoverable | Eligible to be listed in the CURRENT context | tool-discovery.ts |
| Callable | A real, named, reusable implementation binding exists | descriptor.binding (validated) |
| Executable | Policy permits this actor/session to invoke it NOW | executor/adapter policy — never B04 |
| Mutation-capable | Can change authoritative engineering state | operationClass ∈ mutate/destructive/release |
| Agent-exposed | A provider-facing agent is actually allowed to call it | descriptor.agentExposed — **0 tools in B04** |

A declared schema is NOT executable coverage; a B01 record is NOT a tool; a
B02 executor binding is NOT agent exposure. Registry validation fails closed:
missing security metadata is an error, `callable` without a binding is an
error, and agent-exposed mutation capability is structurally impossible.

## Discovery pipeline (deterministic, pure, deny-by-default)

Callers assemble a `DiscoveryContext` explicitly — the engine never queries
providers, databases, browsers, or editor state, and the context carries NO
secrets, keys, or tokens. Context fields: tenant/project/branch, actor id +
role, granted capabilities, channel class (interactive-ui | assistant-agent |
automation | api), current canonical revision digest, lineage id, current
editor, selected object kinds, project lifecycle state, available authority
sources, provider capabilities (JSON-schema support, name length, tool
count), risk ceiling, available approval tiers, feature flags, requested
categories, optional schema-byte budget.

Filter order (each exclusion is recorded with an explicit reason code):

1. lifecycle (`active` only) → `lifecycle`
2. internal-only tools → `internal_only` (see visibility rule below)
3. channel: agents/automation require `agentExposed` → `not_agent_exposed`
4. actor role → `role_not_permitted`; capability → `capability_missing`
5. revision requirement → `revision_required`; lineage → `lineage_required`
6. editor family → `editor_mismatch`; selection kinds →
   `selection_kind_missing`; project state → `project_state_missing`;
   authority sources → `authority_missing`
7. implementation binding → `not_callable`
8. approval availability → `approval_unavailable`; risk ceiling →
   `risk_ceiling` (unknown ceiling values fall closed to read-only)
9. provider capabilities → `provider_schema_unsupported`,
   `provider_name_length`, `provider_tool_count`
10. feature flags → `feature_flag_disabled`
11. requested categories → `category_not_requested`
12. deterministic schema-byte budget → `budget_exceeded`
13. stable ordering (category, tool id, version)
14. deterministic discovery digest + context digest

## Visibility rule (no internal leakage)

Exclusion diagnostics for `internal-only` tools (canonical undo/redo,
manufacturing release, UI-only schematic actions, missing capabilities) are
reported ONLY on the interactive-ui channel. Agent, automation, and api
channels never learn those tools exist — not even as exclusions.

## Channel outcomes today

- `interactive-ui`: read/proposal tools plus the migrated B03 mutation slice
  (subject to role/capability/selection/approval/risk filters).
- `assistant-agent` / `automation`: **empty** — no descriptor is
  agent-exposed in B04, truthfully reflecting that no agent runtime is
  connected to this registry.
- `api`: read/proposal tools only (mutations require the interactive
  session's lineage and approval context).
