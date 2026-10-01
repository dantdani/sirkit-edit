# B22-A2 - runtime profiles: the immutable contract for every engineering executable

Labels: **CONFIRMED** (read at the cited file, or executed by a suite named here), **INFERRED** (a conclusion from reading code or
documentation; never executed), **RECORDED** (written down from a record, without a claim of our own), **UNKNOWN**,
**BLOCKED-LIVE-QUALIFICATION**.

Branch `chapter/b22-sandboxed-computation`, base `50fe156` (B22-A1), 2026-10-01. The code is `app/lib/computation/runtime-profile.ts`
(new); the contract is pinned by `app/lib/computation/__tests__/b22-a2-runtime-profile.test.ts`, whose case 14 checks this page's
field rows and every profile's limit rows against the code. B22-A2 DEFINES the contract and the registry (discovery D22-2 contract,
D22-11 contract; OD-135, OD-148): no runner reads a profile yet - B22-A3 executes `ngspice-local-diagnostic` - and nothing here
started a process. No profile is `validated`, none is authoritative-eligible, and production simulation authority stays BLOCKED
(`isolation-verdict.md`).

## 1. The contract

A profile is a closed, deep-frozen object. Its type `RuntimeProfile` extends - never loosens - CD-10's `SimulationExecutionEnvironment`
(`app/lib/model-simulation/types.ts`): every CD-10 field is present with its CD-10 type, so a profile can be handed to CD-10's
`authorizeSimulationExecution` and `providerAuthoritative` (which never make one authoritative, `b22-a2-blocked-runner` case 5). The
registry validates every profile at construction (`runtimeProfileViolations`); a profile that breaks a rule is never handed out.

