/**
 * [B22-A2] The immutable runtime profile contract (runbook B22-A :890-904; discovery D22-2 contract, D22-11 contract; OD-135,
 * OD-148). A profile binds one engineering executable to every item the runbook lists: its identity (an install-tree or image
 * digest read from a NAMED SERVER SETTING, never from a request), version and provenance, input and output formats, argv templates
 * whose only placeholders are server-named, the input mount and per-run output directory, the network policy, the exact child
 * environment (never inherited), CPU, memory, process, file, output and wall-clock limits each with what enforces it
 * (`enforcedBy`), seed and thread settings, kill semantics, the output parser and the independent validator, qualification evidence
 * and `validationState`. It extends - never loosens - CD-10's `SimulationExecutionEnvironment`, so a profile is usable wherever
 * CD-10 takes an environment.
 *
 * A2 only DEFINES the contract: no runner reads a profile yet (B22-A3 executes `ngspice-local-diagnostic`), nothing here starts
 * a process, and no profile is `validated` or authoritative-eligible - production simulation authority stays BLOCKED (the CD-10
 * 501; `executeAuthoritativeSimulation` throws). On `ngspice-oci`, `enforcedBy: "os"` names the DESIGNED mechanism of an
 * unqualified container profile (BLOCKED-LIVE-QUALIFICATION, LB-10), never evidence, and the validator ties each such claim to the
 * docker flag that would deliver it. `legacySpawn` records, as read, what each live spawn site does today (SEC-1 and B22-A1 left
 * them so) and how it deviates from the profile. [B22-A2 review] A container profile also binds `hostClient`, the host program
 * that runs its argv (the docker CLI), by server settings like the executable.
 */
import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { diagnosticNgspiceProvider } from "@/app/lib/model-simulation/provider";
import type { SimulationExecutionEnvironment, SimulatorProviderDefinition } from "@/app/lib/model-simulation/types";
import { DIAGNOSTIC_OUTPUT_MAX_BYTES, TOOL_OUTPUT_FILE_MAX_BYTES } from "./output-bounds";

export const RUNTIME_PROFILE_IDS = ["ngspice-local-diagnostic", "ngspice-oci", "kicad-cli-local-diagnostic", "freerouting-local-diagnostic"] as const;
export type RuntimeProfileId = (typeof RUNTIME_PROFILE_IDS)[number];

/** [B22-A2] The server setting each profile's expected digest is read from (server configuration, never request data). */
export const RUNTIME_PROFILE_DIGEST_SETTINGS: Readonly<Record<RuntimeProfileId, string>> = Object.freeze({
  "ngspice-local-diagnostic": "SIRKIT_NGSPICE_INSTALL_SHA256",
  "ngspice-oci": "SIRKIT_NGSPICE_OCI_IMAGE",
  "kicad-cli-local-diagnostic": "SIRKIT_KICAD_CLI_INSTALL_SHA256",
  "freerouting-local-diagnostic": "SIRKIT_FREEROUTING_INSTALL_SHA256",
});

/** [B22-A2 review] coverage-7: the server settings that bind a container profile's host client - its path, its file digest. */
export const OCI_HOST_CLIENT_SETTINGS: Readonly<{ path: string; digest: string }> = Object.freeze({ path: "SIRKIT_OCI_CLI_PATH", digest: "SIRKIT_OCI_CLI_SHA256" });

/** [B22-A2] Reads one named server setting. The default is the server's own environment; tests inject their own. */
export type ServerSettingReader = (name: string) => string | undefined;
const readServerSetting: ServerSettingReader = (name) => process.env[name];

/**
 * [B22-A2] The ONLY placeholders an argv template, a working directory or an environment value may hold: each names a value the
 * server or its runner decides. There is no caller slot: a request never fills a placeholder.
 */
export const SERVER_NAMED_PLACEHOLDERS: Readonly<Record<string, string>> = Object.freeze({
  "{runDir}": "the per-run directory the runner creates (mkdtemp under its one root)",
  "{deckFile}": "deck.cir, the deck the server compiles, screens and writes into the per-run directory",
  "{inputDir}": "the per-run host directory holding the server-written deck (bind-mounted read-only at /in)",
  "{installBinDir}": "the bin directory of the pinned install, from the profile's install-root server setting (never PATH)",
  "{systemRoot}": "the host's Windows directory, read by the runner from its own operating system",
  "{image}": "the digest-pinned image reference in the profile's server setting",
  "{containerName}": "a container name the server generates for the run (sirkit-run-<uuid>)",
  "{boardFile}": "board.kicad_pcb, the board file the server writes into the per-run directory",
  "{gerberDir}": "the gerbers directory inside the per-run directory",
  "{drillDir}": "the drill directory inside the per-run directory",
  "{layerList}": "the enabled layer names of the server's fab preset (a closed server table), comma-joined",
  "{excellonUnits}": "in or mm, from the server's fab preset",
  "{jarFile}": "the pinned FreeRouting JAR inside the install tree",
  "{dsnFile}": "the DSN the server writes into the per-run directory",
  "{sesFile}": "the session file path inside the per-run directory",
  "{enginePasses}": "the router's per-pass budget from the server's pass scheduler constants",
});

export type LimitEnforcement = "os" | "runner" | "none";
const ENFORCEMENT: readonly LimitEnforcement[] = ["os", "runner", "none"];
export const LIMIT_NAMES = ["cpuSeconds", "memoryMiB", "processes", "fileBytes", "readBackBytes", "outputBytes", "wallClockMs", "waveformPoints"] as const;
export type LimitName = (typeof LIMIT_NAMES)[number];
const LIMIT_UNITS: Readonly<Record<LimitName, ProfileLimit["unit"]>> = Object.freeze({
  cpuSeconds: "s", memoryMiB: "MiB", processes: "count", fileBytes: "bytes", readBackBytes: "bytes", outputBytes: "bytes", wallClockMs: "ms", waveformPoints: "points",
});
/** A limit: what bounds it (`os`, the `runner`, or `none`), its value (null exactly when nothing enforces it) and how. */
export interface ProfileLimit { readonly enforcedBy: LimitEnforcement; readonly value: number | null; readonly unit: "s" | "MiB" | "count" | "bytes" | "ms" | "points"; readonly how: string }
export type RuntimeFormat = "ngspice-deck" | "ngspice-ascii-raw" | "text-log" | "version-text" | "kicad-pcb" | "gerber" | "excellon" | "specctra-dsn" | "specctra-ses";
export interface ExpectedDigest { readonly state: "pinned" | "unpinned"; readonly value: string | null; readonly reason: "setting-absent" | "setting-malformed" | null }
export interface ExecutableBinding {
  readonly kind: "install-tree" | "oci-image";
  readonly program: string;
  readonly platform: "win32-x64" | "linux-x64";
  readonly relativePath: string;
  readonly installRootSetting: string | null;
  readonly digestSetting: string;
  readonly digestAlgorithm: string;
  /** [B22-A2 review] coverage-4: the install root's entries the digest covers (plain names), or null for the whole tree. */
  readonly digestMembers: readonly string[] | null;
  readonly expectedDigest: ExpectedDigest;
}
/**
 * [B22-A2 review] coverage-7: the HOST program that runs a container profile's argv templates (the OCI engine's command-line
 * client). The runner takes it only from `pathSetting` (never PATH) and refuses it unless the file's SHA-256 equals the digest
 * read from `digestSetting`. Null on a local profile, whose executable is itself the host program.
 */
export interface HostClientBinding {
  readonly program: string;
  readonly pathSetting: string;
  readonly digestSetting: string;
  readonly digestAlgorithm: "sha256-file";
  readonly expectedDigest: ExpectedDigest;
  readonly configuration: string;
}
export interface PathPolicy { readonly path: string; readonly access: "read-only" | "read-write"; readonly scope: "per-run"; readonly enforcedBy: LimitEnforcement; readonly how: string }
/** [B22-A2 review] coverage-2: the input is read-only in every profile; the type admits nothing else. */
export interface InputMountPolicy extends PathPolicy { readonly access: "read-only" }
export interface DeterminismSetting { readonly value: string | null; readonly pinnedBy: "environment" | "deck-option" | "install-digest" | "image-digest" | "not-applicable" | "unpinned"; readonly note: string }
export interface OutputCheck { readonly id: string; readonly module: string | null; readonly wired: boolean; readonly note: string }
export type LegacyDeviation =
  | "executable-from-path-or-env"
  | "no-digest-check"
  | "host-environment-allowlist"
  | "home-and-userprofile-passed"
  | "no-locale-or-timezone"
  | "direct-child-kill"
  | "terminal-before-exit"
  | "unbounded-raw-read"
  | "run-directory-not-removed"
  | "shared-temp-cwd"
  | "caller-influenced-argv";
export interface LegacySpawn {
  readonly sites: readonly string[];
  readonly executableFrom: string;
  readonly argv: Readonly<Record<string, readonly string[]>>;
  readonly environment: { readonly mode: "host-allowlist"; readonly keys: readonly string[]; readonly plus: readonly string[] };
  readonly wallClock: string;
  readonly outputBound: string;
  readonly kill: string;
  readonly cwd: string;
  readonly deviations: readonly LegacyDeviation[];
}

