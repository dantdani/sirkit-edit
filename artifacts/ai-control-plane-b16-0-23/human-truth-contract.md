# B16.0.23 §I — human-truth contract (permanently gated)

The SPICE surfaces keep every rung of the truth ladder distinct. Enforced by
§A pins + the confinement gate, all inside the passing 4457-test suite.

| claim boundary | how it stays honest |
|---|---|
| **compiled ≠ simulated** | the compile 200 carries `readiness`/`netlist`/`irSummary` but NO `run` and NO simulation `status` (pinned) |
| **simulated ≠ physically verified** | run records carry an execution `status`; nothing in any route labels a completed run as physical/electrical verification (gate: no signoff/certification/manufacturing-release wording) |
| **smoke-tested ≠ approved model** | a smoke pass reaches only `"smoke-tested"`; `"trusted"`/`"curve-validated"` are unreachable through import or smoke-test; an already-trusted model is never downgraded and a fresh pass never over-upgrades (pinned) |
| **converged ≠ electrically correct** | measurements/specifications are proposal operations requiring review; the estimator/compiler never assert correctness |
| **report generated ≠ engineering signoff** | reports render exactly the supplied evidence into a downloadable document; no certification object, no signoff wording (pinned + gate) |
| **run completed ≠ product readiness** | run status is an execution outcome; no route emits a readiness/release verdict |
| **no SPICE result = manufacturing release** | gate: no spice route contains signoff/certification/manufacturing-release strings |
| **no AI proposal = an executed simulation** | `run_simulation` only RECORDS a `request-run` proposal; the job store stays empty through the exchange (pinned); AI cannot create/run/cancel/delete/certify/approve |

These are permanent: the confinement gate fails CI if any spice route gains
release/certification wording, if the AI route gains a job-store import, or if
the smoke-test status ladder is widened.
