# B11.5 — pre-edit counterexamples (R1–R3)

All three reproductions were run against **production code, before any B11.5
edit**, through a transient probe
(`app/lib/agent/__tests__/_tmp-b115-repro.test.ts`, deleted after capture).
Synthetic markers only — no real credential was used or printed.

---

## R1 — `__proto__` data loss and prototype injection

`captureObject` built its destination as `{}` and installed keys with
`captured[key] = child`. Ordinary assignment to `__proto__` invokes the legacy
`Object.prototype.__proto__` **setter**, which never creates an own property.

### Unit level

```json
{
  "case 1 — numeric __proto__": {
    "source has own __proto__": true,
    "source own value": 42,
    "capture ok": true,
    "snapshot has own __proto__": false,
    "snapshot JSON": "{\"keep\":1}"
  },
  "case 2 — object __proto__": {
    "capture ok": true,
    "snapshot has own __proto__": false,
    "snapshot prototype is Object.prototype": false,
    "snapshot prototype IS the injected object": "{\"injected\":true}",
    "snapshot JSON": "{\"keep\":1}"
  }
}
```

* **Case 1** — the accepted own key was **silently discarded**: the setter
  ignores a non-object value, so no own property was created and `ok: true` was
  still reported.
* **Case 2** — the setter **replaced the snapshot's prototype** with the
  attacker-supplied object, and the key was still absent from the data.

### Through production context validation

A valid board whose `footprint.padNets` (`Record<string, number>`) carries an
own enumerable `"__proto__": 42`:

```json
{
  "source padNets own __proto__": true,
  "validateBoardShape issues": [],
  "validateBoardShape empty (Record<string, number> permits the key)": true,
  "validateReplayContext ok": true,
  "captured padNets has own __proto__": false,
  "captured padNets JSON": "{\"1\":1}",
  "SILENTLY DISCARDED": true
}
```

The authoritative type graph **permits** the key — `Record<string, number>`
admits any string key with a numeric value — and `validateBoardShape` correctly
reported no issues. The context was accepted, and the accepted field vanished
from the snapshot. That directly contradicts the documented projection
invariant that *no accepted field is silently discarded*.

---

## R2 — diagnostic credential leakage

A synthetic marker embedded in an untrusted **key name**, with a value that
causes capture to refuse:

```json
{
  "capturePlainJson issues": [
    "capsule.apiKey=sk-live-B115SYNTHETIC0000: a function is not JSON data (it is never invoked)"
  ],
  "marker in capture issues": true,
  "validateReplayCapsule issues": [
    "capsule.apiKey=sk-live-B115SYNTHETIC0000: a function is not JSON data (it is never invoked)"
  ],
  "marker in capsule issues": true,
  "ReplayCapsuleInvalidError.message": "REPLAY_CAPSULE_INVALID: capsule.apiKey=sk-live-B115SYNTHETIC0000: a function is not JSON data (it is never invoked)",
  "marker in thrown message": true
}
```

**Root cause.** `plain-capture.ts` carried its own `safeKeyName`:

```ts
function safeKeyName(key: string): string {
  return key.replace(/[^\x20-\x7e]/g, "?").slice(0, 60);
}
```

It stripped non-ASCII characters and truncated — it did **not** redact. The
shared classifier (`isCredentialShapedName`, `containsSecretShapedText`) lived
in `trace.ts`, which `plain-capture.ts` sits below in the import graph, so the
capture layer had grown a second, weaker rule.

---

## R3 — stateful proxy still throws

`findNonPlainJsonPath` guarded one preliminary `Reflect.ownKeys` and then
re-enumerated with **unguarded** `Object.getOwnPropertySymbols` /
`Object.getOwnPropertyNames`, and read values through `Object.entries` (which
performs ordinary property reads, invoking `get` traps).

```json
{
  "findNonPlainJsonPath(stateful ownKeys)":         { "THREW": "Error: stateful ownKeys" },
  "findNonPlainJsonPath(stateful getPrototypeOf)":  { "THREW": "Error: stateful getPrototypeOf" },
  "findNonPlainJsonPath(stateful gOPD)":            { "THREW": "Error: stateful gOPD" },
  "findNonPlainJsonPath(stateful get/length)":      { "THREW": "Error: stateful get/length" },
  "findNonPlainJsonPath(nested stateful)":          { "THREW": "Error: stateful ownKeys" }
}
```

Five for five. The other boundaries already refused — they capture once and
inspect only the snapshot — which is precisely the shape of the correct fix.

**The principle the failure violates:** a proxy must not be considered safe
because one preliminary trap invocation succeeded. Trap behaviour can change
between calls.

---

## Closures

| # | Closure |
| --- | --- |
| R1 | §A capture installs every accepted own key with `Object.defineProperty` onto a null-prototype destination, then restores `Object.prototype`. `pick` in `replay-context.ts` and the descriptor-driven projector do the same. |
| R2 | §B one dependency-neutral redaction authority (`app/lib/agent/redaction.ts`), shared by capture, trace, capsule, context, and the projector; credential-shaped path segments collapse to `[redacted-key]`. |
| R3 | §C `findNonPlainJsonPath` delegates to `scanPlainJson` — the identical guarded walk `capturePlainJson` uses; `findSecretShapedPath` reads through guarded descriptors instead of `Object.entries`. |