/** [B22-A2] The profile: CD-10's environment (every field, same types) plus every runbook :892-904 binding. */
export interface RuntimeProfile extends Readonly<SimulationExecutionEnvironment> {
  readonly profileId: RuntimeProfileId;
  readonly revision: number;
  readonly executionBackendKind: Extract<SimulatorProviderDefinition["executionBackendKind"], "local_subprocess_diagnostic" | "container">;
  readonly authoritativeEligible: boolean;
  readonly executable: ExecutableBinding;
  readonly hostClient: HostClientBinding | null;
  readonly version: { readonly value: string | null; readonly basis: string };
  readonly provenance: { readonly origin: string; readonly integrity: string; readonly licence: string };
  readonly formats: { readonly input: readonly RuntimeFormat[]; readonly output: readonly RuntimeFormat[] };
  readonly argvTemplates: Readonly<Record<string, readonly string[]>>;
  readonly workingDirectory: string;
  readonly inputMount: InputMountPolicy;
  readonly outputDirectory: PathPolicy;
  readonly network: { readonly policy: "none"; readonly enforcedBy: LimitEnforcement; readonly how: string };
  readonly environment: Readonly<Record<string, string>>;
  readonly environmentInheritance: "none";
  readonly limits: Readonly<Record<LimitName, ProfileLimit>>;
  readonly determinism: { readonly locale: DeterminismSetting; readonly timeZone: DeterminismSetting; readonly seed: DeterminismSetting; readonly threads: DeterminismSetting };
  readonly kill: { readonly scope: "process-tree" | "container"; readonly how: string; readonly terminalAfter: "exit-observed-or-kill-unconfirmed"; readonly enforcedBy: LimitEnforcement };
  readonly parser: OutputCheck;
  readonly validator: OutputCheck;
  readonly qualificationEvidenceRefs: readonly string[];
  readonly legacySpawn: LegacySpawn | null;
}

/** [B22-A2] Every key a profile carries, closed (`executableOrImageDigest` only when the digest is pinned). */
export const RUNTIME_PROFILE_KEYS: readonly string[] = Object.freeze([
  "environmentId", "providerRevisionId", "executableOrImageDigest", "simulatorVersion", "operatingSystemAndArchitecture", "dependencyVersions",
  "localeAndTimeZone", "floatingPointAndThreadSettings", "environmentVariablesAllowlist", "resourceLimits", "networkPolicy", "sandboxPolicyRevisionId",
  "validationState", "deterministicDigest",
  "profileId", "revision", "executionBackendKind", "authoritativeEligible", "executable", "hostClient", "version", "provenance", "formats", "argvTemplates",
  "workingDirectory", "inputMount", "outputDirectory", "network", "environment", "environmentInheritance", "limits", "determinism", "kill", "parser",
  "validator", "qualificationEvidenceRefs", "legacySpawn",
]);
const NESTED_KEYS: Readonly<Record<string, readonly string[]>> = {
  resourceLimits: ["timeoutMs", "memoryMiB", "outputBytes", "processCount", "waveformPoints"],
  executable: ["kind", "program", "platform", "relativePath", "installRootSetting", "digestSetting", "digestAlgorithm", "digestMembers", "expectedDigest"],
  "executable.expectedDigest": ["state", "value", "reason"],
  hostClient: ["program", "pathSetting", "digestSetting", "digestAlgorithm", "expectedDigest", "configuration"],
  "hostClient.expectedDigest": ["state", "value", "reason"],
  version: ["value", "basis"],
  provenance: ["origin", "integrity", "licence"],
  formats: ["input", "output"],
  inputMount: ["path", "access", "scope", "enforcedBy", "how"],
  outputDirectory: ["path", "access", "scope", "enforcedBy", "how"],
  network: ["policy", "enforcedBy", "how"],
  limits: [...LIMIT_NAMES],
  determinism: ["locale", "timeZone", "seed", "threads"],
  kill: ["scope", "how", "terminalAfter", "enforcedBy"],
  parser: ["id", "module", "wired", "note"],
  validator: ["id", "module", "wired", "note"],
  legacySpawn: ["sites", "executableFrom", "argv", "environment", "wallClock", "outputBound", "kill", "cwd", "deviations"],
  "legacySpawn.environment": ["mode", "keys", "plus"],
  ...Object.fromEntries(LIMIT_NAMES.map((name) => [`limits.${name}`, ["enforcedBy", "value", "unit", "how"]])),
  ...Object.fromEntries(["locale", "timeZone", "seed", "threads"].map((name) => [`determinism.${name}`, ["value", "pinnedBy", "note"]])),
};

/** [B22-A2] A refused lookup: a closed code, never the requested id. */
export class RuntimeProfileError extends Error {
  readonly code: "RUNTIME_PROFILE_UNKNOWN";
  constructor(code: "RUNTIME_PROFILE_UNKNOWN") {
    super(`${code}: no runtime profile has that id`);
    this.name = "RuntimeProfileError";
    this.code = code;
  }
}

// ── the install-tree digest ──────────────────────────────────────────────────────────────────────────────────────────────

export const INSTALL_TREE_DIGEST_ALGORITHM = "sirkit-install-tree-sha256/1";
export interface InstallTreeDigest { readonly algorithm: string; readonly sha256: string; readonly fileCount: number; readonly totalBytes: number }
export type InstallTreeDigestErrorCode =
  | "INSTALL_TREE_ROOT_NOT_DIRECTORY"
  | "INSTALL_TREE_LINK"
  | "INSTALL_TREE_SPECIAL_FILE"
  | "INSTALL_TREE_CHANGED"
  | "INSTALL_TREE_MEMBER_MISSING"
  | "INSTALL_TREE_MEMBER_INVALID";
/** [B22-A2 review] coverage-4: `members` names the root's entries the identity covers (files or directories); null is the whole tree. */
export interface InstallTreeDigestOptions { readonly members?: readonly string[] | null }
export class InstallTreeDigestError extends Error {
  readonly code: InstallTreeDigestErrorCode;
  constructor(code: InstallTreeDigestErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "InstallTreeDigestError";
    this.code = code;
  }
}
const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const BACKSLASH = String.fromCharCode(92);
/** [B22-A2 review] coverage-4: one plain entry name - not empty, `.` or `..`, and no separator, drive colon or control character. */
function isPlainEntryName(name: unknown): name is string {
  if (typeof name !== "string" || name === "" || name === "." || name === "..") return false;
  return ![...name].some((character) => character === "/" || character === BACKSLASH || character === ":" || character.charCodeAt(0) < 32);
}

/**
 * The SHA-256 of one regular file, refused when it changed while it was read: the bytes read differ from the listed size, or a
 * re-stat after the read shows another type, size, modification time or file id ([B22-A2 review] coverage-6, tests-7). The stats
 * are bigint: a Windows file id exceeds 2^53, so a number id is rounded and two ids can compare equal. A same-size rewrite in place
 * that also restores the modification time is not detectable this way.
 */
async function fileSha256(path: string, listed: BigIntStats): Promise<string> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = chunk as Buffer;
    bytes += buffer.length;
    hash.update(buffer);
  }
  const after = await lstat(path, { bigint: true }).catch(() => null);
  const unchanged = after !== null && after.isFile() && BigInt(bytes) === listed.size && after.size === listed.size && after.mtimeNs === listed.mtimeNs && after.ino === listed.ino;
  if (!unchanged) throw new InstallTreeDigestError("INSTALL_TREE_CHANGED", "a file changed while it was hashed");
  return hash.digest("hex");
}

/**
 * [B22-A2] The identity of an install: SHA-256 over the algorithm line, then one JSON line `[relative POSIX path, size, per-file
 * SHA-256]` per regular file, sorted by path in code-unit order - so it is reproducible and independent of creation and listing
 * order, and one changed byte, a rename or an added file changes it. Fail-closed: a link anywhere (a symlink or a junction, which
 * could point outside the tree), a special file, a root that is not a directory, or a file whose read length, type, size,
 * modification time or file id changes while it is hashed is refused. Empty directories are not part of the identity. Server
 * configuration only: the root is the profile's install-root setting. [B22-A2 review] coverage-4: `members` restricts the identity
 * to those entries of the root (each must be listed there, exactly as named), so a file the setup rewrites beside them does not
 * move it; naming every entry gives the whole-tree digest.
 */
