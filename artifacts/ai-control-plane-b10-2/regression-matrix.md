# B10.2 §D — regression matrix

All driven through production code paths (validator → assembler →
resource envelope → readiness; and the production chat route with a
controlled provider adapter). No source-scan-only or helper-only proofs.

| # | Required proof | Test |
| --- | --- | --- |
| 1 | Empty projection vs non-empty physical schematic cannot seal | b10-2 §A R1 (`proveAgentNetlist` false; `context.netlist` null; no `netlist` envelope in the bundle) |
| 2 | It cannot produce authoritative-netlist/pass readiness | b10-2 §A R1 (parity `source: "unavailable"`, state unknown — via gateway readiness) |
| 3 | Omitted physical components refuse/withhold | b10-2 §A (WIRED minus r2 → proof false) |
| 4 | Added simulation-only components refuse | b10-2 §A (voltage-source AND ground projections refuse — production physicality rule) |
| 5 | Resistor pin 999 refuses | b10-2 §A R2 (validator "theory pin contract" + proof false) |
| 6 | Altered theory pin names refuse | b10-2 §A R2 (`name: "anode"` on pin 1 refuses) |
| 7 | Rewritten net topology refuses | b10-2 §A (node dropped from the wired net → proof false) |
| 8 | Valid exact theory-only projection succeeds | b10-2 §A (derivation proves; sealed content EQUALS the server-owned proof content) |
| 9 | Valid theory netlist + empty board → real missing-component parity failure | b10-2 §A (parity `authoritative-netlist`/`fail`, `missingComponents: ["r1","r2"]`) |
| 10 | KiCad-bearing schematic with no trusted resolver withholds explicitly | b10-2 §A (proof reason + assembly warning "pin authority is unavailable"; parity unavailable/unknown) |
| 11 | Missing selection.primary → 400 | b10-2 §B (plus malformed-primary 400; null/valid-ref 200) |
| 12 | Never-settling/rejecting/throwing cancel cannot delay the 413 or leak rejections | b10-2 §C (three hostile behaviors; zero unhandledRejection events) |
| 13 | StrictMode, project-switch, lifecycle-adoption, unsaved-board capture stay green | b10-1-strict-mode-publisher (4/4) + b10-editor-context (17/17) + b10-1-request-boundary (10/10) + b10-chat-boundary (6/6) in the same battery |

Plus: all valid-netlist fixtures across B10/B10.1 suites and the matrix
generator are now DERIVED via `projectAgentNetlist(buildNetlist(...))` —
the derivation itself is the only source of "valid".
