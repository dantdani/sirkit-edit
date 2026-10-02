# B16.0.24 §G — /api/simulate input confinement

Caller input controls NONE of the process configuration, and directive
injection fails closed before spawning.

## Caller input cannot control

| surface | how it stays server-owned |
|---|---|
| executable | `NGSPICE_EXECUTABLE` module constant [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): the install the server settings pin, digest-checked before every run (B22-A3)] |
| arguments | fixed `["-b", netlistPath]` [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): the profile's -b -n deck.cir (B22-A3)] |
| shell | `shell: false` (explicit) |
| working directory | per-request `mkdtemp` isolated dir [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): the diagnostic runner's per-run directory, with no isolation boundary (B22-A3)] |
| environment | `safeEnvironment()` allowlist [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): the profile's exact map (B22-A3; Node's eight win32 additions recorded, OD-156)] |
| output paths | server-owned `netlist.cir` / `result.raw` (relative) |
| include/library paths | screened + never emitted by the serializer |
| SPICE control directives | input control-char guard + output screen |
| arbitrary files | no caller-supplied path reaches fs |
| network endpoints | no network directive reachable |

Gate: the spawn args never reference `body`; the executable/timeout/output
constants are module-level, not body-derived. [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): the route spawns nothing; the executable, argument vector, directory and environment are the diagnostic runner's from the pinned profile (B22-A3); the timeout and raw bound stay route constants]

## Injection defenses (two layers, before spawn)

1. **`assertSchematicFieldsSafe`** (PRIMARY) — rejects any component `value`,
   net-label name, or analysis field containing a newline / carriage-return /
   backtick. Since every SPICE directive must begin its own line, forbidding
   embedded newlines makes it impossible to smuggle a `.include`/`.control`/
   shell line through a field value.
2. **`assertNetlistSafe`** (belt-and-braces) — screens the GENERATED netlist
   for `.include`/`.inc`/`.lib`, `.shell`/`.source`/`.system`/`.exec`, shell
   escapes (`!`), and command substitution (backticks). The serializer's own
   legitimate `.control … run … write result.raw … .endc` block is NOT
   screened (it is server-emitted, not injected).

Path traversal, external `.include`/`.lib`, shell/control injection,
environment expansion, unsafe raw directives, and unbounded analyses are all
refused with a 400 before any process spawns. **CONFIRMED.**
