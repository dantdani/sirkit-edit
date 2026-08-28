# B16.0.17.2 — Final verdict (stop condition, item by item)

| Stop-condition item | Verdict | Evidence |
|---|---|---|
| no semantic-ID length limit independently hard-coded | **MET** | node-parameterized validator; source-scan gate proves no schema limit ≥ 32 appears as a literal ([schema-validator-parity.md](schema-validator-parity.md)) |
| schema and validator agree at 4,096/4,097 | **MET** | boundary tests on BOTH id arrays, values read from the schema nodes |
| both adapters preserve nested maxLength | **MET** | reference-identical schema in both SDK payloads; strict:true; forced toolChoice ([provider-adapter-schema-parity.md](provider-adapter-schema-parity.md)) |
| all B16.0.17 + B16.0.17.1 tests remain green | **MET** | corrected parity 82/82, adversarial 19/19, gates + routes + domain — 190 combined |
| inventory remains 91/3/59 | **MET** | re-measured; matrix byte-IDENTICAL (`cd4aaee0…`) |
| tool exposure remains 12 | **MET** | gates green |
| full suite exits 0 | **MET** | **4004 passed / 0 failed / exit 0** ([test-and-validation-report.md](test-and-validation-report.md)) |
| artifacts truthfully supersede the overstated claim | **MET** | supersession notes appended to the four B16.0.17.1 documents; history preserved ([superseded-claims.md](superseded-claims.md)) |
| protected original untouched | **MET** | `C:\Users\robsa\sirkit` unchanged |

## The defect, honestly stated

B16.0.17.1's "one source of truth" claim was overstated: two id-item length
limits were hard-coded in the validator while the declared schema carried no
`maxLength`, so the provider-facing and local contracts disagreed. This stage
reproduced the drift verbatim, moved the limit into the schema, made the
validator read the nodes, and added executable parity + adapter gates so the
claim is now enforced rather than asserted.

## Verdict

**B16.0.17.2 is COMPLETE under its stop condition.** Stopping. B16.0.18 and
B16.1 NOT started; awaiting independent verification.