export async function installTreeDigest(root: string, options: InstallTreeDigestOptions = {}): Promise<InstallTreeDigest> {
  const members = options.members ?? null;
  if (members !== null && (!Array.isArray(members) || members.length === 0 || !members.every(isPlainEntryName) || new Set(members).size !== members.length)) {
    throw new InstallTreeDigestError("INSTALL_TREE_MEMBER_INVALID", "members must be distinct plain entry names of the install root");
  }
  const rootStat = await lstat(root).catch(() => null);
  if (rootStat === null || !rootStat.isDirectory()) throw new InstallTreeDigestError("INSTALL_TREE_ROOT_NOT_DIRECTORY", "the install root is not a directory");
  const entries: Array<readonly [string, number, string]> = [];
  const visit = async (full: string, relativePath: string): Promise<void> => {
    const stat = await lstat(full, { bigint: true });
    if (stat.isSymbolicLink()) throw new InstallTreeDigestError("INSTALL_TREE_LINK", `a link in the install tree: ${relativePath}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(full)).sort(byCodeUnits)) await visit(join(full, name), `${relativePath}/${name}`);
    } else if (stat.isFile()) entries.push([relativePath, Number(stat.size), await fileSha256(full, stat)] as const);
    else throw new InstallTreeDigestError("INSTALL_TREE_SPECIAL_FILE", `not a regular file: ${relativePath}`);
  };
  const listing = (await readdir(root)).sort(byCodeUnits);
  for (const name of members === null ? listing : [...members].sort(byCodeUnits)) {
    if (!listing.includes(name)) throw new InstallTreeDigestError("INSTALL_TREE_MEMBER_MISSING", `not an entry of the install root: ${name}`);
    await visit(join(root, name), name);
  }
  entries.sort((a, b) => byCodeUnits(a[0], b[0]));
  const hash = createHash("sha256");
  hash.update(`${INSTALL_TREE_DIGEST_ALGORITHM}\n`);
  for (const entry of entries) hash.update(`${JSON.stringify(entry)}\n`);
  return { algorithm: INSTALL_TREE_DIGEST_ALGORITHM, sha256: hash.digest("hex"), fileCount: entries.length, totalBytes: entries.reduce((sum, entry) => sum + entry[1], 0) };
}

// ── the registry ────────────────────────────────────────────────────────────────────────────────────────────────────────

const HEX64 = /^[0-9a-f]{64}$/;
const IMAGE_REFERENCE = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*@sha256:[0-9a-f]{64}$/;
/** A digest setting's value: 64 hex characters (an install tree or, for a host client, one file) or a digest-pinned image reference. */
function expectedDigestFrom(form: "sha256-hex" | "image-reference", raw: string | undefined): ExpectedDigest {
  const text = raw?.trim() ?? "";
  if (text === "") return { state: "unpinned", value: null, reason: "setting-absent" };
  const value = form === "sha256-hex" ? text.toLowerCase() : text;
  return (form === "sha256-hex" ? HEX64 : IMAGE_REFERENCE).test(value) ? { state: "pinned", value, reason: null } : { state: "unpinned", value: null, reason: "setting-malformed" };
}
function cd10Digest(executable: ExecutableBinding): string | undefined {
  const { expectedDigest } = executable;
  if (expectedDigest.state !== "pinned" || expectedDigest.value === null) return undefined;
  return executable.kind === "install-tree" ? `${INSTALL_TREE_DIGEST_ALGORITHM}:${expectedDigest.value}` : expectedDigest.value.slice(expectedDigest.value.indexOf("@") + 1);
}

const enforced = (enforcedBy: "os" | "runner", value: number, unit: ProfileLimit["unit"], how: string): ProfileLimit => ({ enforcedBy, value, unit, how });
const unenforced = (unit: ProfileLimit["unit"], how: string): ProfileLimit => ({ enforcedBy: "none", value: null, unit, how });
const NO_JOB_OBJECT = "no OS limit: Node sets none, and on Windows one needs a job object, which Sirkit does not use (no native dependency, OD-145)";
const LOCAL_TREE_KILL = { scope: "process-tree", how: "win32: taskkill /PID <pid> /T /F with a server-built argv; POSIX: a process-group kill (OD-145); on the wall clock and on abort", terminalAfter: "exit-observed-or-kill-unconfirmed", enforcedBy: "runner" } as const;
const LOCALE: DeterminismSetting = { value: "C", pinnedBy: "environment", note: "LC_ALL=C in the exact environment; a POSIX child reads it, while on Windows the C runtime reads the OS settings, so the effect on this host is INFERRED (discovery 9.5 item 22)" };
const TIME_ZONE: DeterminismSetting = { value: "UTC", pinnedBy: "environment", note: "TZ=UTC in the exact environment; it bounds what a child prints as a date (an ngspice rawfile's Date line, INFERRED)" };
const LOCAL_ENVIRONMENT = { LC_ALL: "C", TZ: "UTC", PATH: "{installBinDir}", SystemRoot: "{systemRoot}", TEMP: "{runDir}", TMP: "{runDir}" } as const;
const NGSPICE_PARSER: OutputCheck = { id: "ngspice-ascii-raw/1", module: "app/lib/spice/waveforms.ts", wired: true, note: "parseNgspiceAsciiRaw; it drops non-finite tokens (D22-10, B22-C)" };
const NGSPICE_VALIDATOR: OutputCheck = { id: "cd10-waveform-artifact/1", module: "app/lib/model-simulation/waveform.ts", wired: false, note: "createWaveformArtifact refuses a non-finite value and a non-increasing axis; no live path uses it yet (D22-10, B22-C)" };
const NGSPICE_SEED: DeterminismSetting = { value: "1", pinnedBy: "deck-option", note: "pinned by `.options seed=1` through the compiler's option lines (discovery 9.4: no screen change), emitted by the runner that executes this profile; no deck sets a seed today and the installed spinit leaves rndseed commented out (spinit:5), so the legacy default is UNKNOWN" };
const NGSPICE_LICENCE = "modified BSD overall; LGPL-2 for KLU, numparam and tclspice; GPL-2+ for some XSPICE and build files; CC-BY-SA-4.0 for parts of the documentation (discovery 1.2, RECORDED)";
const NGSPICE_LEGACY_ENV = ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "LD_LIBRARY_PATH"];
const LOCAL_DEVIATIONS: readonly LegacyDeviation[] = ["executable-from-path-or-env", "no-digest-check", "host-environment-allowlist", "home-and-userprofile-passed", "no-locale-or-timezone", "direct-child-kill"];

type ProfileBody = Omit<RuntimeProfile, "environmentId" | "environmentVariablesAllowlist" | "localeAndTimeZone" | "floatingPointAndThreadSettings" | "resourceLimits" | "executableOrImageDigest" | "deterministicDigest">;

function ngspiceLocal(read: ServerSettingReader): ProfileBody {
  return {
    profileId: "ngspice-local-diagnostic",
    revision: 1,
    providerRevisionId: diagnosticNgspiceProvider().deterministicDigest,
    simulatorVersion: "ngspice-46",
    operatingSystemAndArchitecture: "win32-x64",
    dependencyVersions: [],
    networkPolicy: "allowlisted",
    sandboxPolicyRevisionId: "b22-a2:local-process-no-os-isolation",
    validationState: "diagnostic_only",
    executionBackendKind: "local_subprocess_diagnostic",
    authoritativeEligible: false,
    executable: { kind: "install-tree", program: "ngspice_con", platform: "win32-x64", relativePath: "bin/ngspice_con.exe", installRootSetting: "SIRKIT_NGSPICE_INSTALL_ROOT", digestSetting: RUNTIME_PROFILE_DIGEST_SETTINGS["ngspice-local-diagnostic"], digestAlgorithm: INSTALL_TREE_DIGEST_ALGORITHM, digestMembers: null, expectedDigest: expectedDigestFrom("sha256-hex", read(RUNTIME_PROFILE_DIGEST_SETTINGS["ngspice-local-diagnostic"])) },
    hostClient: null,
    version: { value: "46", basis: "the install folder name and its bundled manual (INFERRED); the lead's SEC-1 probes ran this build (ngspice_con -b, KLU) and printed no version line; the runner's -v records the observed one" },
    provenance: { origin: "the owner's local Windows build of ngspice-46 (Spice64; the discovery records its path); ngspice's download page states no checksum or signature (discovery 1.2)", integrity: "none recorded: once the owner pins it, the install-tree digest in the server setting is the identity, and a mismatch refuses the run (OD-135)", licence: NGSPICE_LICENCE },
    formats: { input: ["ngspice-deck"], output: ["ngspice-ascii-raw", "text-log", "version-text"] },
    argvTemplates: { run: ["-b", "{deckFile}"], version: ["-v"] },
    workingDirectory: "{runDir}",
    inputMount: { path: "{runDir}", access: "read-only", scope: "per-run", enforcedBy: "none", how: "the server writes the deck into the per-run directory; a local process can still write there (no OS mount), so read-only is the runner's rule, never enforced" },
    outputDirectory: { path: "{runDir}", access: "read-write", scope: "per-run", enforcedBy: "runner", how: "one mkdtemp directory per run under the runner's one root, removed in finally; the process can still write wherever its user can (no OS isolation)" },
    network: { policy: "none", enforcedBy: "none", how: "no OS network denial for a local process; the deck screens refuse include, lib and XSPICE paths that could open a UNC share (SEC-1, B22-A1): prevention, not a boundary" },
    environment: { ...LOCAL_ENVIRONMENT },
    environmentInheritance: "none",
    limits: {
      cpuSeconds: unenforced("s", `${NO_JOB_OBJECT}; the wall clock bounds the run`),
      memoryMiB: unenforced("MiB", NO_JOB_OBJECT),
      processes: unenforced("count", `${NO_JOB_OBJECT}; the deck screens refuse every construct that runs a command (SEC-1, B22-A1): prevention, not a limit`),
      fileBytes: unenforced("bytes", "no OS file-size limit: the process may write files of any size into its directory; the runner reads none over readBackBytes"),
      readBackBytes: enforced("runner", 100 * 1024 * 1024, "bytes", "a bounded reader refuses a raw file over the bound unread; the legacy worker reads it whole, then checks its size (worker limits, D22-8)"),
      outputBytes: enforced("runner", DIAGNOSTIC_OUTPUT_MAX_BYTES, "bytes", "each of stdout and stderr is held and returned within DIAGNOSTIC_OUTPUT_MAX_BYTES (B22-A1)"),
      wallClockMs: enforced("runner", 120_000, "ms", "the runner's timer kills the process tree at the bound (the worker's 120 s; OD-145)"),
      waveformPoints: enforced("runner", 5_000_000, "points", "the run fails when the parsed raw file holds more points (the worker's bound)"),
    },
    determinism: { locale: LOCALE, timeZone: TIME_ZONE, seed: NGSPICE_SEED, threads: { value: "8", pinnedBy: "install-digest", note: "the installed spinit sets num_threads=8 (spinit:14, RECORDED); the install-tree digest covers spinit, so another value is another digest; whether this build runs OpenMP threads is INFERRED (libomp140 is bundled)" } },
    kill: { ...LOCAL_TREE_KILL },
    parser: NGSPICE_PARSER,
    validator: NGSPICE_VALIDATOR,
    qualificationEvidenceRefs: [],
    legacySpawn: {
      sites: ["app/lib/spice/server/worker.ts", "app/api/simulate/route.ts", "app/api/spice/models/smoke-test/route.ts"],
      executableFrom: "NGSPICE_BIN, else ngspice_con (win32) or ngspice on PATH; never digest-checked",
      argv: { run: ["-b", "<absolute deck path>"], version: ["-v"] },
      environment: { mode: "host-allowlist", keys: NGSPICE_LEGACY_ENV, plus: ["NODE_ENV"] },
      wallClock: "120 s (worker), 10 s (/api/simulate and the smoke test), 2 s (the worker's -v probe)",
      outputBound: "returned and recorded stdout and stderr within 64 KiB each (B22-A1, the worker and the smoke test; /api/simulate keeps 1 MB); the worker holds up to 100 MiB and reads the raw file whole (D22-8)",
      kill: "child.kill() with the default signal: the direct child only (D22-9)",
      cwd: "a per-run directory under the OS temp directory, never removed (worker); a removed mkdtemp directory (/api/simulate, the smoke test); the server's cwd (the -v probe)",
      deviations: [...LOCAL_DEVIATIONS, "terminal-before-exit", "unbounded-raw-read", "run-directory-not-removed"],
    },
  };
}

function ngspiceOci(read: ServerSettingReader): ProfileBody {
  const environment = { LC_ALL: "C", TZ: "UTC", PATH: "/usr/bin:/bin" } as const;
  return {
    profileId: "ngspice-oci",
    revision: 1,
    providerRevisionId: "unbound",
    simulatorVersion: "ngspice-47",
    operatingSystemAndArchitecture: "linux-x64",
    dependencyVersions: [],
    networkPolicy: "deny",
    sandboxPolicyRevisionId: "b22-a2:oci-flag-vector:1:unqualified",
    validationState: "unvalidated",
    executionBackendKind: "container",
    authoritativeEligible: false,
    executable: { kind: "oci-image", program: "ngspice", platform: "linux-x64", relativePath: "/usr/bin/ngspice", installRootSetting: null, digestSetting: RUNTIME_PROFILE_DIGEST_SETTINGS["ngspice-oci"], digestAlgorithm: "oci-image-manifest-sha256", digestMembers: null, expectedDigest: expectedDigestFrom("image-reference", read(RUNTIME_PROFILE_DIGEST_SETTINGS["ngspice-oci"])) },
    // [B22-A2 review] coverage-7: the argv templates below run on the host through this client, not inside the image
    hostClient: {
      program: "docker",
      pathSetting: OCI_HOST_CLIENT_SETTINGS.path,
      digestSetting: OCI_HOST_CLIENT_SETTINGS.digest,
      digestAlgorithm: "sha256-file",
      expectedDigest: expectedDigestFrom("sha256-hex", read(OCI_HOST_CLIENT_SETTINGS.digest)),
      configuration: "UNKNOWN until B22-A4: the CLI picks its engine from its context, DOCKER_HOST and its configuration directory (under the user profile on Windows), and its plugins sit beside it; B22-A4 pins the engine endpoint, the client's environment and its configuration",
    },
    version: { value: "47", basis: "OD-135's default: ngspice 47+ds-1 from a dated Debian snapshot (trixie-backports or forky); no image is built, so the version is the plan, UNKNOWN until B22-A4" },
    provenance: { origin: "an image built FROM debian:trixie-slim pinned by a digest re-resolved before use, installing ngspice 47+ds-1 from snapshot.debian.org at a recorded timestamp (OD-135); not built; run through the docker CLI of an owner-supplied engine (none reachable on this host)", integrity: "the image digest in the server setting; unpinned until the owner supplies an engine and B22-A4 builds and qualifies the image (pull by digest is immutable and takes no security update)", licence: NGSPICE_LICENCE },
    formats: { input: ["ngspice-deck"], output: ["ngspice-ascii-raw", "text-log"] },
    argvTemplates: {
      run: [
        "run", "--rm", "--init", "--name", "{containerName}", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--pids-limit", "64", "--memory", "1024m", "--memory-swap", "1024m", "--cpus", "1", "--ulimit", "cpu=120:120", "--user", "65534:65534",
        "--tmpfs", "/out:rw,noexec,nosuid,nodev,size=128m", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
        "--mount", "type=bind,source={inputDir},target=/in,readonly", "--workdir", "/out",
        "--env", "LC_ALL=C", "--env", "TZ=UTC", "--env", "PATH=/usr/bin:/bin",
        "{image}", "ngspice", "-b", "/in/deck.cir",
      ],
      kill: ["kill", "--signal", "KILL", "{containerName}"],
    },
    workingDirectory: "/out",
    inputMount: { path: "{inputDir}", access: "read-only", scope: "per-run", enforcedBy: "os", how: "a read-only bind mount at /in (designed; unqualified)" },
    outputDirectory: { path: "/out", access: "read-write", scope: "per-run", enforcedBy: "os", how: "a per-container tmpfs (rw, noexec, nosuid, nodev, 128m) on a read-only root filesystem, gone with the container (--rm); how its files reach the host is UNKNOWN until B22-A4 qualifies a transport (designed; unqualified)" },
    network: { policy: "none", enforcedBy: "os", how: "--network none: loopback only (designed; unqualified)" },
    environment: { ...environment },
    environmentInheritance: "none",
    limits: {
      cpuSeconds: enforced("os", 120, "s", "--ulimit cpu=120:120 (RLIMIT_CPU per process) beside --cpus 1 (designed; unqualified)"),
      memoryMiB: enforced("os", 1024, "MiB", "--memory 1024m --memory-swap 1024m, a cgroup limit that the tmpfs counts against (designed; unqualified)"),
      processes: enforced("os", 64, "count", "--pids-limit 64, the cgroup pids limit (designed; unqualified)"),
      fileBytes: enforced("os", 128 * 1024 * 1024, "bytes", "the /out tmpfs size=128m (designed; unqualified)"),
      readBackBytes: enforced("runner", 100 * 1024 * 1024, "bytes", "a bounded reader refuses a raw file over the bound unread, whatever transport B22-A4 qualifies"),
      outputBytes: enforced("runner", DIAGNOSTIC_OUTPUT_MAX_BYTES, "bytes", "no docker flag caps output (discovery 1.2): the runner holds and returns stdout and stderr within DIAGNOSTIC_OUTPUT_MAX_BYTES"),
      wallClockMs: enforced("runner", 120_000, "ms", "the runner's timer runs argvTemplates.kill; killing the docker CLI client does not stop the container (discovery 1.2)"),
      waveformPoints: enforced("runner", 5_000_000, "points", "the run fails when the parsed raw file holds more points"),
    },
    determinism: {
      locale: { value: "C", pinnedBy: "environment", note: "LC_ALL=C passed with --env; glibc in the image reads it (INFERRED until qualified)" },
      timeZone: { value: "UTC", pinnedBy: "environment", note: "TZ=UTC passed with --env (INFERRED until qualified)" },
      seed: NGSPICE_SEED,
      threads: { value: null, pinnedBy: "image-digest", note: "the packaged spinit's num_threads is UNKNOWN until the image is built; the image digest fixes it" },
    },
    kill: { scope: "container", how: "argvTemplates.kill (docker kill --signal KILL) then removal (--rm): every process in the container ends with it (designed; unqualified)", terminalAfter: "exit-observed-or-kill-unconfirmed", enforcedBy: "runner" },
    parser: NGSPICE_PARSER,
    validator: NGSPICE_VALIDATOR,
    qualificationEvidenceRefs: [],
    legacySpawn: null,
  };
}

function kicadCli(read: ServerSettingReader): ProfileBody {
  return {
    profileId: "kicad-cli-local-diagnostic",
    revision: 1,
    providerRevisionId: "unbound",
    simulatorVersion: "kicad-cli (version UNKNOWN)",
    operatingSystemAndArchitecture: "win32-x64",
    dependencyVersions: [],
    networkPolicy: "allowlisted",
    sandboxPolicyRevisionId: "b22-a2:local-process-no-os-isolation",
    validationState: "diagnostic_only",
    executionBackendKind: "local_subprocess_diagnostic",
    authoritativeEligible: false,
    executable: { kind: "install-tree", program: "kicad-cli", platform: "win32-x64", relativePath: "bin/kicad-cli.exe", installRootSetting: "SIRKIT_KICAD_CLI_INSTALL_ROOT", digestSetting: RUNTIME_PROFILE_DIGEST_SETTINGS["kicad-cli-local-diagnostic"], digestAlgorithm: INSTALL_TREE_DIGEST_ALGORITHM, digestMembers: null, expectedDigest: expectedDigestFrom("sha256-hex", read(RUNTIME_PROFILE_DIGEST_SETTINGS["kicad-cli-local-diagnostic"])) },
    hostClient: null,
    version: { value: null, basis: "KiCad 8.x or newer per .env.example; kicad-cli was never run here, so the installed version is UNKNOWN" },
    provenance: { origin: "an owner-installed KiCad, found today through KICAD_CLI or PATH; no install is recorded on this host", integrity: "none: the install-tree digest in the server setting, once pinned", licence: "not recorded (KiCad's licence was not read in B22)" },
    formats: { input: ["kicad-pcb"], output: ["gerber", "excellon", "text-log"] },
    argvTemplates: {
      "export-gerbers": ["pcb", "export", "gerbers", "{boardFile}", "--output", "{gerberDir}", "--layers", "{layerList}"],
      "export-drill": ["pcb", "export", "drill", "{boardFile}", "--output", "{drillDir}", "--format", "excellon", "--excellon-units", "{excellonUnits}", "--excellon-zeros-format", "decimal", "--drill-origin", "absolute"],
      "export-drill-separate-th": ["pcb", "export", "drill", "{boardFile}", "--output", "{drillDir}", "--format", "excellon", "--excellon-units", "{excellonUnits}", "--excellon-zeros-format", "decimal", "--drill-origin", "absolute", "--excellon-separate-th"],
    },
    workingDirectory: "{runDir}",
    inputMount: { path: "{runDir}", access: "read-only", scope: "per-run", enforcedBy: "none", how: "the server writes the board into the per-run directory; a local process can still write there (no OS mount)" },
    outputDirectory: { path: "{runDir}", access: "read-write", scope: "per-run", enforcedBy: "runner", how: "one mkdtemp directory per build (the fab bundle's sirkit-fab-), removed in finally; no OS isolation" },
    network: { policy: "none", enforcedBy: "none", how: "no OS network denial for a local process" },
    environment: { ...LOCAL_ENVIRONMENT, KICAD_CONFIG_HOME: "{runDir}" },
    environmentInheritance: "none",
    limits: {
      cpuSeconds: unenforced("s", `${NO_JOB_OBJECT}; the wall clock bounds each invocation`),
      memoryMiB: unenforced("MiB", NO_JOB_OBJECT),
      processes: unenforced("count", NO_JOB_OBJECT),
      fileBytes: unenforced("bytes", "no OS file-size limit: the process may write files of any size; the runner reads none over readBackBytes"),
      readBackBytes: enforced("runner", TOOL_OUTPUT_FILE_MAX_BYTES, "bytes", "the fab bundle reads every gerber and drill file through the bounded reader and refuses one over the bound unread (B22-A1)"),
      outputBytes: enforced("runner", DIAGNOSTIC_OUTPUT_MAX_BYTES, "bytes", "each stream is held to twice the bound and returned within DIAGNOSTIC_OUTPUT_MAX_BYTES (B22-A1)"),
      wallClockMs: enforced("runner", 60_000, "ms", "60 s per invocation (the fab bundle's CLI_TIMEOUT_MS), then a tree kill (OD-145)"),
      waveformPoints: unenforced("points", "not applicable: kicad-cli writes no waveform"),
    },
    determinism: { locale: LOCALE, timeZone: TIME_ZONE, seed: { value: null, pinnedBy: "not-applicable", note: "plotting takes no seed; whether kicad-cli's output is byte-stable for one input is INFERRED (never run here)" }, threads: { value: null, pinnedBy: "unpinned", note: "kicad-cli's thread use is not set (UNKNOWN)" } },
    kill: { ...LOCAL_TREE_KILL },
    parser: { id: "none", module: null, wired: false, note: "the gerber and drill files are zipped as produced, through the bounded reader; nothing parses them" },
    validator: { id: "native-gerber-and-xnc-parsers", module: "app/lib/pcb/fab/native/gerber-parser.ts", wired: false, note: "the native gerber and XNC parsers (native/gerber-parser.ts, native/xnc-parser.ts) exist but are not applied to kicad-cli's files (RECORDED)" },
    qualificationEvidenceRefs: [],
    legacySpawn: {
      sites: ["app/lib/pcb/fab/kicad-cli-runner.ts", "app/lib/pcb/fab/build-bundle.ts"],
      executableFrom: "KICAD_CLI, else kicad-cli on PATH; never digest-checked",
      argv: {
        "export-gerbers": ["pcb", "export", "gerbers", "<build dir>/<sanitized board name>.kicad_pcb", "--output", "<build dir>/gerbers", "--layers", "<preset layers>"],
        "export-drill": ["pcb", "export", "drill", "<build dir>/<sanitized board name>.kicad_pcb", "--output", "<build dir>/drill", "--format", "excellon", "--excellon-units", "<preset units>", "--excellon-zeros-format", "decimal", "--drill-origin", "absolute", "[--excellon-separate-th]"],
      },
      environment: { mode: "host-allowlist", keys: ["PATH", "Path", "PATHEXT", "SystemRoot", "SystemDrive", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "LANG", "LD_LIBRARY_PATH", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "KICAD_CONFIG_HOME"], plus: ["NODE_ENV"] },
      wallClock: "60 s per invocation (CLI_TIMEOUT_MS)",
      outputBound: "each stream held to twice 64 KiB and returned within 64 KiB; gerber and drill files read through the 64 MiB bounded reader (B22-A1)",
      kill: "SIGKILL of the direct child on timeout; the result resolves before the process exits (D22-9)",
      cwd: "the per-build mkdtemp directory (sirkit-fab-), removed in finally",
      deviations: [...LOCAL_DEVIATIONS, "terminal-before-exit", "caller-influenced-argv"],
    },
  };
}

function freerouting(read: ServerSettingReader): ProfileBody {
  return {
    profileId: "freerouting-local-diagnostic",
    revision: 1,
    providerRevisionId: "unbound",
    simulatorVersion: "freerouting-2.2.4",
    operatingSystemAndArchitecture: "win32-x64",
    dependencyVersions: [],
    networkPolicy: "allowlisted",
    sandboxPolicyRevisionId: "b22-a2:local-process-no-os-isolation",
    validationState: "diagnostic_only",
    executionBackendKind: "local_subprocess_diagnostic",
    authoritativeEligible: false,
    // [B22-A2 review] coverage-4: the digest covers the JAR and the JRE only - setup rewrites sirkit-runtime.json (with the time of
    // the run) beside them in the same root on every run, and the JRE archive stays there too
    executable: { kind: "install-tree", program: "java", platform: "win32-x64", relativePath: "jdk-25.0.3+9-jre/bin/java.exe", installRootSetting: "SIRKIT_FREEROUTING_INSTALL_ROOT", digestSetting: RUNTIME_PROFILE_DIGEST_SETTINGS["freerouting-local-diagnostic"], digestAlgorithm: INSTALL_TREE_DIGEST_ALGORITHM, digestMembers: ["freerouting-2.2.4.jar", "jdk-25.0.3+9-jre"], expectedDigest: expectedDigestFrom("sha256-hex", read(RUNTIME_PROFILE_DIGEST_SETTINGS["freerouting-local-diagnostic"])) },
    hostClient: null,
    version: { value: "2.2.4", basis: "FREEROUTING_VERSION 2.2.4 with the Temurin JRE 25.0.3+9 (app/lib/pcb/autoroute/runtime.ts)" },
    provenance: { origin: "scripts/setup-freerouting.ps1 downloads the 2.2.4 JAR and the Temurin JRE into vendor/freerouting/runtime", integrity: "install-time SHA-256 pins for the JAR and the JRE archive (setup-freerouting.ps1); at run time only existence is checked and operator overrides win (runtime.ts); the digest of the JAR and the JRE directory in the server setting, once pinned", licence: "not recorded (FreeRouting's and the JRE's licences were not read in B22)" },
    formats: { input: ["specctra-dsn"], output: ["specctra-ses", "text-log"] },
    argvTemplates: {
      route: ["-Djava.awt.headless=true", "-Dlog4j2.disableJndi=true", "-jar", "{jarFile}", "--gui.enabled=false", "--api_server.enabled=false", "--logging.file.enabled=false", "--logging.console.level=WARN", "-da", "-de", "{dsnFile}", "-do", "{sesFile}", "-mp", "{enginePasses}"],
    },
    workingDirectory: "{runDir}",
    inputMount: { path: "{runDir}", access: "read-only", scope: "per-run", enforcedBy: "none", how: "the server writes the DSN into the per-run directory; a local process can still write there (no OS mount)" },
    outputDirectory: { path: "{runDir}", access: "read-write", scope: "per-run", enforcedBy: "runner", how: "one mkdtemp directory per run, removed in finally; today the runner uses the shared OS temp directory (D22-8)" },
    network: { policy: "none", enforcedBy: "none", how: "no OS network denial for a local process; FreeRouting's API server and GUI are switched off by argv" },
    environment: { ...LOCAL_ENVIRONMENT },
    environmentInheritance: "none",
    limits: {
      cpuSeconds: unenforced("s", `${NO_JOB_OBJECT}; the wall clock bounds the run`),
      memoryMiB: unenforced("MiB", `${NO_JOB_OBJECT}; no -Xmx is passed either (discovery 2.3)`),
      processes: unenforced("count", NO_JOB_OBJECT),
      fileBytes: unenforced("bytes", "no OS file-size limit: the process may write files of any size; the runner reads none over readBackBytes"),
      readBackBytes: enforced("runner", TOOL_OUTPUT_FILE_MAX_BYTES, "bytes", "the session file is read through the bounded reader and refused over the bound unread (B22-A1)"),
      outputBytes: enforced("runner", DIAGNOSTIC_OUTPUT_MAX_BYTES, "bytes", "the joined diagnostics are returned within DIAGNOSTIC_OUTPUT_MAX_BYTES, stderr keeping its own share (B22-A1)"),
      wallClockMs: enforced("runner", 300_000, "ms", "the runner's 300 s default (callers pass their own deadline), then a tree kill (OD-145)"),
      waveformPoints: unenforced("points", "not applicable: FreeRouting writes no waveform"),
    },
    determinism: { locale: LOCALE, timeZone: TIME_ZONE, seed: { value: null, pinnedBy: "unpinned", note: "no seed option is passed; whether FreeRouting's router is deterministic for one input is UNKNOWN" }, threads: { value: null, pinnedBy: "unpinned", note: "FreeRouting's thread count is not set (UNKNOWN)" } },
    kill: { ...LOCAL_TREE_KILL },
    parser: { id: "specctra-ses/1", module: "app/lib/pcb/dsn/read-ses.ts", wired: true, note: "parseSes, the strict session parser the production router applies" },
    validator: { id: "autoroute-candidate/1", module: "app/lib/pcb/autoroute/verification.ts", wired: true, note: "buildAutorouteCandidate rebuilds the routed board from the parsed session (protected copper preserved), independent of FreeRouting's own checks" },
    qualificationEvidenceRefs: [],
    legacySpawn: {
      sites: ["app/lib/pcb/autoroute/runner.ts", "app/lib/pcb/autoroute/runtime.ts"],
      executableFrom: "FREEROUTING_JAVA, JAVA_HOME, the bundled JRE, else java on PATH; the JAR from FREEROUTING_JAR, the bundled release, else the source-build JAR vendor/freerouting/build/libs/freerouting-current-executable.jar; every candidate but the bundled release and JRE lies outside the install root the profile digests; existence-checked only (runtime.ts:59-69, :94-97, :104-115, :119-126)",
      argv: { route: ["-Djava.awt.headless=true", "-Dlog4j2.disableJndi=true", "-jar", "<jar path>", "--gui.enabled=false", "--api_server.enabled=false", "--logging.file.enabled=false", "--logging.console.level=WARN", "-da", "-de", "<dsn path>", "-do", "<ses path>", "-mp", "<passes>"] },
      environment: { mode: "host-allowlist", keys: ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "LANG"], plus: ["NODE_ENV"] },
      wallClock: "300 s default (runner.ts); the autoroute route and the pass executor pass their own deadline",
      outputBound: "the joined diagnostics within 64 KiB, stderr keeping its own share; the session file read through the 64 MiB bounded reader (B22-A1)",
      kill: "SIGKILL of the direct child on abort and on timeout; the result resolves before the process exits (D22-9)",
      cwd: "the shared OS temp directory, with uuid-named input and output files there (D22-8)",
      deviations: [...LOCAL_DEVIATIONS, "terminal-before-exit", "shared-temp-cwd", "caller-influenced-argv"],
    },
  };
}

const BUILDERS: Readonly<Record<RuntimeProfileId, (read: ServerSettingReader) => ProfileBody>> = Object.freeze({
  "ngspice-local-diagnostic": ngspiceLocal,
  "ngspice-oci": ngspiceOci,
  "kicad-cli-local-diagnostic": kicadCli,
  "freerouting-local-diagnostic": freerouting,
});

/** Canonical JSON (object keys sorted by code unit), the input of a profile's SHA-256 identity. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort(byCodeUnits).map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
function profileDigest(profile: object): string {
  const rest: Record<string, unknown> = { ...(profile as Record<string, unknown>) };
  delete rest.deterministicDigest;
  return createHash("sha256").update(`sirkit.runtime-profile.v1\n${canonical(rest)}`).digest("hex");
}

/** Freezes every object and array inside `value`. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
/** [B22-A2] Whether every object and array inside `value` is frozen. */
export function isDeepFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen);
}

function build(id: RuntimeProfileId, read: ServerSettingReader): RuntimeProfile {
  const body = BUILDERS[id](read);
  const limits = body.limits;
  const digest = cd10Digest(body.executable);
  const draft = {
    ...body,
    environmentId: `runtime-profile:${id}:${body.revision}`,
    environmentVariablesAllowlist: Object.keys(body.environment).sort(byCodeUnits),
    localeAndTimeZone: `LC_ALL=${body.environment.LC_ALL};TZ=${body.environment.TZ}`,
    floatingPointAndThreadSettings: [
      `seed=${body.determinism.seed.value ?? "unpinned"} (${body.determinism.seed.pinnedBy})`,
      `num_threads=${body.determinism.threads.value ?? "unpinned"} (${body.determinism.threads.pinnedBy})`,
    ],
    resourceLimits: { timeoutMs: limits.wallClockMs.value ?? 0, memoryMiB: limits.memoryMiB.value ?? 0, outputBytes: limits.outputBytes.value ?? 0, processCount: limits.processes.value ?? 0, waveformPoints: limits.waveformPoints.value ?? 0 },
    ...(digest === undefined ? {} : { executableOrImageDigest: digest }),
  };
  const profile = deepFreeze({ ...draft, deterministicDigest: profileDigest(draft) }) as RuntimeProfile;
  const violations = runtimeProfileViolations(profile);
  if (violations.length > 0) throw new Error(`B22-A2 runtime profile ${id} breaks its contract: ${violations.join(", ")}`);
  return profile;
}

/**
 * [B22-A2] The frozen profile for `id`, its expected digest read from the profile's named server setting (unpinned when the
 * setting is absent or malformed). Any other id is refused with a closed `RUNTIME_PROFILE_UNKNOWN` error that never echoes it.
 */
export function runtimeProfile(id: string, read: ServerSettingReader = readServerSetting): RuntimeProfile {
  if (typeof id !== "string" || !(RUNTIME_PROFILE_IDS as readonly string[]).includes(id)) throw new RuntimeProfileError("RUNTIME_PROFILE_UNKNOWN");
  return build(id as RuntimeProfileId, read);
}
/** [B22-A2] Every registry profile, in registry order. */
export function runtimeProfiles(read: ServerSettingReader = readServerSetting): readonly RuntimeProfile[] {
  return Object.freeze(RUNTIME_PROFILE_IDS.map((id) => build(id, read)));
}

// ── the contract validator ──────────────────────────────────────────────────────────────────────────────────────────────

const PLACEHOLDER = /\{[^{}]*\}/g;
const EXPANSION = /[{}$%`]/;
const FORBIDDEN_ENV_KEYS = /^(home|userprofile|homedrive|homepath)$/i;
const SECRET_ENV_KEYS = /key|token|secret|password|database|supabase|openai|anthropic/i;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** A templated string's own violations: an unnamed placeholder is a caller slot; a variable or stray brace is an expansion. */
function templateViolations(text: unknown, where: string, prefix: "ARGV" | "ENV"): string[] {
  if (typeof text !== "string") return [`RUNTIME_PROFILE_${prefix}_NOT_STRING:${where}`];
  const out: string[] = [];
  for (const token of text.match(PLACEHOLDER) ?? []) if (!Object.prototype.hasOwnProperty.call(SERVER_NAMED_PLACEHOLDERS, token)) out.push(`RUNTIME_PROFILE_${prefix}_CALLER_SLOT:${where}`);
  if (EXPANSION.test(text.replace(PLACEHOLDER, ""))) out.push(`RUNTIME_PROFILE_${prefix}_EXPANSION:${where}`);
  return out;
}

/** An expected digest's shape: pinned with a value and no reason, or unpinned with no value and a closed reason. */
function digestShapeOk(digest: unknown): boolean {
  if (!isRecord(digest)) return false;
  const { state, value, reason } = digest;
  return state === "pinned" ? typeof value === "string" && reason === null : state === "unpinned" && value === null && (reason === "setting-absent" || reason === "setting-malformed");
}

/** [B22-A2 review] security-1, security-2: the docker options a container `run` may hold before `{image}` - long forms only, each
 *  once unless it repeats. Anything else (a short flag, an `=` form, an env file, a volume, a privilege, a capability) is refused. */
const OCI_RUN_OPTIONS = new Map<string, { readonly value: boolean; readonly repeat: boolean }>([
  ...["--rm", "--init", "--read-only"].map((flag) => [flag, { value: false, repeat: false }] as const),
  ...["--name", "--network", "--cap-drop", "--security-opt", "--pids-limit", "--memory", "--memory-swap", "--cpus", "--user", "--mount", "--workdir"].map((option) => [option, { value: true, repeat: false }] as const),
  ...["--ulimit", "--tmpfs", "--env"].map((option) => [option, { value: true, repeat: true }] as const),
]);
const OCI_KILL = ["kill", "--signal", "KILL", "{containerName}"];
const OCI_OPERATIONS = "kill,run";
const TMPFS_REQUIRED = ["noexec", "nosuid", "nodev"];
const TMPFS_ALLOWED = ["rw", ...TMPFS_REQUIRED];
const NON_ROOT_USER = /^[1-9][0-9]*:[1-9][0-9]*$/;
const POSITIVE_DECIMAL = /^(?:[1-9][0-9]*(?:\.[0-9]+)?|0\.[0-9]*[1-9][0-9]*)$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SETTING_NAME = /^[A-Z][A-Z0-9_]*$/;
const MEBIBYTE = 1024 * 1024;
const DOCKER_UNITS: Readonly<Record<string, number>> = { "": 1, k: 1024, m: MEBIBYTE, g: 1024 * MEBIBYTE };
/** A docker size (`65536`, `128m`, `1g`) in bytes; null for anything else. */
function dockerBytes(text: string | undefined): number | null {
  const match = /^([1-9][0-9]*)([kmg]?)$/.exec(text ?? "");
  return match === null ? null : Number(match[1]) * DOCKER_UNITS[match[2]!]!;
}

/**
 * [B22-A2 review] security-1, security-2, coverage-1, tests-2: a container profile's docker argv, read by a closed grammar: exactly
 * the `run` and `kill` operations; `run`, its options up to the one `{image}`, then the profile's program. The isolation baseline is
 * required (every capability dropped, no new privileges, a non-root user and group, a CPU share); `--env` only as KEY=VALUE, passing
 * exactly the environment; every `os` claim tied to the flag that delivers it, and a claim no flag delivers refused; any mount the
 * read-only input bind; the container kill needs `--rm`, the server's container name and the kill argv.
 */
function ociRunViolations(p: RuntimeProfile): string[] {
  const out: string[] = [];
  const templates: Record<string, unknown> = isRecord(p.argvTemplates) ? p.argvTemplates : {};
  if (Object.keys(templates).sort(byCodeUnits).join(",") !== OCI_OPERATIONS) out.push("RUNTIME_PROFILE_OCI_OPERATIONS");
  const run = Array.isArray(templates.run) ? templates.run.map(String) : [];
  if (run[0] !== "run") out.push("RUNTIME_PROFILE_OCI_SUBCOMMAND");
  const imageAt = run.indexOf("{image}");
  if (imageAt < 0 || run.lastIndexOf("{image}") !== imageAt) out.push("RUNTIME_PROFILE_OCI_IMAGE");
  else if (run[imageAt + 1] !== (isRecord(p.executable) ? p.executable.program : undefined)) out.push("RUNTIME_PROFILE_OCI_COMMAND");
  // the options, up to the image
  const end = imageAt < 0 ? run.length : imageAt;
  const values = new Map<string, string[]>();
  for (let index = 1; index < end; index += 1) {
    const token = run[index]!;
    const equals = token.indexOf("=");
    const option = OCI_RUN_OPTIONS.get(token);
    if (!token.startsWith("-")) out.push("RUNTIME_PROFILE_OCI_OPTION_REFUSED:operand");
    else if (!token.startsWith("--")) out.push(`RUNTIME_PROFILE_OCI_OPTION_REFUSED:${token.slice(0, 2)}`);
    else if (equals >= 0) out.push(`RUNTIME_PROFILE_OCI_OPTION_REFUSED:${token.slice(0, equals + 1)}`);
    else if (option === undefined) out.push(`RUNTIME_PROFILE_OCI_OPTION_REFUSED:${token}`);
    else {
      const seen = values.get(token) ?? [];
      if (seen.length > 0 && !option.repeat) out.push(`RUNTIME_PROFILE_OCI_OPTION_REPEATED:${token}`);
      if (!option.value) values.set(token, [...seen, ""]);
      else if (index + 1 >= end) out.push(`RUNTIME_PROFILE_OCI_OPTION_VALUE:${token}`);
      else {
        index += 1;
        values.set(token, [...seen, run[index]!]);
      }
    }
  }
  const one = (option: string): string | undefined => {
    const list = values.get(option);
    return list?.length === 1 ? list[0] : undefined;
  };
  // the isolation baseline
  if (one("--cap-drop") !== "ALL") out.push("RUNTIME_PROFILE_OCI_FLAG_REQUIRED:--cap-drop");
  if (one("--security-opt") !== "no-new-privileges") out.push("RUNTIME_PROFILE_OCI_FLAG_REQUIRED:--security-opt");
  if (!NON_ROOT_USER.test(one("--user") ?? "")) out.push("RUNTIME_PROFILE_OCI_FLAG_REQUIRED:--user");
  if (!POSITIVE_DECIMAL.test(one("--cpus") ?? "")) out.push("RUNTIME_PROFILE_OCI_FLAG_REQUIRED:--cpus");
  // the environment: --env KEY=VALUE only (a bare NAME would copy the docker CLI's own variable), exactly the profile's map
  const passed = Object.create(null) as Record<string, string>;
  for (const pair of values.get("--env") ?? []) {
    const key = pair.slice(0, Math.max(pair.indexOf("="), 0));
    if (!ENV_NAME.test(key) || Object.prototype.hasOwnProperty.call(passed, key)) out.push("RUNTIME_PROFILE_OCI_ENV_FORM");
    else passed[key] = pair.slice(key.length + 1);
  }
  if (canonical(passed) !== canonical(isRecord(p.environment) ? p.environment : {})) out.push("RUNTIME_PROFILE_OCI_ENV_MISMATCH");
  // every os claim and the flag that delivers it
  const claim = (name: string, holds: boolean): void => {
    if (!holds) out.push(`RUNTIME_PROFILE_OCI_FLAG_CLAIM:${name}`);
  };
  const os = (policy: unknown): boolean => isRecord(policy) && policy.enforcedBy === "os";
  if (os(p.network)) claim("network", one("--network") === "none");
  const output: Record<string, unknown> = isRecord(p.outputDirectory) ? p.outputDirectory : {};
  const tmpfs = (values.get("--tmpfs") ?? []).map((value) => {
    const colon = value.indexOf(":");
    const options = colon < 0 ? [] : value.slice(colon + 1).split(",");
    const sizes = options.filter((option) => option.startsWith("size="));
    const hardened = TMPFS_REQUIRED.every((flag) => options.includes(flag)) && options.every((option) => TMPFS_ALLOWED.includes(option) || option.startsWith("size=") || option.startsWith("mode="));
    return { target: colon < 0 ? value : value.slice(0, colon), bytes: sizes.length === 1 ? dockerBytes(sizes[0]!.slice("size=".length)) : null, hardened };
  });
  const outputTmpfs = tmpfs.filter((mount) => mount.target === output.path);
  if (os(p.outputDirectory)) {
    // a read-only root, the working directory on the output tmpfs, every tmpfs noexec, nosuid, nodev and bounded
    claim("outputDirectory", values.has("--read-only") && one("--workdir") === output.path && outputTmpfs.length === 1 && new Set(tmpfs.map((mount) => mount.target)).size === tmpfs.length && tmpfs.every((mount) => mount.hardened && mount.bytes !== null));
  }
  const ulimits = values.get("--ulimit") ?? [];
  const ulimitNames = ulimits.map((value) => value.slice(0, Math.max(value.indexOf("="), 0)));
  if (new Set(ulimitNames).size !== ulimitNames.length) out.push("RUNTIME_PROFILE_OCI_OPTION_REPEATED:--ulimit");
  const ties: Partial<Record<LimitName, (value: unknown) => boolean>> = {
    cpuSeconds: (value) => ulimits.filter((entry) => entry.startsWith("cpu=")).join(",") === `cpu=${String(value)}:${String(value)}`,
    memoryMiB: (value) => typeof value === "number" && dockerBytes(one("--memory")) === value * MEBIBYTE && dockerBytes(one("--memory-swap")) === value * MEBIBYTE,
    processes: (value) => one("--pids-limit") === String(value),
    fileBytes: (value) => outputTmpfs.length === 1 && outputTmpfs[0]!.bytes === value,
  };
  const limits: Record<string, unknown> = isRecord(p.limits) ? p.limits : {};
  for (const name of LIMIT_NAMES) {
    const limit = limits[name];
    if (isRecord(limit) && limit.enforcedBy === "os") claim(name, ties[name]?.(limit.value) === true);
  }
  // the one mount: the read-only bind of the per-run input directory, never at the root or the output directory
  const mounts = values.get("--mount") ?? [];
  if (os(p.inputMount) || mounts.length > 0) {
    const fields = mounts.length === 1 ? mounts[0]!.split(",") : [];
    const field = (key: string): string | undefined => fields.find((entry) => entry.startsWith(`${key}=`))?.slice(key.length + 1);
    const target = field("target") ?? "";
    const keys = fields.map((entry) => entry.split("=")[0]).sort(byCodeUnits).join(",");
    const input: Record<string, unknown> = isRecord(p.inputMount) ? p.inputMount : {};
    claim("inputMount", keys === "readonly,source,target,type" && fields.includes("readonly") && field("type") === "bind" && field("source") === input.path && target.startsWith("/") && target !== "/" && target !== output.path);
  }
  // the container kill: removed on exit, addressed by the server's container name, ended by the kill argv
  const kill: Record<string, unknown> = isRecord(p.kill) ? p.kill : {};
  claim("kill", kill.scope === "container" && values.has("--rm") && one("--name") === "{containerName}" && canonical(templates.kill) === canonical(OCI_KILL));
  return out;
}

/** [B22-A2 review] coverage-7: a host client binding's own shape (closed keys are checked with the profile's). */
function hostClientOk(client: Record<string, unknown>): boolean {
  return typeof client.program === "string" && client.program.trim() !== "" && typeof client.pathSetting === "string" && SETTING_NAME.test(client.pathSetting) && typeof client.digestSetting === "string" && SETTING_NAME.test(client.digestSetting) && client.pathSetting !== client.digestSetting && client.digestAlgorithm === "sha256-file" && digestShapeOk(client.expectedDigest) && typeof client.configuration === "string" && client.configuration.trim().length >= 10;
}

/**
 * [B22-A2] Every way `candidate` breaks the profile contract, as closed codes (empty when it holds): closed keys at every level, a
 * known id, argv templates and the working directory with server-named placeholders only, the exact environment (LC_ALL=C, TZ=UTC,
 * no HOME/USERPROFILE in any case, no secret-shaped key, never inherited, the CD-10 allowlist its keys), every limit with
 * `enforcedBy`, a value exactly when enforced, the right unit and a reason, no OS limit claimed by a local process, CD-10's
 * resourceLimits in agreement, network deny only when the OS enforces it, `validated` only with qualification evidence and a pinned
 * digest (and a pinned host client), authoritative eligibility only for a validated container profile, the pinned digest and its
 * CD-10 copy in agreement, and the SHA-256 identity over every other field. [B22-A2 review] Also: the input mount read-only; digest
 * members only on an install tree, plain, distinct and covering the executable; a host client on a container profile and on no other;
 * and a container profile's docker argv read by a closed grammar with every `os` claim tied to its flag (`ociRunViolations`).
 */
export function runtimeProfileViolations(candidate: unknown): string[] {
  if (!isRecord(candidate)) return ["RUNTIME_PROFILE_NOT_OBJECT"];
  const out: string[] = [];
  const keysAt = (value: unknown, path: string, allowed: readonly string[], optional: readonly string[] = []): void => {
    if (!isRecord(value)) { out.push(`RUNTIME_PROFILE_NOT_OBJECT:${path}`); return; }
    for (const key of Object.keys(value)) if (!allowed.includes(key)) out.push(`RUNTIME_PROFILE_UNKNOWN_KEY:${path}.${key}`);
    for (const key of allowed) if (!optional.includes(key) && !Object.prototype.hasOwnProperty.call(value, key)) out.push(`RUNTIME_PROFILE_MISSING_KEY:${path}.${key}`);
  };
  keysAt(candidate, "profile", RUNTIME_PROFILE_KEYS, ["executableOrImageDigest"]);
  const at = (path: string): unknown => path.split(".").reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), candidate);
  for (const [path, allowed] of Object.entries(NESTED_KEYS)) {
    // a nullable binding (legacySpawn, hostClient) has closed keys only when present
    const root = path.split(".")[0]!;
    if ((root !== "legacySpawn" && root !== "hostClient") || candidate[root] !== null) keysAt(at(path), `profile.${path}`, allowed);
  }
  const p = candidate as unknown as RuntimeProfile;
  if (!(RUNTIME_PROFILE_IDS as readonly string[]).includes(p.profileId as string)) out.push("RUNTIME_PROFILE_UNKNOWN_ID");
  // argv: server-named placeholders only
  if (isRecord(p.argvTemplates)) {
    for (const [operation, template] of Object.entries(p.argvTemplates)) {
      if (!Array.isArray(template) || template.length === 0) { out.push(`RUNTIME_PROFILE_ARGV_EMPTY:${operation}`); continue; }
      out.push(...[...new Set(template.flatMap((element) => templateViolations(element, operation, "ARGV")))]);
    }
  }
  out.push(...templateViolations(p.workingDirectory, "workingDirectory", "ARGV"));
  // the exact environment
  if (isRecord(p.environment)) {
    const environment = p.environment as Record<string, unknown>;
    if (environment.LC_ALL !== "C") out.push("RUNTIME_PROFILE_ENV_REQUIRED:LC_ALL");
    if (environment.TZ !== "UTC") out.push("RUNTIME_PROFILE_ENV_REQUIRED:TZ");
    for (const [key, value] of Object.entries(environment)) {
      if (FORBIDDEN_ENV_KEYS.test(key)) out.push(`RUNTIME_PROFILE_ENV_FORBIDDEN_KEY:${key}`);
      if (SECRET_ENV_KEYS.test(key)) out.push(`RUNTIME_PROFILE_ENV_SECRET_KEY:${key}`);
      out.push(...templateViolations(value, key, "ENV"));
    }
    if (canonical(p.environmentVariablesAllowlist) !== canonical(Object.keys(environment).sort(byCodeUnits))) out.push("RUNTIME_PROFILE_ENV_ALLOWLIST_MISMATCH");
    if (p.localeAndTimeZone !== `LC_ALL=${String(environment.LC_ALL)};TZ=${String(environment.TZ)}`) out.push("RUNTIME_PROFILE_LOCALE_MISMATCH");
  }
  if (p.environmentInheritance !== "none") out.push("RUNTIME_PROFILE_ENV_INHERITED");
  // [B22-A2 review] security-1, security-2, coverage-1: the docker argv of a container profile (its env, flags and claims)
  if (p.executionBackendKind === "container") out.push(...ociRunViolations(p));
  // [B22-A2 review] coverage-2: the input is read-only, whatever enforces it
  if (isRecord(p.inputMount) && p.inputMount.access !== "read-only") out.push("RUNTIME_PROFILE_INPUT_NOT_READ_ONLY");
  // limits
  if (isRecord(p.limits)) {
    for (const name of LIMIT_NAMES) {
      const limit = (p.limits as Record<string, unknown>)[name];
      if (!isRecord(limit)) continue;
      if (!ENFORCEMENT.includes(limit.enforcedBy as LimitEnforcement)) { if ("enforcedBy" in limit) out.push(`RUNTIME_PROFILE_LIMIT_ENFORCEMENT:${name}`); continue; }
      const value = limit.value;
      const valueOk = limit.enforcedBy === "none" ? value === null : typeof value === "number" && Number.isSafeInteger(value) && value > 0;
      if (!valueOk) out.push(`RUNTIME_PROFILE_LIMIT_VALUE:${name}`);
      if (limit.unit !== LIMIT_UNITS[name]) out.push(`RUNTIME_PROFILE_LIMIT_UNIT:${name}`);
      if (typeof limit.how !== "string" || limit.how.trim().length < 10) out.push(`RUNTIME_PROFILE_LIMIT_HOW:${name}`);
      if (p.executionBackendKind !== "container" && limit.enforcedBy === "os") out.push(`RUNTIME_PROFILE_LOCAL_OS_CLAIM:${name}`); // [B22-A2 lead] any kind but a container (whose claims ociRunViolations ties to flags)
    }
    if (isRecord(p.resourceLimits)) {
      const limits = p.limits as Record<LimitName, ProfileLimit>;
      const expected: Record<string, number> = { timeoutMs: limits.wallClockMs?.value ?? 0, memoryMiB: limits.memoryMiB?.value ?? 0, outputBytes: limits.outputBytes?.value ?? 0, processCount: limits.processes?.value ?? 0, waveformPoints: limits.waveformPoints?.value ?? 0 };
      for (const [field, value] of Object.entries(expected)) if ((p.resourceLimits as unknown as Record<string, unknown>)[field] !== value) out.push(`RUNTIME_PROFILE_RESOURCE_LIMITS_MISMATCH:${field}`);
    }
  }
  if (p.executionBackendKind !== "container") { // [B22-A2 lead] the check's new issue: every other kind, CD-10's sandboxed_process included
    for (const [field, policy] of [["network", p.network], ["inputMount", p.inputMount], ["outputDirectory", p.outputDirectory], ["kill", p.kill]] as const) if (isRecord(policy) && policy.enforcedBy === "os") out.push(`RUNTIME_PROFILE_LOCAL_OS_CLAIM:${field}`);
  }
  // network, validation and authority
  if (p.networkPolicy === "deny" && p.network?.enforcedBy !== "os") out.push("RUNTIME_PROFILE_NETWORK_DENY_UNENFORCED");
  const pinned = p.executable?.expectedDigest?.state === "pinned";
  // [B22-A2 review] coverage-7: the host client that runs a container profile's argv, on a container profile only
  const client: unknown = (candidate as Record<string, unknown>).hostClient;
  if (p.executionBackendKind === "container" ? !isRecord(client) || !hostClientOk(client) : client !== null) out.push("RUNTIME_PROFILE_HOST_CLIENT");
  const clientPinned = !isRecord(client) || (isRecord(client.expectedDigest) && client.expectedDigest.state === "pinned");
  if (p.validationState === "validated" && (!Array.isArray(p.qualificationEvidenceRefs) || p.qualificationEvidenceRefs.length === 0 || !pinned || !clientPinned)) out.push("RUNTIME_PROFILE_VALIDATED_WITHOUT_EVIDENCE");
  if (p.authoritativeEligible !== false && (p.executionBackendKind !== "container" || p.validationState !== "validated" || p.networkPolicy !== "deny")) out.push("RUNTIME_PROFILE_AUTHORITATIVE_INELIGIBLE");
  // the pinned digest and its CD-10 copy
  if (isRecord(p.executable) && isRecord(p.executable.expectedDigest)) {
    const expected = cd10Digest(p.executable);
    if (p.executableOrImageDigest !== expected) out.push("RUNTIME_PROFILE_DIGEST_STATE_MISMATCH");
    if (!digestShapeOk(p.executable.expectedDigest)) out.push("RUNTIME_PROFILE_DIGEST_STATE_MISMATCH");
  }
  // [B22-A2 review] coverage-4: digest members only on an install tree - plain, distinct, and covering the executable
  if (isRecord(p.executable)) {
    const members: unknown = (p.executable as unknown as Record<string, unknown>).digestMembers;
    const covered = String(p.executable.relativePath).split("/")[0];
    const membersOk = members === null || (p.executable.kind === "install-tree" && Array.isArray(members) && members.length > 0 && members.every(isPlainEntryName) && new Set(members).size === members.length && members.includes(covered));
    if (!membersOk) out.push("RUNTIME_PROFILE_DIGEST_MEMBERS");
  }
  if (p.deterministicDigest !== profileDigest(candidate)) out.push("RUNTIME_PROFILE_DETERMINISTIC_DIGEST");
  return [...new Set(out)];
}
