# B11.7 — pre-edit counterexamples (R1–R2)

Both reproductions were run against **production code, before any B11.7
edit**, through a transient probe
(`app/lib/agent/__tests__/_tmp-b117-repro.test.ts`, deleted after capture).

---

## R1 — non-JSON primitives bypass capture

For each of `undefined`, `Symbol("synthetic")`, `1n`, `NaN`, `Infinity`:

```json
{"input":"undefined","capturePlainJson refuses":true,"projectBoardForReplay.ok":true,"projectCapturedBoard.ok":true,"projectReplayContext.ok":true,"invalid primitive present in value":true,"JSON.stringify(board result)":"{\"ok\":true,\"issues\":[\"board: must be a plain object\"]}"}
{"input":"Symbol(\"synthetic\")","capturePlainJson refuses":true,"projectBoardForReplay.ok":true,"projectCapturedBoard.ok":true,"projectReplayContext.ok":true,"invalid primitive present in value":true,"JSON.stringify(board result)":"{\"ok\":true,\"issues\":[\"board: must be a plain object\"]}"}
{"input":"1n","capturePlainJson refuses":true,"projectBoardForReplay.ok":true,"projectCapturedBoard.ok":true,"projectReplayContext.ok":true,"invalid primitive present in value":true,"JSON.stringify(board result)":"THREW TypeError: Do not know how to serialize a BigInt"}
{"input":"NaN","capturePlainJson refuses":true,"projectBoardForReplay.ok":true,"projectCapturedBoard.ok":true,"projectReplayContext.ok":true,"invalid primitive present in value":true,"JSON.stringify(board result)":"{\"ok\":true,\"value\":null,\"issues\":[\"board: must be a plain object\"]}"}
{"input":"Infinity","capturePlainJson refuses":true,"projectBoardForReplay.ok":true,"projectCapturedBoard.ok":true,"projectReplayContext.ok":true,"invalid primitive present in value":true,"JSON.stringify(board result)":"{\"ok\":true,\"value\":null,\"issues\":[\"board: must be a plain object\"]}"}
```

Every row shows the same disagreement: **capture refuses; every projection
reports `ok: true` with the refused primitive in `value`.** The serialization
column shows all four failure modes the verifier named:

* **BigInt** — `JSON.stringify(result)` **throws**
  (`TypeError: Do not know how to serialize a BigInt`);
* **NaN / Infinity** — silently serialize as `"value":null` — a meaning
  change;
* **undefined / Symbol** — the `value` property **disappears** from the
  serialized result entirely (visible above: `{"ok":true,"issues":[…]}` with
  no `value` key).

And for valid-JSON primitive roots through the context projector:

```json
{"projectReplayContext(\"x\")":{"ok":true,"issues":[]},"projectReplayContext(null)":{"ok":true,"issues":[]}}
```

`ok: true` with an **empty issue list** for values that are not context
objects at all.

**Root cause.** B11.6's entry guard was
`isOwnedCapture(raw) || raw === null || (typeof raw !== "object" && typeof raw !== "function")`
— non-object primitives skipped capture and went straight to the walker, and
`projectCapturedContextValue` returned `{ value: raw, issues: [] }` for any
non-record.

## R2 — `isCapturedRecord` is an unsound type guard

```json
{
  "isCapturedRecord({})": true,
  "isCapturedRecord(Object.freeze({}))": true,
  "isCapturedRecord(new Date())": true,
  "isCapturedRecord(new Proxy({}, {}))": true,
  "isCapturedRecord(captured object)": true,
  "isCapturedRecord(captured array)": false,
  "isCapturedRecord(revoked proxy)": false,
  "revoked proxy threw": false
}
```

None of `{}`, a frozen `{}`, a `Date`, or a benign proxy was produced by
`capturePlainJson`, yet the exported predicate claimed
`value is Record<string, PlainJsonValue>` for all four. (The captured-object /
captured-array / revoked-proxy rows behaved correctly already.)

**Root cause.** The runtime test was "any non-array object" — far weaker than
the TypeScript claim, even though the unforgeable ownership registry needed to
make it truthful had existed since B11.6.

---

## Closures

| # | Closure |
| --- | --- |
| R1 | §A the primitive fast path is REMOVED: the only capture bypass is registry-proven ownership, so every foreign value — primitive or not — goes through `capturePlainJson` first. Non-JSON primitives now refuse (`ok: false`, bounded deterministic capture issues); valid-JSON primitive roots capture and receive the deterministic structural issue `must be a plain object` |
| R2 | §B `isCapturedRecord` requires ownership-registry membership before the array check — the runtime test now matches the TypeScript claim |
