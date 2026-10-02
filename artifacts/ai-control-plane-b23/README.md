# B23 — External manufacturing, DFM, quoting and procurement boundaries (`chapter/b23-external-manufacturing`)

Labels: **CONFIRMED** (executed and measured, or read at the cited file:line), **INFERRED** (code reading), **PROPOSED** (designed, not
exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Base: `43cb1b0` (B22 merged normally in PR #13, verdict PARTIAL). Mission (runbook `:946-1019`): connect verified release artifacts to
external manufacturing and supply-chain services under explicit Tier 3 human authority, beginning with read-only capability, quote and
DFM operations; never allow an agent or a single ambiguous click to order hardware or spend money.

| checkpoint | artifact | state |
|---|---|---|
| discovery | `discovery.md` (seven read-only readers, one synthesizer; D23-1..21, OD-160..OD-180; re-verified on the B22-complete tree `849a933` by eight verifiers, section 9) | RECORDED; expected verdict PARTIAL (no provider account; ordering visibly disabled; physical evidence defined, none exists) |
| B23-A1 the provider registry with reviewed descriptors (D23-1, D23-2, D23-18 mapping, D23-19 code half, D23-20; OD-161, OD-162, OD-179, OD-180, OD-181) | `provider-registry.md`, `provider-registry.csv`; code `app/lib/manufacturing-providers/provider-registry.ts`, `provider-admission.ts`, `cd12-projection.ts`, `scripts/generate-b23-provider-registry.ts`; suites `app/lib/manufacturing-providers/__tests__/b23-a-provider-registry.test.ts` (94 tests), `b23-a-provider-admission.test.ts` (11); CI: `CHAPTERS` + `b23-`, one workflow directory filter | CONFIRMED offline. Test-first: both suites failed to load on `3806cba`, then 55 green. An adversarial review's 8 confirmed findings were each reproduced first: 9 red of 104 on the unfixed source, and seven deliberate breakages caught, each restored by hash. Then fixed; 104 green. [B23-A1 lead, 2026-10-02] the check's three low issues fixed test-first (admission case 11 calls the structural layer directly, two reverted conditions each fail it; registry case 5 refuses a quoted word as a page name; the byte-gate prose no longer claims two unrendered fields): 105 green. Every provider fact is RECORDED from discovery section 1.2 (2026-10-01) and was not re-read (OD-181). No provider was contacted. Live exchange and ordering are BLOCKED-LIVE-QUALIFICATION (LB-11, LB-12). |
