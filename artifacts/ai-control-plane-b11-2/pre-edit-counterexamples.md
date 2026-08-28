# B11.2 — pre-edit counterexamples (R1–R6)

All six reproductions were run against **production code, before any B11.2
edit**, through a transient probe (`app/lib/agent/__tests__/_tmp-b112-repro.test.ts`,
deleted after capture). Every credential-shaped value below is a **synthetic
placeholder**; no real credential was used, and no resource-exhaustion
condition was created (R6 used a safe 50 000-entry array).

Each counterexample is now a permanent regression in
`app/lib/agent/__tests__/b11-2-replay-context.test.ts` — see
[regression-matrix.md](regression-matrix.md).

---

## R1 — an unknown fixture field validated AND executed

Probe: attach an innocent unknown field to a committed capsule's board and
run the real replay engine.

```
R1 issues: []
R1 executed ok: true | events: 8 | tools: 8
```

`validateReplayCapsule` reported **zero** issues, and the capsule ran the
full control plane. The field was carried verbatim into
`canonicalState.pcb` and therefore into the sealed read-resource envelope
the agent reads. B11's "opaque fixture" validation checked forbidden field
NAMES only — it never checked whether a field was **known**.

**Root cause.** `scanOpaqueFixture` was a denylist over key names with no
positive contract. `capsule.context` had no schema, no version, and no
parser; `assembleAgentRunContext` stores a supplied board wholesale, so
anything that survives the denylist reaches canonical state.

**Closure.** §A — `sirkit.agent-replay-context.v1`: a versioned contract
with one shared producer and one shared consumer, key-exhaustive validation
through the existing canonical authorities, and a projection round-trip that
refuses anything the producer would discard.

---

## R2 — compound credential key names bypassed the capsule denylist

Probe: attach each name to a fixture with an **object** value.

```
R2 names ACCEPTED: ["clientSecret","refreshToken","providerClient","rawSdkPayload"]
```

All four passed. `FORBIDDEN_CAPSULE_STEMS` listed `accesstoken` but not
`refreshtoken`, `clientsecret`, `providerclient`, or `rawsdkpayload`, and
the folded-exact set did not contain them either.

**Root cause.** Two independent, hand-maintained denylists (capsule and
trace) that had already drifted apart.

**Closure.** §B — one shared classifier, `isCredentialShapedName`, folded on
case and separators, covering compound credential/token/secret/client/SDK/
provider-body/continuation/reasoning/raw-payload stems. `isForbiddenCapsuleKey`
now delegates to it, so the two boundaries cannot drift again.

---

## R3 — credential-shaped JSON inside a capsule string bypassed the scan

Probe: embed `{"apiKey":"sk-live-…"}` in a tool call's `argumentsText`.

```
R3 issues: []
R3 serialized form contains escaped quotes: true
```

**Root cause.** The whole-capsule scan ran on `JSON.stringify(capsule)`.
Serialization escapes the nested quotes (`{\"apiKey\":\"…\"}`), so every
quoted-credential pattern missed. The ORIGINAL string was never scanned.

**Closure.** §B — `findSecretShapedPath` walks the value **before**
serialization, inspecting every key name and every original string value.
The serialized scan is kept as an independent second net.

---

## R4 — the same escaped-JSON bypass in the trace validator

Probe: place the same payload in a trace's `model` field.

```
R4 issues: []
```

**Root cause.** Identical: `validateAgentRunTrace` scanned only
`JSON.stringify(trace)`.

**Closure.** §C — the direct recursive scan is applied to the whole trace
document (model, identity, statuses, verification, proposal identifiers,
event fields, warnings, diagnostics), before serialization.

---

## R5 — public recorder methods threw on hostile input

Probe: six hostile inputs against a live recorder.

```
"recordWarning(hostile toString)":     "THREW: hostile toString"
"recordStep(null)":                    "THREW: Cannot read properties of null (reading "
"recordStep(hostile usage accessor)":  "THREW: hostile usage"
"recordTool(null)":                    "THREW: Cannot read properties of null (reading "
"recordTool(hostile proposal accessor)": "THREW: hostile proposal"
"recordStep(hostile model accessor)":  "THREW: hostile accessor"
```

B11.1 claimed "Recording is TOTAL: no recorder method throws". The claim was
true for the inputs B11.1 tested (bad tokens, oversized ids, cyclic
payloads) and false for malformed OUTER values and hostile accessors.

**Root cause.** Normalization began *after* the fields were read:
`step.model`, `step.usage`, `input.proposal?.…` are property reads on an
unvalidated object. `recordWarning` additionally called `String(message)`,
which invokes a hostile `toString`.

**Closure.** §D — every public method runs inside `total()`, every field is
read through `safeRead()`, non-string warnings are refused rather than
coerced, `finalize` has no throwing path, and only closed-vocabulary
diagnostics are added.

---

## R6 — `recorderDiagnostics` was scanned without a length bound

Probe (safe test size — 50 000 entries, no resource-exhaustion condition):

```
R6 scanned 50000 entries in 11 ms with NO length bound
R6 issues: ["trace.recorderDiagnostics: outside the closed vocabulary"]
```

The validator ran `Array.prototype.some` over all 50 000 entries **and**
constructed a 50 000-element `Set` before reporting anything.

**Root cause.** `TRACE_BOUNDS` bounded ids, model, digests, warnings, and
events — but not `recorderDiagnostics`, and not the total serialized
document.

**Closure.** §E — `maxRecorderDiagnostics` is checked **before** any scan or
`Set` construction; `maxSerializedChars`, `maxScanNodes`, and `maxScanDepth`
bound total document size and traversal work; validator output stays bounded
at `maxValidationIssues`.
