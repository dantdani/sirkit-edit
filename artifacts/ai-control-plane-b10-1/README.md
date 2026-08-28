# B10.1 — Browser Reachability, Lifecycle Ownership, and Request/Netlist Boundary Closure

Corrective stage over B10 (implemented but not independently accepted).
Five confirmed counterexamples (R1–R5) were reproduced pre-edit, closed in
production code with the B10 architecture preserved, and made permanent
regressions.

## Documents

| Document | Content |
| --- | --- |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | Exact R1–R5 pre-edit evidence |
| [strict-mode-lifecycle-results.md](strict-mode-lifecycle-results.md) | §A production publisher ownership after the fix |
| [nested-request-boundary-results.md](nested-request-boundary-results.md) | §B exact nested request contract |
| [bounded-body-reader-results.md](bounded-body-reader-results.md) | §C streaming limit + consumed-byte evidence |
| [authority-neutral-netlist-contract.md](authority-neutral-netlist-contract.md) | §D projection schema + semantic checks |
| [validation-summary.md](validation-summary.md) | Full battery counts, UNKNOWNs, verdict |

## Invariants after B10.1

- The production publisher survives React Strict Mode: liveness is
  EFFECT-LOCAL (reset on every setup, retired by that setup's cleanup) and
  composed with a captured `PcbBoardLifecycleScope`; registration lives in
  the extracted production hook `useEditorContextPublisher` mounted by
  PcbEditor and proven under `<StrictMode>` with a real bridge and a real
  lifecycle owner. Adoption invalidates immediately and the replacement
  generation republishes; hidden tabs keep publishing; demo never
  publishes; the page bridge carries no unmount-invalidate cleanup for a
  replay to strand.
- Every nested request control object is EXACT-KEYED: `scope`,
  `editorContext.scope`, each message, and `selection` refuse unknown keys,
  with authority-shaped keys (actor, role, capabilities, authority,
  approvals, release, durable-board, idempotency) refused BY NAME — never
  silently ignored. The complete editor-context contract is required when
  present, and the client `pcbRevisionId` hint is recomputed server-side:
  a mismatch fails closed as a corrupt/non-atomic context.
- The request limit is a READING limit: `readBoundedBody` consumes the
  body incrementally, cancels the reader the moment the ceiling is
  crossed, and only then decodes (fatal UTF-8) and parses. A hostile
  oversized body is never fully buffered (proven with a counting
  ReadableStream).
- The netlist resource is the AUTHORITY-NEUTRAL projection
  `sirkit.agent-netlist-projection.v1`: the browser projects the live
  netlist down to logical intent before transport; the server validates
  the same exact contract AGAINST THE VERIFIED SCHEMATIC (component
  membership, display-ref agreement, node/pin discipline, exact endpoint
  agreement, no cross-net endpoints, no duplicates, bounded) and refuses
  unknown/authority-shaped fields by name. Board/netlist disagreement
  stays a readiness diagnosis. The resource remains local-working-copy,
  optional, schematic+revision-pinned, never component or release
  authority.
- `npx tsc --noEmit` is genuinely clean (the two B10 test-file errors are
  fixed).

Static exposure stays NINE tools; no mutation, release, MCP,
multi-agent, or automatic-apply surface was added. B11 was not started.