| field | meaning | rule the validator checks |
|---|---|---|
| `environmentId` | CD-10: `runtime-profile:<id>:<revision>` | closed key |
| `providerRevisionId` | CD-10: the provider the environment is pinned to; the CD-10 diagnostic ngspice provider for `ngspice-local-diagnostic`, `unbound` for the others (no CD-10 provider defines them) | closed key |
| `executableOrImageDigest` | CD-10: the pinned digest (`sirkit-install-tree-sha256/1:<hex>` or `sha256:<hex>`), present only when the server setting pins one | present exactly when `executable.expectedDigest` is pinned, and equal to it |
| `simulatorVersion` | CD-10: the executable's version string | closed key |
| `operatingSystemAndArchitecture` | CD-10: `win32-x64` or `linux-x64` | closed key |
| `dependencyVersions` | CD-10: empty - everything in an install tree is covered by its one digest | closed key |
| `localeAndTimeZone` | CD-10: `LC_ALL=C;TZ=UTC`, derived from the environment | equals the environment's LC_ALL and TZ |
| `floatingPointAndThreadSettings` | CD-10: the seed and thread settings as text | derived from `determinism` |
| `environmentVariablesAllowlist` | CD-10: the keys of the exact environment | equals the environment's keys, sorted |
| `resourceLimits` | CD-10: timeout, memory, output, process count, waveform points | equals `limits` (an unenforced limit is 0) |
| `networkPolicy` | CD-10: `deny` or `allowlisted` | `deny` only when the OS enforces the network policy |
| `sandboxPolicyRevisionId` | CD-10: the isolation policy id (`b22-a2:local-process-no-os-isolation` or `b22-a2:oci-flag-vector:1:unqualified`) | closed key |
| `validationState` | CD-10: `diagnostic_only` (local) or `unvalidated` (OCI); never `validated` here | `validated` only with qualification evidence, a pinned digest and, on a container profile, a pinned host client |
| `deterministicDigest` | CD-10: the profile's SHA-256 over the canonical JSON of every other field (`sirkit.runtime-profile.v1`) | recomputed and equal |
| `profileId` | the registry id | one of the four ids |
| `revision` | the profile revision (1; `ngspice-local-diagnostic` is 2 since B22-A3: `-n` in both argv templates, the runner's seed note, no legacy spawn) | closed key |
| `executionBackendKind` | CD-10's backend vocabulary: `local_subprocess_diagnostic` or `container` | a local profile claims no OS limit, mount, network or kill |
| `authoritativeEligible` | whether a profile could ever back an authoritative run | true only for a validated, network-deny container profile; false for all four |
| `executable` | identity: install tree or OCI image, program, platform, relative path, the install-root and digest server settings, the algorithm, `digestMembers` (the install root's entries the digest covers, or null for the whole tree), the expected digest (pinned or unpinned, with a reason) | closed keys; the expected digest's shape; members only on an install tree, plain names, distinct, non-empty and covering the executable's first path segment |
| `hostClient` | the HOST program that runs a container profile's argv (the docker CLI): program, path setting, file-digest setting, `sha256-file`, the expected digest, and its configuration (UNKNOWN until B22-A4); null on a local profile, whose executable is the host program | present exactly on a container profile; closed keys; setting names; the digest's shape |
| `version` | the version and the basis for it | closed keys |
| `provenance` | origin, integrity and licence | closed keys |
| `formats` | input and output formats | closed keys |
| `argvTemplates` | one argv per operation; the only placeholders are server-named (section 5) | no caller slot, no `$`, `%`, backtick or stray brace; on a container profile the docker grammar of section 4 (`ngspice-oci`) |
| `workingDirectory` | the child's cwd (a server-named directory) | server-named placeholders only |
| `inputMount` | where the input lives, read-only, and what enforces that (the type admits only `read-only`) | closed keys; `access` is `read-only`; no `os` on a local profile; on a container profile an `os` claim needs the read-only bind |
| `outputDirectory` | the per-run writable directory, and what enforces it | closed keys; no `os` on a local profile; on a container profile an `os` claim needs `--read-only`, the working directory on a bounded tmpfs and every tmpfs noexec, nosuid, nodev and sized |
| `network` | `none`, and what enforces it | closed keys; no `os` on a local profile; on a container profile an `os` claim needs `--network none` |
| `environment` | the EXACT child environment: literals or server-named placeholders | LC_ALL=C, TZ=UTC, no HOME, USERPROFILE, HOMEDRIVE or HOMEPATH in any case, no secret-shaped key, no expansion |
| `environmentInheritance` | `none`: nothing is inherited from the server environment - [B22-A3 review, 2026-10-01] meaning the map the runner passes; on win32 Node (libuv `required_vars`) still copies the server's `HOMEDRIVE`, `HOMEPATH`, `LOGONSERVER`, `SYSTEMDRIVE`, `USERDOMAIN`, `USERNAME`, `USERPROFILE` and `WINDIR` into a child whose map lacks them; the diagnostic runner records those names on every run (`hostAddedEnvironment`, OD-156) | must be `none` |
| `limits` | `cpuSeconds`, `memoryMiB`, `processes`, `fileBytes`, `readBackBytes`, `outputBytes`, `wallClockMs`, `waveformPoints`, each `{ enforcedBy, value, unit, how }` | `enforcedBy` in `os`/`runner`/`none`; a positive integer value exactly when enforced; the right unit; a reason; on a container profile each `os` claim needs the flag carrying that value, and a claim no flag delivers is refused |
| `determinism` | locale, time zone, seed and threads: the value, what pins it and a note | closed keys |
| `kill` | scope (process tree or container), how, terminal only after exit observed or `kill_unconfirmed`, enforced by | closed keys; on a container profile scope `container`, `--rm`, `--name {containerName}` and the kill argv |
| `parser` | the output parser: id, module, whether a live path uses it | closed keys |
| `validator` | the independent validator: id, module, whether a live path uses it | closed keys |
| `qualificationEvidenceRefs` | platform qualification evidence; empty for all four | `validated` needs at least one |
| `legacySpawn` | what the live spawn sites do today (as SEC-1 and B22-A1 left them) and their closed deviations from the profile; null for OCI (no spawn exists) | closed keys |

## 2. The install-tree digest

`installTreeDigest(root, { members })`: SHA-256 over the line `sirkit-install-tree-sha256/1`, then one JSON line `[relative POSIX
path, size, per-file SHA-256]` per regular file, sorted by path in code-unit order. CONFIRMED by `b22-a2-runtime-profile` cases 4-5
and 15 on temporary fixture trees (never on a real install): reproducible; independent of creation and listing order; changed by
one byte, a rename or an added empty file; equal to the encoding computed independently in the test; a real junction refused with
`INSTALL_TREE_LINK`, a root that is not a directory with `INSTALL_TREE_ROOT_NOT_DIRECTORY`. CONFIRMED through the suite's fs seams
(an injected `lstat` or read result, because a fixture tree cannot produce these portably on this host: Windows grants no symlink
privilege here and has no FIFO): a file symlink refused with `INSTALL_TREE_LINK`, a special file with `INSTALL_TREE_SPECIAL_FILE`,
and `INSTALL_TREE_CHANGED` for a file whose read length differs from its listed size, or whose re-stat after the read shows another
modification time, file id or type. RECORDED limits: an empty directory is not part of the identity; a same-size rewrite in place
that also restores the modification time is not detected; the digest covers content at hashing time, so the runner that spawns must
hash and spawn without a window an attacker can use (B22-A3 decides; the time between the check and the spawn is its to bound); a
hard link's content is hashed like any file.

**Named members ([B22-A2 review] coverage-4).** `members` restricts the identity to those entries of the root, each a plain name
listed there exactly (`INSTALL_TREE_MEMBER_MISSING` otherwise; an empty, repeated or non-plain list is `INSTALL_TREE_MEMBER_INVALID`);
naming every entry gives the whole-tree digest, and a file beside the members does not move it (case 15). A profile carries them as
`executable.digestMembers`. Only FreeRouting names members: `scripts/setup-freerouting.ps1:93-104` rewrites
`vendor/freerouting/runtime/sirkit-runtime.json` with `installedAt` (the time of the run) on every run, and the JRE archive stays in
that root too, so a whole-root digest could never stay pinned across a re-run of setup with identical binaries. The members are
`freerouting-2.2.4.jar` and `jdk-25.0.3+9-jre`, the JAR and the JRE the resolver takes from that root (CONFIRMED by reading
`runtime.ts:59-69` and `:98-101`).

**How the owner pins an install (for B22-A3).** Compute the digest of the install root with this function, with the profile's
`digestMembers` when it names any ([B22-A3] `scripts/print-install-tree-digest.ts <root> [--members a,b]` prints it), and set the
profile's digest setting to the 64 hex characters; set the install-root setting to the directory. For the local ngspice that root is
the `Spice64` folder (the discovery records its path), whole: the digest covers `bin/` (the executables and `libomp140.x86_64.dll`),
`share/ngspice/scripts/spinit` and the code-model libraries. For FreeRouting it is `vendor/freerouting/runtime`, members only.

## 3. Server settings

Expected digests are server configuration, never request data: the registry reads each profile's ONE named setting through the server
environment (a test injects its own reader; `b22-a2-runtime-profile` case 10 checks that only that name is read - and, for
`ngspice-oci`, its host client's digest setting after it, case 18).

| profile | digest setting | install-root setting | value |
|---|---|---|---|
| `ngspice-local-diagnostic` | `SIRKIT_NGSPICE_INSTALL_SHA256` | `SIRKIT_NGSPICE_INSTALL_ROOT` | 64 hex characters (case-insensitive, trimmed) |
| `ngspice-oci` | `SIRKIT_NGSPICE_OCI_IMAGE` | none | a digest-pinned reference `<repository>@sha256:<64 hex>` |
| `ngspice-oci` host client (the docker CLI) | `SIRKIT_OCI_CLI_SHA256` | `SIRKIT_OCI_CLI_PATH` (the client's file, read by the runner) | 64 hex characters: the SHA-256 of that one file |
| `kicad-cli-local-diagnostic` | `SIRKIT_KICAD_CLI_INSTALL_SHA256` | `SIRKIT_KICAD_CLI_INSTALL_ROOT` | 64 hex characters |
| `freerouting-local-diagnostic` | `SIRKIT_FREEROUTING_INSTALL_SHA256` | `SIRKIT_FREEROUTING_INSTALL_ROOT` | 64 hex characters |

An absent or blank setting gives `{ state: "unpinned", reason: "setting-absent" }`; a malformed one `{ state: "unpinned", reason:
"setting-malformed" }`, and the value is never echoed into the profile. A2 only records the state: what an unpinned profile may do is
the runner's (B22-A3's task refuses it, fail-closed, with a closed error naming the setting). The install-root settings are named
here and read by the runner, not by the registry, and so is the host client's path setting. None of these settings is set on this
host (they are new); none was read here.

## 4. The profiles

`enforcedBy` is truthful: **os** is a limit the operating system or a container runtime holds; **runner** is Sirkit's own code around
the child (a timer, a bounded collector, a bounded reader, a per-run directory); **none** means nothing holds it, and the value is
`-`. On this Windows host Sirkit uses no job object, so no local profile claims an OS limit (`b22-a2-runtime-profile` case 9). On
`ngspice-oci` every **os** is the DESIGNED mechanism of an unqualified profile - no engine was reachable and nothing was run
(BLOCKED-LIVE-QUALIFICATION, LB-10).

### `ngspice-local-diagnostic`

- `local_subprocess_diagnostic`, `diagnostic_only`, not authoritative-eligible; CD-10 provider: the diagnostic ngspice provider.
- Executable: install tree, `bin/ngspice_con.exe` (win32-x64), digest setting `SIRKIT_NGSPICE_INSTALL_SHA256`. Version 46 (INFERRED
  from the folder name and the bundled manual; the lead's SEC-1 probes ran it, `ngspice_con -b`, KLU, and printed no version line).
  Provenance: the owner's Windows build; ngspice's download page states no checksum or signature (discovery 1.2, RECORDED). SEC-1's
  final deck screen is cut to this build's probed behaviour, so pinning this build is what makes that screen's ground hold (D22-2).
- Argv: `run` = `-b {deckFile}`; `version` = `-v` (the worker's probe). Working directory `{runDir}`. [B22-A3, 2026-10-01] Revision 2:
  `run` = `-b -n {deckFile}`, `version` = `-n -v` - no `.spiceinit` is read (the lead's probe p23: one in the run directory runs
  without `-n` and does not with it); `{deckFile}` is `deck.cir`, relative to the run directory the runner creates.
- Environment (exact): `LC_ALL=C`, `TZ=UTC`, `PATH={installBinDir}`, `SystemRoot={systemRoot}`, `TEMP={runDir}`, `TMP={runDir}`.
  INFERRED adequacy: the bundled DLLs sit beside the executable and the system DLLs come from the system directory, so PATH need not
  hold more; B22-A3's opt-in live suite is the check. Without HOME and USERPROFILE, ngspice finds no home `.spiceinit` (INFERRED from
  the man page, discovery 1.2) - [B22-A3 review, 2026-10-01] but on win32 Node adds the server's USERPROFILE, HOMEDRIVE and HOMEPATH
  to the child (libuv), so `-n` (p23) alone keeps a home `.spiceinit` from running; the cwd is a server-created directory holding
  only server files.
- Input `{runDir}` read-only by policy, enforced by none (a local process can write there); output `{runDir}` per run, enforced by
  the runner (mkdtemp, removed in finally) - the same directory, so the input's read-only access is a rule nothing holds (RECORDED,
  [B22-A2 review] coverage-2; the same holds for kicad-cli and FreeRouting); network `none`, enforced by none (the deck screens prevent UNC and include paths).
- Determinism: locale `C` and time zone `UTC` by the environment (on Windows the C runtime reads the OS settings: INFERRED, discovery
  9.5 item 22; [B22-A3] the lead's probes p25-p26 CONFIRM that the binary starts, an `.op` deck simulates and spinit still loads under
  exactly this environment); seed `1` by `.options seed=1` through the compiler's option lines (no screen change, discovery 9.4), emitted by the
  runner that executes the profile - no deck sets a seed today and the installed spinit leaves `rndseed` commented out (`spinit:5`), so
  the legacy default is UNKNOWN; threads `8`, pinned by the install digest: the installed `spinit:14` sets `num_threads=8` (RECORDED,
  discovery 9.5 item 11) and another value is another digest; whether this build runs OpenMP threads is INFERRED.
- Kill: process tree (win32 `taskkill /PID <pid> /T /F` with a server-built argv; POSIX a process-group kill; OD-145), terminal only
  after exit observed or `kill_unconfirmed`, by the runner.
- Parser `ngspice-ascii-raw/1` (`app/lib/spice/waveforms.ts`, wired; drops non-finite tokens, D22-10); validator
  `cd10-waveform-artifact/1` (`app/lib/model-simulation/waveform.ts`, not wired: B22-C). Qualification evidence: none.
- [B22-A3, 2026-10-01] Superseded: no legacy spawn is left (`legacySpawn` is null). The worker, `/api/simulate` and the smoke test run
  ngspice only through the diagnostic runner, which executes this profile (`diagnostic-runner.md`); the seed line is the runner's
  (`seedDiagnosticDeck`, immediately before every run deck's final `.end`; the lead's probe p24 CONFIRMS `.options seed=1` is accepted).
  [B22-A3 review, 2026-10-01] regressions-4: a deck that sets its own `seed` or `rndseed` option (a Studio solver profile's custom
  option, a custom directive) is refused, closed, so the profile's line is the only seed option a run carries and the provenance
  records it. The record below is A2's, kept as read then.
- Legacy spawn (CONFIRMED by reading; `b22-a2-runtime-profile` case 13 pins the allowlist to all three sources): the worker, `/api/simulate`
  and the smoke test; `NGSPICE_BIN` or PATH; argv `-b <absolute deck path>` and `-v`; the host allowlist `PATH`, `Path`, `PATHEXT`,
  `SystemRoot`, `WINDIR`, `TEMP`, `TMP`, `HOME`, `USERPROFILE`, `LD_LIBRARY_PATH` plus `NODE_ENV`; 120 s / 10 s / 10 s / 2 s; direct-child
  kill. Deviations: `executable-from-path-or-env`, `no-digest-check`, `host-environment-allowlist`, `home-and-userprofile-passed`,
  `no-locale-or-timezone`, `direct-child-kill`, `terminal-before-exit`, `unbounded-raw-read`, `run-directory-not-removed`.

| limit | enforcedBy | value | how |
|---|---|---|---|
| limit `cpuSeconds` | none | - | no job object (OD-145); the wall clock bounds the run |
| limit `memoryMiB` | none | - | no job object (OD-145) |
| limit `processes` | none | - | no job object; the deck screens refuse every construct that runs a command - prevention, not a limit |
| limit `fileBytes` | none | - | no OS file-size limit; the runner reads none over `readBackBytes` |
| limit `readBackBytes` | runner | 104857600 | the diagnostic runner's bounded reader refuses a raw file over the bound unread (B22-A3; was read whole, D22-8) |
| limit `outputBytes` | runner | 65536 | stdout and stderr each held and returned within `DIAGNOSTIC_OUTPUT_MAX_BYTES` (B22-A1) |
| limit `wallClockMs` | runner | 120000 | the runner's timer kills the process tree (the worker's 120 s) |
| limit `waveformPoints` | runner | 5000000 | the run fails past the bound (the worker's bound) |

### `ngspice-oci`

- `container`, `unvalidated`, not authoritative-eligible, no qualification evidence, no CD-10 provider (`unbound`), no legacy spawn.
- Executable: OCI image, `/usr/bin/ngspice` (linux-x64), setting `SIRKIT_NGSPICE_OCI_IMAGE` (a digest-pinned reference). Version 47
  is the plan (OD-135's default: ngspice `47+ds-1` from a dated Debian snapshot on `debian:trixie-slim` pinned by a digest re-resolved
  before use); no image is built: UNKNOWN until B22-A4. Licence set as for ngspice (discovery 1.2, RECORDED).
- Argv `run` (the docker CLI), the discovery's flag vector: `run --rm --init --name {containerName} --network none --read-only
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 1024m --memory-swap 1024m --cpus 1 --ulimit cpu=120:120
  --user 65534:65534 --tmpfs /out:rw,noexec,nosuid,nodev,size=128m --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m --mount
  type=bind,source={inputDir},target=/in,readonly --workdir /out --env LC_ALL=C --env TZ=UTC --env PATH=/usr/bin:/bin {image} ngspice
  -b /in/deck.cir`; argv `kill` = `kill --signal KILL {containerName}`. The `--env` pairs are exactly the environment (case 7).
- **The validator reads this argv by a closed grammar** ([B22-A2 review] security-1, security-2, coverage-1, tests-2; CONFIRMED by
  `b22-a2-runtime-profile` case 16, one counterexample per rule): a container profile has exactly the `run` and `kill` operations;
  `run` is `run`, then long options up to the one `{image}`, then the profile's program. Only these options are admitted, each once:
  `--rm`, `--init`, `--read-only`, `--name`, `--network`, `--cap-drop`, `--security-opt`, `--pids-limit`, `--memory`, `--memory-swap`,
  `--cpus`, `--user`, `--mount`, `--workdir`, and `--ulimit` (one per name), `--tmpfs` and `--env` repeated. Everything else is
  refused: a short flag (`-e`, `-v`), any `--option=value` form (`--env=`, `--network=`, `--rm=false`), `--env-file`, `--volume`,
  `--privileged`, `--cap-add`, a stray operand. `--env` must be `KEY=VALUE` with a plain key, never a bare name (docker copies a bare
  name's value from the CLI's own environment), and the pairs must equal the environment. The baseline is required: `--cap-drop ALL`,
  `--security-opt no-new-privileges`, a non-root numeric `--user` and group, a positive `--cpus`. Each `os` claim is tied to its flag:
  `network` to `--network none`; `outputDirectory` to `--read-only`, `--workdir` at the output path on its own tmpfs, and every
  tmpfs `noexec,nosuid,nodev` with a size; `fileBytes` to that tmpfs's size; `processes` to `--pids-limit`; `memoryMiB` to `--memory`
  and `--memory-swap` (equal, so no swap); `cpuSeconds` to `--ulimit cpu=<value>:<value>`; `inputMount` to one `--mount` that is the
  read-only bind of the input path (any `--mount` must be it); and an `os` claim no flag delivers (`outputBytes`, for one) is
  refused. The container kill needs `--rm`, `--name {containerName}` and the kill argv. A writable output bind for B22-A4's transport
  would therefore be a reviewed change to this grammar, not a profile edit.
- **Host client** ([B22-A2 review] coverage-7): `executable` is ngspice inside the image, while both argv templates run on the host
  through the docker CLI. `hostClient` binds it like an executable: `program` `docker`, taken only from `SIRKIT_OCI_CLI_PATH` (never
  PATH) and identified by the SHA-256 of that file in `SIRKIT_OCI_CLI_SHA256` (`sha256-file`; unpinned). Its `configuration` is
  UNKNOWN until B22-A4: the CLI picks its engine from its context, `DOCKER_HOST` and its configuration directory, and B22-A4 pins
  the endpoint, the client's environment and that configuration. `validated` needs this digest pinned as well as the image's.
- Environment (exact, passed with `--env`): `LC_ALL=C`, `TZ=UTC`, `PATH=/usr/bin:/bin`. Docker itself adds `HOSTNAME` and a `HOME`
  inside the container (`/` for a user without a passwd entry; INFERRED from Docker's documented defaults): neither names anything on
  the host. The docker CLI process on the host needs its own minimal environment (it finds its context through the user profile on
  Windows: UNKNOWN which keys; B22-A4).
- Input `{inputDir}` bind-mounted read-only at `/in` (os, designed); output `/out`, a tmpfs on a read-only root filesystem (os,
  designed). **Open (UNKNOWN):** a tmpfs is gone with the container and is not readable from the host after exit, so B22-A4 must choose
  and qualify a transport for the raw file (ngspice writing it to stdout, or a per-run host bind mount with `--ulimit fsize`, which the
  grammar above refuses today). Network `none` by `--network none` (os, designed).
- Determinism: locale and time zone as above (glibc reads them: INFERRED until qualified); seed `1` by the deck option; threads pinned by
  the image digest, value UNKNOWN until the image exists.
- Kill: the container (`docker kill --signal KILL`, then `--rm`); killing the docker CLI client does not stop the container (discovery
  1.2), so the runner must run the kill argv.

| limit | enforcedBy | value | how |
|---|---|---|---|
| limit `cpuSeconds` | os | 120 | `--ulimit cpu=120:120` beside `--cpus 1` (designed; unqualified) |
| limit `memoryMiB` | os | 1024 | `--memory 1024m --memory-swap 1024m`, which the tmpfs counts against (designed; unqualified) |
| limit `processes` | os | 64 | `--pids-limit 64` (designed; unqualified) |
| limit `fileBytes` | os | 134217728 | the `/out` tmpfs `size=128m` (designed; unqualified) |
| limit `readBackBytes` | runner | 104857600 | a bounded reader, whatever transport B22-A4 qualifies |
| limit `outputBytes` | runner | 65536 | no docker flag caps output (discovery 1.2) |
| limit `wallClockMs` | runner | 120000 | the runner's timer runs the kill argv |
| limit `waveformPoints` | runner | 5000000 | the run fails past the bound |

### `kicad-cli-local-diagnostic`

- `local_subprocess_diagnostic`, `diagnostic_only`, not authoritative-eligible (OD-148: a full profile, diagnostic-only).
- Executable: install tree, `bin/kicad-cli.exe`, setting `SIRKIT_KICAD_CLI_INSTALL_SHA256`. Version UNKNOWN (KiCad 8.x or newer per
  `.env.example`; kicad-cli was never run here); provenance: an owner-installed KiCad found through `KICAD_CLI` or PATH; licence not
  recorded.
- Argv: `export-gerbers` = `pcb export gerbers {boardFile} --output {gerberDir} --layers {layerList}`; `export-drill` = `pcb export
  drill {boardFile} --output {drillDir} --format excellon --excellon-units {excellonUnits} --excellon-zeros-format decimal
  --drill-origin absolute`; `export-drill-separate-th` = the same with `--excellon-separate-th`. The layer list and units come from the
  server's fab preset table.
- Environment (exact): `LC_ALL=C`, `TZ=UTC`, `PATH={installBinDir}`, `SystemRoot={systemRoot}`, `TEMP={runDir}`, `TMP={runDir}`,
  `KICAD_CONFIG_HOME={runDir}`. UNKNOWN adequacy: kicad-cli was never run; whether it plots without its per-user settings (A1's list
  passes `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `HOME`) needs the opt-in kicad-cli oracle before any runner adopts this map.
- Parser: none (files zipped as produced, bounded); validator `native-gerber-and-xnc-parsers` exists but is not applied to kicad-cli's
  files (RECORDED). Kill: process tree, by the runner (contract).
- Legacy spawn (as B22-A1 left it; case 13 pins the allowlist to `KICAD_CLI_ENV_KEYS`): `KICAD_CLI` or PATH; the host allowlist of 18
  keys plus `NODE_ENV`; 60 s per invocation; SIGKILL of the direct child, resolved before exit; the board file named from the caller's
  sanitized board name. Deviations: the six local ones, `terminal-before-exit`, `caller-influenced-argv`.

| limit | enforcedBy | value | how |
|---|---|---|---|
| limit `cpuSeconds` | none | - | no job object; the wall clock bounds each invocation |
| limit `memoryMiB` | none | - | no job object |
| limit `processes` | none | - | no job object |
| limit `fileBytes` | none | - | no OS file-size limit |
| limit `readBackBytes` | runner | 67108864 | gerber and drill files through the bounded reader (`TOOL_OUTPUT_FILE_MAX_BYTES`, B22-A1) |
| limit `outputBytes` | runner | 65536 | each stream held to twice the bound, returned within it (B22-A1) |
| limit `wallClockMs` | runner | 60000 | `CLI_TIMEOUT_MS` per invocation |
| limit `waveformPoints` | none | - | not applicable |

### `freerouting-local-diagnostic`

- `local_subprocess_diagnostic`, `diagnostic_only`, not authoritative-eligible (OD-148).
- Executable: install tree (`vendor/freerouting/runtime`), `jdk-25.0.3+9-jre/bin/java.exe` running `{jarFile}`, setting
  `SIRKIT_FREEROUTING_INSTALL_SHA256`, digest members `freerouting-2.2.4.jar` and `jdk-25.0.3+9-jre` (section 2: setup rewrites
  `sirkit-runtime.json` beside them). Version 2.2.4 with the Temurin JRE 25.0.3+9 (`runtime.ts`); provenance:
  `scripts/setup-freerouting.ps1` downloads both and checks their SHA-256 pins at install time; at run time only existence is checked and
  operator overrides win (CONFIRMED by reading). Licences not recorded.
- Argv `route` = A1's argv with server placeholders (case 13 checks it against `buildFreeroutingArguments`): `-Djava.awt.headless=true
  -Dlog4j2.disableJndi=true -jar {jarFile} --gui.enabled=false --api_server.enabled=false --logging.file.enabled=false
  --logging.console.level=WARN -da -de {dsnFile} -do {sesFile} -mp {enginePasses}`. `{enginePasses}` is the pass scheduler's budget;
  today `/api/pcb/autoroute` lets the body's bounded `maxPasses` reach it (`caller-influenced-argv`).
- Environment (exact): `LC_ALL=C`, `TZ=UTC`, `PATH={installBinDir}`, `SystemRoot={systemRoot}`, `TEMP={runDir}`, `TMP={runDir}`.
  UNKNOWN adequacy (java finds its home through the Windows API rather than `USERPROFILE`: INFERRED).
- Parser `specctra-ses/1` (`read-ses.ts`, wired); validator `autoroute-candidate/1` (`verification.ts`, wired). Kill: process tree,
  by the runner (contract).
- Legacy spawn (case 13 pins the allowlist to `freeroutingEnvironment` and the argv to `buildFreeroutingArguments`): java from
  `FREEROUTING_JAVA`, `JAVA_HOME` (`runtime.ts:94-97`), the bundled JRE, else java on PATH (`runtime.ts:119-126`); the JAR from
  `FREEROUTING_JAR`, the bundled release, else the source-build JAR `vendor/freerouting/build/libs/freerouting-current-executable.jar`
  (`runtime.ts:59-69`); each candidate only existence-checked (`runtime.ts:104-115` and the JAR loop before it), and every one but
  the bundled release and JRE lies outside the install root the profile digests ([B22-A2 review] coverage-5, discovery 9.5 item
  13(c); case 13 derives the candidate set by driving `resolveFreeroutingRuntime` with a fake file check); the host allowlist of
  11 keys plus `NODE_ENV`; cwd the shared OS temp directory with uuid files; SIGKILL of the direct child on abort and timeout, resolved
  before exit. Deviations: the six local ones, `terminal-before-exit`, `shared-temp-cwd`, `caller-influenced-argv`.

| limit | enforcedBy | value | how |
|---|---|---|---|
| limit `cpuSeconds` | none | - | no job object; the wall clock bounds the run |
| limit `memoryMiB` | none | - | no job object; no `-Xmx` either (discovery 2.3) |
| limit `processes` | none | - | no job object |
| limit `fileBytes` | none | - | no OS file-size limit |
| limit `readBackBytes` | runner | 67108864 | the session file through the bounded reader (B22-A1) |
| limit `outputBytes` | runner | 65536 | joined diagnostics within the bound, stderr keeping its share (B22-A1) |
| limit `wallClockMs` | runner | 300000 | the runner's 300 s default; callers pass their own deadline |
| limit `waveformPoints` | none | - | not applicable |

## 5. Server-named placeholders

`{runDir}`, `{deckFile}`, `{inputDir}`, `{installBinDir}`, `{systemRoot}`, `{image}`, `{containerName}`, `{boardFile}`,
`{gerberDir}`, `{drillDir}`, `{layerList}`, `{excellonUnits}`, `{jarFile}`, `{dsnFile}`, `{sesFile}`, `{enginePasses}`
(`SERVER_NAMED_PLACEHOLDERS`, each with what the server or its runner puts there). None is filled from a request: the deck, board and
DSN files are written by the server under fixed names, directories are the runner's, the image and install paths are server settings,
the fab values come from the server's preset table and the pass budget from the server's scheduler. Case 6 refuses any other
placeholder (a caller slot) and any `$`, `%`, backtick or stray brace (an expansion).

## 6. Recorded, not claimed

- No runner executes a profile yet; every **runner** above is today's legacy code where the legacy spawn already does it (output
  bounds, timers) and a contract for B22-A3 otherwise (tree kill, bounded raw read, exact environment, digest check). [B22-A3,
  2026-10-01] Superseded for ngspice: the diagnostic runner executes `ngspice-local-diagnostic` (its **runner** rows are its code,
  CONFIRMED at the fake seams by `b22-a3-diagnostic-runner`); kicad-cli and FreeRouting keep their legacy spawns.
- The contract environments of kicad-cli and FreeRouting are UNKNOWN in adequacy; no runner adopts them before a live oracle.
- The OCI profile is a design: every **os** on it is BLOCKED-LIVE-QUALIFICATION (LB-10); its output transport is UNKNOWN.
- The seed option and the thread pin are contracts; whether ngspice honours `-n` (B22-A3 adds it; [B22-A3] CONFIRMED by the lead's probe p23) and its default seed are UNKNOWN
  (discovery 8 item 4).

## 7. The B22-A2 record: test-first, breakages, pin moves, gates

Every run under the global heavy-job lock (`run.sh` for vitest with two workers, `heavy.sh` for tsc, eslint and tsx), every exit code
captured; no live suite, no browser spec, no full suite; no process was started by the work or by any suite.

- **Baseline before any edit** (every suite pinning a file this increment touches, the 501 and stub pins, the process gate, CD-10):
  20 files, 348 passed; exit 0.
- **Red first** (the three suites and the A1 page, on `50fe156` with no production edit): `b22-a2-runtime-profile` failed to load
  (no module); `b22-a2-process-census` 4 failed / 3 passed - cases 3 and 5 on exactly D22-18's three rows (`/api/chat` and
  `/api/pcb/qualify` classified empty but reaching FreeRouting; `/api/pcb/release` classified `kicad-cli (server-authoritative)` but
  reaching no spawner), case 7 (no page), and case 1 on a bug in the test itself (it compared the 151 route files with the 165 policy
  rows; corrected to compare paths before any production edit); `b22-a2-blocked-runner` 2 failed / 4 passed (cases 1-4 pin what
  exists and were green; case 5 needs the registry, case 6 the page); `b22-a1-page` case 6 failed (it listed every suite in the
  folder). In all: 7 failed / 13 passed of 20, exit 1.
- **First green run** found one more test issue: the stub-reference case counted the module's own doc comment naming the stub; it now
  counts code only (an identifier or a string), with probes showing a call, an import and a string key are seen and a comment is not.
- **Green**: the three suites 27 passed (14 + 7 + 6), exit 0.
- **Deliberate breakages** of `runtime-profile.ts` (each restored and checked by hash, sha256 `409c7760...` before and after), each
  caught by exactly one case, 1 failed / 13 passed: M1 the link refusal removed (case 5), M2 the global path sort removed (case 4,
  through the `share`/`share-x` fixture pair), M3 the id check by `in` (case 11: `__proto__`, `constructor`, `toString`), M4 no
  freeze (case 3), M5 the HOME/USERPROFILE refusal removed (case 7).
- **Pin moves** (each reviewed, its reason beside it): `app/lib/computation/__tests__/b22-a1-page.test.ts:97` - case 6 now lists the
  `b22-a1-` suites only (the folder is shared by every B22 increment; it listed every suite), line-neutral, its 7 blocks unchanged;
  `app/lib/auth/route-resource-classification.ts:54, :55, :78` - the three D22-18 rows, edited in place (line-neutral: B20's
  `mcp-server-reads.md:202` citation of `:95` and the discovery's `:54, :55, :78` still resolve); the byte-pinned
  `route-data-and-resource-classification.csv` regenerated by `scripts/generate-b16-0-2-artifacts.ts` only, its diff exactly those
  three rows (`b16-0-2-gates` byte pin green).
- **Gates**: A - `app/lib/computation/__tests__`, `app/lib/spice/__tests__`, `app/lib/model-simulation`, `app/api/model-simulation`,
  the CI guard: 19 files (18 passed, 1 skipped: the opt-in worker integration), 478 passed, 3 skipped; exit 0. B - every suite reading
  the classification or the CSV (`b16-0-2-gates`, `b16-0-3-effective-classification`, the B19-E and B20 route suites), the 501 pins
  (`b16-0-20-simulation-confinement-gate`, `b16-0-20-tranche-parity`), the import gates (`b14-4`, `b15-3`, `b18-b`, `b20-b2`, `b20-b3`,
  `b20-d3`), `b16-1c-invariant-tripwires` (165 / 162 / 3 / 0), the route-tree and matrix pins, the CI and body gates, the confinement
  gates, `b20-b4-process-gate` (still exactly the five spawners), `b20-c1-three-way-parity`: 34 files, 448 passed; exit 0. C - B21's
  `app/lib/agent/orchestration/__tests__`: 49 files, 460 passed; exit 0. `tsc --noEmit -p tsconfig.json`: exit 0. eslint on the six
  changed TypeScript files: exit 0. Generators `generate-b16-0-4-artifacts.ts` (165 + 165 rows), `generate-b16-0-7-artifacts.ts`
  (165 / 162 / 3 / 0), `generate-b16-0-8-baseline.ts` (3 -> 3) and `generate-b16-0-2-artifacts.ts`: each exit 0, zero drift (the
  status, the diff and every untracked file's hash identical before and after).

## 8. The B22-A2 review fixes (2026-10-01)

An adversarial review CONFIRMED thirteen findings; each is fixed here, test-first, under the same lock and exit-code rules.

- **Red first** (the strengthened `b22-a2-runtime-profile` and `b22-a2-process-census` and the unchanged `b22-a2-blocked-runner`, on the
  unmodified source): 10 failed / 21 passed of 31, exit 1 - runtime-profile cases 5 (a re-stat change not refused), 9 (a read-write
  input admitted), 10 (no host-client setting read), 13 (no source-build JAR in the legacy record, no `runtime.ts` citations), 14 and 18
  (no `hostClient`), 15 (members ignored), 16 (`-e NAME` admitted, no flag tied to a claim), 17 (the new codes missing); census case 5
  (the page and the classification comment said "only outside fixture mode"). Two red failures were test bugs, fixed before any source
  edit: case 15 read the fixture `TREE` from another `describe` block (a ReferenceError; moved to module scope, then case 15 failed on
  the defect: the named-member digest equalled the whole tree's), and census case 6 called `toContain` on `exportsReaching`'s object
  (now `.exports`). Census case 5's page regex required a `/api/pcb/qualify` row the entry table never has; it now reads the `POST` row.
  Case 7's OCI counterexample appended `--env HOME=/root` after the container command, where docker passes it to ngspice; it now adds it
  among the docker options (a reviewed move within this increment's suite).
- **A real nondeterminism found while fixing, not a flake.** Case 5 failed intermittently under two mutations that do not touch the
  digest. Cause: every Windows file id on this host exceeds 2^53 (a node one-liner stat'ed 20 new temp files: all 20 ids rounded as a
  number, `ino + 1 === ino`), so a number comparison could miss a changed file id. The digest now stats files as bigint (exact `ino`,
  `mtimeNs`), and case 5 asserts that it does. Stable since: three repeated runs, gate A and nine mutation runs.
- **Green**: 31 passed (18 + 7 + 6), exit 0.
- **Deliberate breakages** (each restored and checked by hash, `runtime-profile.ts` sha256 `232c064f...`, `_scope.ts` `2e4a1a28...`,
  `job-store.ts` `6e30065f...`): no re-stat comparison (case 5); number stats for the re-stat (cases 4, 5, 15); short flags admitted (case
  16); the network claim untied (cases 16, 17); a read-write input admitted (cases 9, 17); members ignored (case 15); no host-client check
  (cases 17, 18); `--network none` removed from the registry's OCI argv (15 cases: the registry refuses to build the profile); the
  source-build JAR dropped from the legacy record (case 13); on disk, `_scope.ts` importing `startRunPlan` and a const arrow in the job
  store making `cancelRun` reach the run (census cases 3, 4, 6, 7 each time).
- **Gates**: A - 19 files (18 passed, 1 skipped), 482 passed, 3 skipped; B - the same 34 files, 448 passed; C - 49 files, 460 passed;
  each exit 0. `tsc --noEmit -p tsconfig.json` exit 0; eslint on the six changed TypeScript files exit 0. The four generators exit 0
  with zero drift (status, diff and every untracked file's hash identical before and after; 165 / 162 / 3 / 0): the classification
  edit is a comment, in place.
