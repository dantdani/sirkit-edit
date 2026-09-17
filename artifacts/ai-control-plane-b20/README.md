# B20 — MCP consumption and Sirkit MCP exposure (`chapter/b20-mcp-adapter`)

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised),
**RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Base: `102dd27` (B19 merged normally in PR #9, 2026-09-17). Mission: add MCP as an **adapter** around Sirkit's existing
registry and command bus. MCP must never become a second authority system or a bypass around permissions, revision checks,
approvals, traces or validation.

References re-read at execution time (2026-09-17, recorded in `discovery.md` §1): the current MCP specification revision is
**2026-07-28** (stateless; `server/discover`; multi round-trip requests; no protocol sessions), the TypeScript SDK 1.30.0 and
the Anthropic (`mcp-client-2025-11-20`) and OpenAI (`type: "mcp"`) connectors speak the 2025-11-25 era.

| checkpoint | artifact | state |
|---|---|---|
| discovery | `discovery.md` (six read-only readers over the canonical registry and provider adapters, principal binding, the outbound boundary, the agent loop and exposure subset, tests and CI, and prior obligations) | INFERRED — to be confirmed by reproduction in the first increment |
| B20-A Sirkit consumes external MCP (read-only) | `mcp-client-boundary.md`, `mcp-server-registry.md` | planned |
| B20-B Sirkit exposes an MCP server | `mcp-exposure.md` | planned |
| B20-C discovery, schemas and parity | `mcp-parity.md` | planned |
| B20-D adversarial tests | `mcp-adversarial.md` | planned |
| validation | `test-and-validation-report.md`, `changed-files.md`, `unknowns-and-owner-decisions.md`, `final-verdict.md` | planned |

Program ledger: `artifacts/remaining-builder-program/`.
