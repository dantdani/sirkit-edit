# B14.1 — component-replacement approval and reauthorization boundary closure

Corrective stage over B14 after independent verification found four
security/evidence gaps. All four reproduced against the unmodified tree,
then closed permanently.

| # | Defect | Closure |
| --- | --- | --- |
| R1 | human approval not authenticated — a direct service call committed and stamped `approvalActor: "human:interactive"` unconditionally | the branded ONE-SHOT `ReplacementApprovalIntent` (module-private mint behind the review UI's Apply activation; bound to proposal/scope/lineage/head/expiry; burned on any tender; import-boundary gated) — [approval-capability-boundary.md](approval-capability-boundary.md) |
| R2 | reauthorization structurally forgeable — any `{fetchFreshFacts}` object, incl. an EXACT stale byte copy, committed with zero server contact | the branded ONE-SHOT `ReplacementReauthorizationChannel` (zero-parameter production factory over the platform same-origin fetch; consumed once inside the serialized gateway with nonce + bounded lifetime; test seam gated) — exact stale copies now refuse BEFORE `journal.prepare` and before canonical execution — [reauthorization-authenticity.md](reauthorization-authenticity.md) |
| R3 | the endpoint read `body.scope` while claiming authenticated server scope | honest local-only disposition: tenant/branch SERVER-DERIVED with 403 locator cross-checks (foreign values never reach the loader), projectId documented as an unauthenticated locator, UTF-8 byte bounds, corrected claims — [server-scope-disposition.md](server-scope-disposition.md) |
| R4 | the "fresh-browser capstone" bypassed the UI (direct service call + source-string page checks) | the production consumer/controller extracted so the shipped path IS the tested path, plus the permanent no-credit integration test: real chat POST → production consumer → rendered dialog → independent click → production reauthorization transport → ONE transaction → receipt/adoption/exact undo — [production-ui-integration.md](production-ui-integration.md) |

Evidence: [pre-edit-counterexamples.md](pre-edit-counterexamples.md) ·
[regression-evidence.md](regression-evidence.md) ·
[changed-files.md](changed-files.md) ·
[final-verdict.md](final-verdict.md)

Supersession notes were added to the four affected B14 documents; their
historical text is preserved unmodified.
