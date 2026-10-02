# B22-A2 - isolation verdict: production simulation authority stays BLOCKED

Labels: **CONFIRMED** (read at the cited file, or executed by a suite named here), **INFERRED** (a conclusion from reading code or
documentation; never executed), **RECORDED** (written down from the lead's observation or a record, without a claim of our own),
**UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Branch `chapter/b22-sandboxed-computation`, base `50fe156` (B22-A1), 2026-10-01. Runbook B22-A `:906`: "Prefer an OCI/container
boundary for authoritative production execution. If the host cannot supply it, keep production authority blocked and deliver a
diagnostic-only local runner plus complete contract tests. Do not call a weak subprocess sandbox authoritative." Pass `:942`: "If
production isolation cannot be proven, the production runner remains blocked and the verdict must say so." Discovery D22-1, OD-134,
OD-147.

## 1. The verdict

**Production simulation authority stays BLOCKED.** No platform the program controls supplies a measurable isolation boundary, so no
engineering executable may produce authoritative simulation evidence. Concretely (each CONFIRMED and pinned by
`b22-a2-blocked-runner`):

- `executeAuthoritativeSimulation` (`app/lib/model-simulation/safe-execution.ts`) still throws
  `CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX` on every call, and no production code outside its module refers to it.
- `POST /api/model-simulation/execute` answers an authoritative authorization with 501 and exactly this text, in the source and on the
  wire:
  "CD-10 authoritative runner is blocked until the sandbox image/executable and environment corpus are independently validated"
  - even for a request body that declares itself a validated, digest-bearing, network-deny environment (that the route trusts such a
  body is D22-6, latent behind the 501 and B22-C's to close). [B22-C review, 2026-10-02] No longer: such a body is refused 409
  "authoritative execution denied" with a closed code (`CD10_PROVIDER_NOT_SERVER_REGISTERED` for the self-declared pair) before the
  501 is reached; the 501 text and its source pins are unchanged and it stays the route's last line (D22-6 closed, OD-138;
  `b22-a2-blocked-runner` case 4 moved by review, `b22-c-authority`).
- No B22-A2 runtime profile is `validated` or authoritative-eligible; given to the execute route as the environment, each ends at 409
  "authoritative execution denied", whatever the provider (`b22-a2-blocked-runner` case 5; `b22-a2-runtime-profile` case 8).
- The local runs that exist (`/api/simulate`, the SPICE Studio worker, the smoke test, FreeRouting, kicad-cli) are diagnostic plain
  host processes. B22-A3 delivers the diagnostic-only local runner for ngspice; it is never authoritative and nothing calls it a sandbox.

## 2. Why: no measurable boundary on any platform the program controls

- **Local processes (this host, Windows 11).** Every spawner is a plain child of the server with no OS limit on CPU, memory, process
  count, file size or network (D22-1, CONFIRMED by reading). Sirkit uses no Windows job object (no native dependency, OD-145), so the
  local profiles record `enforcedBy: "none"` for those limits and for the network (`runtime-profiles.md`). The screens, environments,
  bounds and timers are prevention by server code, not isolation (`threat-model.md`).
- **A container engine (this host).** None was reachable when the lead probed it (section 3). Whether Docker Desktop's engine can start
  here, and with which backend, is UNKNOWN (discovery 8 item 1); LB-6 records the engine failing at start for an unrelated purpose.
- **CI.** The workflows run on GitHub-hosted `ubuntu-latest` jobs that declare no services, run no container and install no ngspice
  (discovery 2.6 and D22-20, CONFIRMED there by reading the workflows; not re-read here). That such a runner could host Docker or
  `runsc` is INFERRED only (discovery 8 item 9).
- **Production.** No production host is named anywhere in the repository; B24-A establishes environments (runbook `:1027-1042`).
  UNKNOWN; production authority stays BLOCKED whatever the answer until a qualified platform exists.
- **The OCI profile** (`ngspice-oci`) is defined and tested offline - the discovery's flag vector, `unvalidated`, no qualification
  evidence, no image built - and its output transport out of a tmpfs is UNKNOWN. The contract validator reads its docker argv by a
  closed grammar, ties each designed `os` claim to the flag that would deliver it and refuses every other option (`b22-a2-runtime-profile`
  case 16), and binds the host's docker CLI that runs that argv (`hostClient`: a path setting and a file digest, unpinned; its context
  and configuration UNKNOWN until B22-A4; case 18). A design checked for consistency is not a boundary: BLOCKED-LIVE-QUALIFICATION.

## 3. The lead's dated host probe (RECORDED)

On 2026-10-01T09:20:48Z the lead ran read-only host probes; this page records them and runs nothing:

- `docker version`: the Docker CLI 29.3.1 (windows/amd64, context `desktop-linux`) printed its client block and then "failed to connect
  to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine; check if the path is correct and if the daemon is running: open
  //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified." - no engine was reached. (The probe log records
  `exit=0` after that line; the 2026-09-30 readers recorded exit 1. Either way no engine answered.)
