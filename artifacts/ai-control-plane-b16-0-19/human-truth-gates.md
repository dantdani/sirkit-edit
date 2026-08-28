# B16.0.19 §G — Human-truth gates (CONFIRMED)

Permanent assertions in
[`b16-0-19-circuit-confinement-gate.test.ts`](../../app/lib/auth/__tests__/b16-0-19-circuit-confinement-gate.test.ts):

| Assertion | Status |
|---|---|
| extracted knowledge is not approved knowledge | CONFIRMED — quarantine literals (`confidence: "low"`, `authorityAssessment: "unknown"`) |
| proposed recipe claim is not published authority | CONFIRMED — `publicationEligible: false` + `proposal_only` |
| applicability is not verification | CONFIRMED — applicability routes carry no verification claim; verification lives only in the CD-9 chain |
| oracle result is not a waiver | CONFIRMED — no waiver surface anywhere (code-only scan) |
| remediation proposal cannot alter findings | CONFIRMED — null mutation channels + byte-unchanged run |
| readiness is not safety certification / ERC signoff / PCB or manufacturing release | CONFIRMED — gate scans + internal-only release descriptor |
| no circuit route agent-exposed; tools EXACTLY 12 | CONFIRMED |
| manufacturing release internal-only & not-callable | CONFIRMED |