- `docker info`: the client block and its plugins only; no server section.
- `wsl -l -v`: `docker-desktop`, `kali-linux` and `Ubuntu`, all WSL 2 and Stopped.
- `where ngspice`: `C:\Users\robsa\Tools\ngspice-46\Spice64\bin\ngspice.exe`.

This agrees with the readers' 2026-09-30 probes (discovery section 0). No docker, podman, runsc, wsl, ngspice, java or kicad-cli
command was run for this increment.

## 4. What is enforced today, and by what (CONFIRMED by reading; the profiles' `enforcedBy`)

| control | local diagnostic processes | the OCI design |
|---|---|---|
| executable identity | none today (PATH and variables choose it); the install-tree digest from a server setting is the contract (B22-A3 enforces it for ngspice) [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): for ngspice the diagnostic runner enforces it (B22-A3); kicad-cli and FreeRouting unchanged] | the image digest from a server setting (unpinned; no image), and the docker CLI's file digest (`hostClient`, unpinned) |
| secrets in the child environment | runner: explicit allowlists (SEC-1, B22-A1); the exact map without HOME/USERPROFILE is the contract [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): for ngspice the diagnostic runner passes it (B22-A3), and on win32 Node adds eight server variables to the child, USERPROFILE among them, recorded per run (OD-156); kicad-cli and FreeRouting keep their allowlists] | os (designed): the `--env KEY=VALUE` pairs, equal to the exact map, are the only variables Sirkit passes - the validator refuses `-e`, `--env=`, `--env-file` and a bare name, which would copy the docker CLI's own variable; [B22-A2 lead] they are not the only ones the container sees: Docker itself adds `HOSTNAME` and a `HOME` inside it (`runtime-profiles.md` section 4), and the docker CLI may inject its configured proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` and their lower-case forms) into every run (INFERRED from Docker's documented client proxy configuration) - B22-A4 must pin the CLI's configuration so none is set; the CLI's own host environment is UNKNOWN (B22-A4) |
| network | none (prevention by the deck screens) | os (designed): `--network none` |
| filesystem | none (the child can reach what the server user can); per-run directories are B22-A3's [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): for ngspice the diagnostic runner removes each in its finally and, after a kill_unconfirmed, again once the child's close is observed - a child that never closes can keep its directory (B22-A3); kicad-cli and FreeRouting unchanged] | os (designed): read-only root, read-only input mount, a tmpfs output |
| CPU, memory, processes, file size | none | os (designed): `--ulimit cpu`, `--memory`, `--pids-limit`, the tmpfs size |
| output | runner: bounded collectors and readers (B22-A1) | runner |
| wall clock and kill | runner: timers, a direct-child kill today; a tree kill is B22-A3's (OD-145) [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): for ngspice the diagnostic runner's tree kill - a run is terminal once the child's close is observed or, failing that, as kill_unconfirmed after a bounded wait, its slot held until the close (B22-A3, OD-145); kicad-cli and FreeRouting keep the direct-child kill] | runner: the docker kill argv |

## 5. What would unblock it

1. **OD-134** (the owner's alternative to the safe default): the owner supplies an OCI engine - a repaired Docker Desktop with a
   recorded backend (WSL 2 or Hyper-V), or a Linux host or CI runner - and approves qualification there. Nothing is started on this
   host until then.
2. **B22-A4** (opt-in, added only then): build the `ngspice-oci` image from a pinned base and a dated package snapshot, record its
   digest in `SIRKIT_NGSPICE_OCI_IMAGE`, choose and qualify the output transport, and run the qualification job on the supplied engine -
   network denial, read-only root, the cgroup limits, the kill, the environment - recording the evidence in the profile's
   `qualificationEvidenceRefs`. Never a local run here.
3. **OD-147 / LB-10**: the live-blocker row "authoritative sandboxed simulation on a qualified OCI platform" stays
   BLOCKED-LIVE-QUALIFICATION until that evidence exists and B24-A names the production host.
4. **B22-C** ([B22-C, 2026-10-02] done for the binding: they now do, by id and digest, and a body copy is refused 409 with a closed
   code; nothing the server holds is validated, so the 501 still cannot be reached - `simulation-authority.md`): even with a qualified profile, execute and readiness must resolve the provider and environment from the server-owned
   registry (OD-138), never the request body, before the 501 could move; the corpus and the independent deck validator remain (D22-19).

## 6. What this verdict does not claim

It does not say the diagnostic local runs are isolated, contained or safe against a construct the screens miss; it does not say the OCI
design works (nothing ran); it does not rate the readers' or the lead's probes beyond what they printed. The word "sandbox" appears here
only in quotations - the runbook, the CD-10 code's own literals and the LB-10 row's title - never for anything that runs.

[B22-B review, 2026-10-02] coverage-4: B22-B's named computations change nothing above. The three reads (`named-computations.md`) run in a worker thread of the server process - the bounded engine host bounds their time and JavaScript heap, and it is no isolation boundary (the worker shares the server's file system, network, CPU and external memory); the two process-backed kinds are inert requests a human approves, and the circuit analysis among them runs on the diagnostic runner, never authoritative. Production simulation authority stays BLOCKED: the 501 and the throwing stub are unchanged.
