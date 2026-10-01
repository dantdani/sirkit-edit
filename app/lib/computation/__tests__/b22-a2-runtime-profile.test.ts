/**
 * [B22-A2] The immutable runtime profile contract (runbook B22-A :890-904; discovery D22-2 contract, D22-11 contract; OD-135,
 * OD-148): the registry holds exactly the four profiles, each closed-key, deep-frozen and valid; the install-tree digest is one
 * reproducible, order-independent function, tested on a temporary fixture tree only (never on a real install); no argv template has
 * a caller slot; every environment is an exact map with LC_ALL=C and TZ=UTC and without HOME/USERPROFILE; no profile is
 * `validated` or authoritative-eligible; every limit carries `enforcedBy`; expected digests come from named server settings only;
 * an unknown id is refused with a closed error. No process is started and no network or model is called.
 *
 * [B22-A2 review] Cases 15-17 and the extended 5, 6, 7, 9, 13: the digest's every refusal (a special file, a file link, a file that
 * changes while hashed - simulated through the fs seams below, since a fixture tree cannot produce them portably), named digest
 * members (FreeRouting's setup rewrites a manifest beside its install), the OCI run argv parsed by a closed option grammar with
 * every `os` claim tied to its flag, the read-only input mount, the placeholder table, every argv template and every environment
 * pinned, the FreeRouting legacy record derived from the resolver, and a counterexample for every closed code the validator returns.
 * Case 18 and the extended 10 and 14: the host program that runs a container profile's argv (the docker CLI) is bound by server
 * settings like the executable (coverage-7).
 */
import { createHash } from "node:crypto";
import type { BigIntStats, Stats } from "node:fs";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

/** [B22-A2 review] coverage-6, tests-7: fs seams for the digest refusals a fixture tree cannot produce portably. Unset (the
 *  default), every call is the real one; a hook sees the real result and may replace it. */
const fsHooks = vi.hoisted(() => ({
  lstat: null as null | ((path: string, stat: Stats | BigIntStats, call: number) => Stats | BigIntStats | undefined),
  stream: null as null | ((path: string) => NodeJS.ReadableStream | undefined),
  calls: new Map<string, number>(),
}));
vi.mock("node:fs/promises", async (orig) => {
  const real = (await orig()) as typeof import("node:fs/promises");
  return {
    ...real,
    lstat: async (path: string, ...rest: unknown[]) => {
      const stat = (await (real.lstat as (...args: unknown[]) => Promise<Stats | BigIntStats>)(path, ...rest));
      if (fsHooks.lstat === null) return stat;
      const call = (fsHooks.calls.get(String(path)) ?? 0) + 1;
      fsHooks.calls.set(String(path), call);
      return fsHooks.lstat(String(path), stat, call) ?? stat;
    },
  };
});
vi.mock("node:fs", async (orig) => {
  const real = (await orig()) as typeof import("node:fs");
  return { ...real, createReadStream: (path: string, ...rest: unknown[]) => fsHooks.stream?.(String(path)) ?? (real.createReadStream as (...args: unknown[]) => unknown)(path, ...rest) };
});
/** A copy of a real Stats or BigIntStats with some fields replaced (its type predicates read `mode`). */
const statWith = (stat: Stats | BigIntStats, fields: Record<string, number | bigint>): Stats | BigIntStats => Object.assign(Object.create(Object.getPrototypeOf(stat) as object) as Stats | BigIntStats, stat, fields);
/** `value` in the form (number or bigint) of the original field. */
const like = (original: number | bigint, value: number): number | bigint => (typeof original === "bigint" ? BigInt(value) : value);
/** [B22-A2 review] the stats the digest must take of a file: bigint, an exact file id and a nanosecond time (every Windows file id
 *  on this host exceeds 2^53, so a number id is rounded and `ino + 1 === ino`). */
const exact = (stat: Stats | BigIntStats): BigIntStats => {
  if (typeof stat.ino !== "bigint") throw new Error("the install-tree digest must stat files with { bigint: true }");
  return stat as BigIntStats;
};
import {
  INSTALL_TREE_DIGEST_ALGORITHM,
  InstallTreeDigestError,
  LIMIT_NAMES,
  RUNTIME_PROFILE_DIGEST_SETTINGS,
  RUNTIME_PROFILE_IDS,
  RUNTIME_PROFILE_KEYS,
  RuntimeProfileError,
  SERVER_NAMED_PLACEHOLDERS,
  installTreeDigest,
  isDeepFrozen,
  runtimeProfile,
  runtimeProfileViolations,
  runtimeProfiles,
  type RuntimeProfile,
} from "@/app/lib/computation/runtime-profile";
import { DIAGNOSTIC_OUTPUT_MAX_BYTES, TOOL_OUTPUT_FILE_MAX_BYTES } from "@/app/lib/computation/output-bounds";
import { analyticalReferenceProvider, diagnosticNgspiceProvider, providerAuthoritative } from "@/app/lib/model-simulation/provider";
import type { SimulationExecutionEnvironment } from "@/app/lib/model-simulation/types";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
/** A synthetic counterexample: a mutable deep copy of a registry profile (structuredClone drops the freeze) with one edit at a
 *  dotted path; `undefined` deletes the key. */
function edited(profile: RuntimeProfile, path: string, value: unknown): unknown {
  const copy = structuredClone(profile) as unknown as Record<string, unknown>;
  const keys = path.split(".");
  let node = copy;
  for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
  const last = keys[keys.length - 1]!;
  if (value === undefined) delete node[last];
  else node[last] = value;
  return copy;
}
/** Several edits at once, each as `edited` applies it. */
function editedAll(profile: RuntimeProfile, edits: ReadonlyArray<readonly [string, unknown]>): unknown {
  return edits.reduce<unknown>((copy, [path, value]) => edited(copy as RuntimeProfile, path, value), profile);
}
/** A fake 64-hex digest assembled at run time (never a literal in the file). */
const fakeHex = (seed: string): string => createHash("sha256").update(`b22-a2 fake ${seed}`).digest("hex");
const settingsOf = (values: Record<string, string>) => (name: string): string | undefined => values[name];

const temporaryRoots: string[] = [];
function fixtureTree(files: ReadonlyArray<readonly [string, string]>): string {
  const root = mkdtempSync(join(tmpdir(), "sirkit-b22-a2-tree-"));
  temporaryRoots.push(root);
  for (const [path, content] of files) {
    const full = join(root, ...path.split("/"));
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}
afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  fsHooks.lstat = null;
  fsHooks.stream = null;
  fsHooks.calls.clear();
});
const isDigestError = (code: string) => (error: unknown): boolean => error instanceof InstallTreeDigestError && error.code === code;

/** [B22-A2 review] tests-3, tests-4: the reviewed argv templates and exact environments of the four profiles; any change is a
 *  reviewed pin move. */
const LOCAL_ENV = { LC_ALL: "C", TZ: "UTC", PATH: "{installBinDir}", SystemRoot: "{systemRoot}", TEMP: "{runDir}", TMP: "{runDir}" };
const OCI_RUN = [
  "run", "--rm", "--init", "--name", "{containerName}", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
  "--pids-limit", "64", "--memory", "1024m", "--memory-swap", "1024m", "--cpus", "1", "--ulimit", "cpu=120:120", "--user", "65534:65534",
  "--tmpfs", "/out:rw,noexec,nosuid,nodev,size=128m", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
  "--mount", "type=bind,source={inputDir},target=/in,readonly", "--workdir", "/out",
  "--env", "LC_ALL=C", "--env", "TZ=UTC", "--env", "PATH=/usr/bin:/bin",
  "{image}", "ngspice", "-b", "/in/deck.cir",
];
const KICAD_DRILL = ["pcb", "export", "drill", "{boardFile}", "--output", "{drillDir}", "--format", "excellon", "--excellon-units", "{excellonUnits}", "--excellon-zeros-format", "decimal", "--drill-origin", "absolute"];
const PINNED: Record<string, { argv: Record<string, string[]>; environment: Record<string, string> }> = {
  "ngspice-local-diagnostic": { argv: { run: ["-b", "{deckFile}"], version: ["-v"] }, environment: LOCAL_ENV },
  "ngspice-oci": { argv: { run: OCI_RUN, kill: ["kill", "--signal", "KILL", "{containerName}"] }, environment: { LC_ALL: "C", TZ: "UTC", PATH: "/usr/bin:/bin" } },
  "kicad-cli-local-diagnostic": {
    argv: { "export-gerbers": ["pcb", "export", "gerbers", "{boardFile}", "--output", "{gerberDir}", "--layers", "{layerList}"], "export-drill": KICAD_DRILL, "export-drill-separate-th": [...KICAD_DRILL, "--excellon-separate-th"] },
    environment: { ...LOCAL_ENV, KICAD_CONFIG_HOME: "{runDir}" },
  },
  "freerouting-local-diagnostic": {
    argv: { route: ["-Djava.awt.headless=true", "-Dlog4j2.disableJndi=true", "-jar", "{jarFile}", "--gui.enabled=false", "--api_server.enabled=false", "--logging.file.enabled=false", "--logging.console.level=WARN", "-da", "-de", "{dsnFile}", "-do", "{sesFile}", "-mp", "{enginePasses}"] },
    environment: LOCAL_ENV,
  },
};

/** Every object or array inside a value, with its path. */
function nodes(value: unknown, path = "profile"): Array<[string, object]> {
  if (value === null || typeof value !== "object") return [];
  const out: Array<[string, object]> = [[path, value]];
  for (const [key, child] of Object.entries(value)) out.push(...nodes(child, `${path}.${key}`));
  return out;
}

describe("[B22-A2] the runtime profile registry", () => {
  it("1. holds exactly the four profiles; a lookup by id returns that frozen profile; every profile passes the contract validator", () => {
    expect([...RUNTIME_PROFILE_IDS]).toEqual(["ngspice-local-diagnostic", "ngspice-oci", "kicad-cli-local-diagnostic", "freerouting-local-diagnostic"]);
    const all = runtimeProfiles(settingsOf({}));
    expect(all.map((profile) => profile.profileId)).toEqual([...RUNTIME_PROFILE_IDS]);
    for (const id of RUNTIME_PROFILE_IDS) {
      const profile = runtimeProfile(id, settingsOf({}));
      expect(profile.profileId).toBe(id);
      expect(profile.environmentId).toBe(`runtime-profile:${id}:${profile.revision}`);
      expect(runtimeProfileViolations(profile), id).toEqual([]);
      expect(profile).toEqual(all.find((candidate) => candidate.profileId === id));
    }
    // the backend and state the task names for each
    const byId = Object.fromEntries(all.map((profile) => [profile.profileId, profile]));
    expect([byId["ngspice-local-diagnostic"]!.executionBackendKind, byId["ngspice-local-diagnostic"]!.validationState]).toEqual(["local_subprocess_diagnostic", "diagnostic_only"]);
    expect([byId["ngspice-oci"]!.executionBackendKind, byId["ngspice-oci"]!.validationState]).toEqual(["container", "unvalidated"]);
    expect([byId["kicad-cli-local-diagnostic"]!.executionBackendKind, byId["kicad-cli-local-diagnostic"]!.validationState]).toEqual(["local_subprocess_diagnostic", "diagnostic_only"]);
    expect([byId["freerouting-local-diagnostic"]!.executionBackendKind, byId["freerouting-local-diagnostic"]!.validationState]).toEqual(["local_subprocess_diagnostic", "diagnostic_only"]);
    // the profile type extends - never loosens - CD-10's environment type, so a profile is usable wherever one is
    expectTypeOf<RuntimeProfile>().toMatchTypeOf<SimulationExecutionEnvironment>();
    // the local ngspice profile names CD-10's diagnostic ngspice provider; no CD-10 provider defines a container backend
    expect(byId["ngspice-local-diagnostic"]!.providerRevisionId).toBe(diagnosticNgspiceProvider().deterministicDigest);
    expect(byId["ngspice-oci"]!.providerRevisionId).toBe("unbound");
  });

  it("2. closed keys: every profile's keys at every level are exactly the contract's; an extra or a missing key, top-level or nested, is a violation", () => {
    for (const profile of runtimeProfiles(settingsOf({}))) {
      const optional = profile.executable.expectedDigest.state === "pinned" ? [] : ["executableOrImageDigest"];
      expect(Object.keys(profile).sort(), profile.profileId).toEqual(RUNTIME_PROFILE_KEYS.filter((key) => !optional.includes(key)).sort());
      expect(Object.keys(profile.limits).sort()).toEqual([...LIMIT_NAMES].sort());
      for (const name of LIMIT_NAMES) expect(Object.keys(profile.limits[name]).sort()).toEqual(["enforcedBy", "how", "unit", "value"]);
      expect(Object.keys(profile.executable.expectedDigest).sort()).toEqual(["reason", "state", "value"]);
      expect(Object.keys(profile.resourceLimits).sort()).toEqual(["memoryMiB", "outputBytes", "processCount", "timeoutMs", "waveformPoints"]);
    }
    const base = runtimeProfile("ngspice-local-diagnostic", settingsOf({}));
    expect(runtimeProfileViolations(edited(base, "callerArgs", ["--anything"]))).toContain("RUNTIME_PROFILE_UNKNOWN_KEY:profile.callerArgs");
    expect(runtimeProfileViolations(edited(base, "limits.wallClockMs.override", 1))).toContain("RUNTIME_PROFILE_UNKNOWN_KEY:profile.limits.wallClockMs.override");
    expect(runtimeProfileViolations(edited(base, "limits.gpuSeconds", { enforcedBy: "none", value: null, unit: "s", how: "x" }))).toContain("RUNTIME_PROFILE_UNKNOWN_KEY:profile.limits.gpuSeconds");
    expect(runtimeProfileViolations(edited(base, "executable.expectedDigest.source", "request"))).toContain("RUNTIME_PROFILE_UNKNOWN_KEY:profile.executable.expectedDigest.source");
    expect(runtimeProfileViolations(edited(base, "kill", undefined))).toContain("RUNTIME_PROFILE_MISSING_KEY:profile.kill");
    expect(runtimeProfileViolations(edited(base, "determinism.seed.note", undefined))).toContain("RUNTIME_PROFILE_MISSING_KEY:profile.determinism.seed.note");
    expect(runtimeProfileViolations(null)).toEqual(["RUNTIME_PROFILE_NOT_OBJECT"]);
    expect(runtimeProfileViolations([])).toEqual(["RUNTIME_PROFILE_NOT_OBJECT"]);
  });

  it("3. deep immutability: every object and array of every profile is frozen, a write throws, and a lookup never hands out a shared mutable object", () => {
    for (const profile of runtimeProfiles(settingsOf({}))) {
      expect(isDeepFrozen(profile), profile.profileId).toBe(true);
      for (const [path, node] of nodes(profile)) expect(Object.isFrozen(node), path).toBe(true);
      expect(() => { (profile as unknown as { validationState: string }).validationState = "validated"; }).toThrow(TypeError);
      expect(() => { (profile.argvTemplates as Record<string, string[]>).run = ["--caller"]; }).toThrow(TypeError);
      expect(() => { (profile.environment as Record<string, string>).HOME = "/home/x"; }).toThrow(TypeError);
      expect(() => { (profile.limits.wallClockMs as { value: number | null }).value = 1e12; }).toThrow(TypeError);
      expect(() => { (Object.values(profile.argvTemplates)[0] as string[]).push("--x"); }).toThrow(TypeError);
      expect(runtimeProfileViolations(profile)).toEqual([]);
    }
    expect(isDeepFrozen({ a: Object.freeze({}) })).toBe(false);
    expect(isDeepFrozen(Object.freeze({ a: {} }))).toBe(false);
    expect(isDeepFrozen(Object.freeze({ a: Object.freeze([Object.freeze({})]) }))).toBe(true);
  });
});

/** The fixture install tree (cases 4, 5 and 15). [B22-A2 review] module scope: case 15, in another block, reads it too. */
const TREE: ReadonlyArray<readonly [string, string]> = [
  ["bin/ngspice_con.exe", "MZ fake executable bytes"],
  ["bin/libomp140.x86_64.dll", "fake library"],
  ["share/ngspice/scripts/spinit", "* fake spinit\nset num_threads=8\n"],
  ["lib/ngspice/analog.cm", "fake code model"],
  // `share-x/...` sorts before `share/...` as a whole path ("-" < "/") but after `share` as a directory name: pins the global sort
  ["share-x/notes.txt", "x"],
  ["README", ""],
];

describe("[B22-A2] the install-tree digest (temporary fixture trees only, never a real install)", () => {
  it("4. is reproducible, independent of creation and listing order, sensitive to one changed byte, a rename and an added empty file, and equal to the documented encoding computed independently", async () => {
    const first = fixtureTree(TREE);
    const reversed = fixtureTree([...TREE].reverse());
    const a = await installTreeDigest(first);
    expect(a.algorithm).toBe(INSTALL_TREE_DIGEST_ALGORITHM);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.fileCount).toBe(TREE.length);
    expect(a.totalBytes).toBe(TREE.reduce((sum, [, content]) => sum + Buffer.byteLength(content), 0));
    expect((await installTreeDigest(first)).sha256).toBe(a.sha256);
    expect((await installTreeDigest(reversed)).sha256).toBe(a.sha256);
    // the documented encoding, computed here without the function: SHA-256 over the algorithm line, then one JSON line
    // [relative POSIX path, size, per-file SHA-256] per file, sorted by path in code-unit order
    const lines = [...TREE].map(([path, content]) => [path, Buffer.byteLength(content), createHash("sha256").update(content).digest("hex")] as const)
      .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map((entry) => `${JSON.stringify(entry)}${NEWLINE}`);
    expect(a.sha256).toBe(createHash("sha256").update(`${INSTALL_TREE_DIGEST_ALGORITHM}${NEWLINE}${lines.join("")}`).digest("hex"));
    // one changed byte, same size
    const oneByte = fixtureTree(TREE.map(([path, content]) => [path, path === "share/ngspice/scripts/spinit" ? content.replace("8", "4") : content] as const));
    expect((await installTreeDigest(oneByte)).sha256).not.toBe(a.sha256);
    // a renamed file, same bytes
    const renamed = fixtureTree(TREE.map(([path, content]) => [path === "README" ? "README.txt" : path, content] as const));
    expect((await installTreeDigest(renamed)).sha256).not.toBe(a.sha256);
    // an added empty file
    const added = fixtureTree([...TREE, ["bin/.spiceinit", ""]]);
    expect((await installTreeDigest(added)).sha256).not.toBe(a.sha256);
    // an empty directory is not part of the identity (recorded in runtime-profiles.md)
    mkdirSync(join(first, "empty-dir"));
    expect((await installTreeDigest(first)).sha256).toBe(a.sha256);
  });

  it("5. refuses, each with a closed error: a link anywhere (a real junction; a file symlink and a special file through the lstat seam), a root that is not a directory, and a file whose read length, modification time, file id or type changes while it is hashed, read from exact (bigint) stats", async () => {
    const root = fixtureTree(TREE);
    const outside = fixtureTree([["secret.txt", "outside the install"]]);
    symlinkSync(outside, join(root, "share", "linked"), "junction");
    await expect(installTreeDigest(root)).rejects.toSatisfy(isDigestError("INSTALL_TREE_LINK"));
    const file = fixtureTree([["only.txt", "x"]]);
    await expect(installTreeDigest(join(file, "only.txt"))).rejects.toSatisfy(isDigestError("INSTALL_TREE_ROOT_NOT_DIRECTORY"));
    await expect(installTreeDigest(join(file, "absent"))).rejects.toSatisfy(isDigestError("INSTALL_TREE_ROOT_NOT_DIRECTORY"));
    // [B22-A2 review] coverage-6, tests-7: the refusals a fixture tree cannot produce portably, through the seams (one file each)
    const tree = fixtureTree(TREE);
    const spinit = join(tree, "share", "ngspice", "scripts", "spinit");
    const S_IFLNK = 0o120000, S_IFIFO = 0o010000;
    // the digest stats each file exactly, when it lists it and again after the read
    const kinds: string[] = [];
    fsHooks.lstat = (path, stat) => {
      if (path === spinit) kinds.push(typeof stat.ino);
      return undefined;
    };
    await installTreeDigest(tree);
    expect(kinds).toEqual(["bigint", "bigint"]);
    fsHooks.lstat = null;
    fsHooks.calls.clear();
    const cases: Array<[string, () => void]> = [
      // a file symlink (Windows grants no symlink privilege here; a junction is the real link above)
      ["INSTALL_TREE_LINK", () => { fsHooks.lstat = (path, stat) => (path === spinit ? statWith(stat, { mode: like(stat.mode, S_IFLNK | 0o777) }) : undefined); }],
      // a FIFO: neither a file, a directory nor a link
      ["INSTALL_TREE_SPECIAL_FILE", () => { fsHooks.lstat = (path, stat) => (path === spinit ? statWith(stat, { mode: like(stat.mode, S_IFIFO | 0o644) }) : undefined); }],
      // the read yields one byte more than the listing's size
      ["INSTALL_TREE_CHANGED", () => { fsHooks.stream = (path) => (path === spinit ? Readable.from([Buffer.from(`${TREE[2]![1]}x`)]) : undefined); }],
      // a same-size rewrite: the re-stat after the read shows a later modification time
      ["INSTALL_TREE_CHANGED", () => { fsHooks.lstat = (path, stat, call) => (path === spinit && call === 2 ? statWith(stat, { mtimeMs: exact(stat).mtimeMs + BigInt(1000), mtimeNs: exact(stat).mtimeNs + BigInt(1_000_000_000) }) : undefined); }],
      // a replaced file of the same size and time: the re-stat shows another file id
      ["INSTALL_TREE_CHANGED", () => { fsHooks.lstat = (path, stat, call) => (path === spinit && call === 2 ? statWith(stat, { ino: exact(stat).ino + BigInt(1) }) : undefined); }],
      // the file became a link while it was read
      ["INSTALL_TREE_CHANGED", () => { fsHooks.lstat = (path, stat, call) => (path === spinit && call === 2 ? statWith(stat, { mode: like(stat.mode, S_IFLNK | 0o777) }) : undefined); }],
    ];
    const clean = (await installTreeDigest(tree)).sha256;
    for (const [code, arm] of cases) {
      arm();
      await expect(installTreeDigest(tree), code).rejects.toSatisfy(isDigestError(code));
      fsHooks.lstat = null;
      fsHooks.stream = null;
      fsHooks.calls.clear();
    }
    // the seams are inert when unset: the same tree hashes as before
    expect((await installTreeDigest(tree)).sha256).toBe(clean);
  });
});

describe("[B22-A2] what a profile binds", () => {
  it("6. no caller slot in any argv template: every placeholder is server-named and there is no variable expansion; a synthetic caller slot or expansion is refused", () => {
    const placeholder = /\{[^{}]*\}/g;
    for (const profile of runtimeProfiles(settingsOf({}))) {
      expect(Object.keys(profile.argvTemplates).length, profile.profileId).toBeGreaterThan(0);
      for (const [operation, template] of Object.entries(profile.argvTemplates)) {
        expect(template.length, `${profile.profileId} ${operation}`).toBeGreaterThan(0);
        for (const element of template) {
          for (const token of element.match(placeholder) ?? []) expect(Object.keys(SERVER_NAMED_PLACEHOLDERS), `${profile.profileId} ${operation} ${token}`).toContain(token);
          expect(element.replace(placeholder, ""), `${profile.profileId} ${operation} ${element}`).not.toMatch(/[{}$%`]/);
        }
      }
      for (const token of profile.workingDirectory.match(placeholder) ?? []) expect(Object.keys(SERVER_NAMED_PLACEHOLDERS)).toContain(token);
    }
    // each placeholder is something the server names: its description never says it comes from a request
    for (const description of Object.values(SERVER_NAMED_PLACEHOLDERS)) expect(description).not.toMatch(/\bfrom (the|a) (request|caller|body)\b/i);
    // [B22-A2 review] tests-3: the placeholder table is also the validator's allowlist, so its key set is pinned (a new placeholder
    // is a reviewed pin move), and every profile's argv templates are pinned exactly
    expect(Object.keys(SERVER_NAMED_PLACEHOLDERS)).toEqual([
      "{runDir}", "{deckFile}", "{inputDir}", "{installBinDir}", "{systemRoot}", "{image}", "{containerName}", "{boardFile}", "{gerberDir}",
      "{drillDir}", "{layerList}", "{excellonUnits}", "{jarFile}", "{dsnFile}", "{sesFile}", "{enginePasses}",
    ]);
    expect(Object.isFrozen(SERVER_NAMED_PLACEHOLDERS)).toBe(true);
    for (const profile of runtimeProfiles(settingsOf({}))) expect(profile.argvTemplates, profile.profileId).toEqual(PINNED[profile.profileId]!.argv);
    const base = runtimeProfile("ngspice-local-diagnostic", settingsOf({}));
    for (const [element, code] of [
      ["{callerArgs}", "RUNTIME_PROFILE_ARGV_CALLER_SLOT:run"],
      ["{deckFile}{extra}", "RUNTIME_PROFILE_ARGV_CALLER_SLOT:run"],
      ["${HOME}", "RUNTIME_PROFILE_ARGV_EXPANSION:run"],
      ["%USERPROFILE%", "RUNTIME_PROFILE_ARGV_EXPANSION:run"],
      ["`whoami`", "RUNTIME_PROFILE_ARGV_EXPANSION:run"],
      ["{deckFile", "RUNTIME_PROFILE_ARGV_EXPANSION:run"],
    ] as const) {
      expect(runtimeProfileViolations(edited(base, "argvTemplates.run", ["-b", element])), element).toContain(code);
    }
    expect(runtimeProfileViolations(edited(base, "workingDirectory", "{callerDir}"))).toContain("RUNTIME_PROFILE_ARGV_CALLER_SLOT:workingDirectory");
  });

  it("7. env exact: every environment is an exact map with LC_ALL=C and TZ=UTC, without HOME/USERPROFILE in any case, with no secret-shaped key, never inherited; the CD-10 allowlist is its keys; the OCI run passes exactly that map", () => {
    for (const profile of runtimeProfiles(settingsOf({}))) {
      expect(profile.environment.LC_ALL, profile.profileId).toBe("C");
      expect(profile.environment.TZ, profile.profileId).toBe("UTC");
      expect(profile.environmentInheritance).toBe("none");
      const keys = Object.keys(profile.environment);
      expect(keys.filter((key) => /^(home|userprofile|homedrive|homepath)$/i.test(key)), profile.profileId).toEqual([]);
      expect(keys.filter((key) => /key|token|secret|password|database|supabase|openai|anthropic/i.test(key)), profile.profileId).toEqual([]);
      expect(profile.environmentVariablesAllowlist).toEqual([...keys].sort());
      expect(profile.localeAndTimeZone).toBe("LC_ALL=C;TZ=UTC");
      for (const value of Object.values(profile.environment)) expect(value.replace(/\{[^{}]*\}/g, ""), profile.profileId).not.toMatch(/[{}$%`]/);
      // [B22-A2 review] tests-4: the exact map itself is pinned, so adding or changing any key is a reviewed move
      expect(profile.environment, profile.profileId).toEqual(PINNED[profile.profileId]!.environment);
    }
    const oci = runtimeProfile("ngspice-oci", settingsOf({}));
    const run = oci.argvTemplates.run!;
    // the docker options end at {image} (case 16 parses them by a closed grammar that refuses every other env form)
    const options = run.slice(0, run.indexOf("{image}"));
    const passed = Object.fromEntries(options.flatMap((element, index) => (element === "--env" ? [options[index + 1]!.split(/=(.*)/).slice(0, 2)] : [])));
    expect(passed).toEqual({ ...oci.environment });
    const base = runtimeProfile("ngspice-local-diagnostic", settingsOf({}));
    for (const [path, value, code] of [
      ["environment.HOME", "{runDir}", "RUNTIME_PROFILE_ENV_FORBIDDEN_KEY:HOME"],
      ["environment.UserProfile", "{runDir}", "RUNTIME_PROFILE_ENV_FORBIDDEN_KEY:UserProfile"],
      ["environment.HOMEPATH", "x", "RUNTIME_PROFILE_ENV_FORBIDDEN_KEY:HOMEPATH"],
      ["environment.OPENAI_API_KEY", "x", "RUNTIME_PROFILE_ENV_SECRET_KEY:OPENAI_API_KEY"],
      ["environment.LC_ALL", undefined, "RUNTIME_PROFILE_ENV_REQUIRED:LC_ALL"],
      ["environment.TZ", "Europe/Berlin", "RUNTIME_PROFILE_ENV_REQUIRED:TZ"],
      ["environment.PATH", "%PATH%", "RUNTIME_PROFILE_ENV_EXPANSION:PATH"],
      ["environment.PATH", "{callerPath}", "RUNTIME_PROFILE_ENV_CALLER_SLOT:PATH"],
      ["environmentInheritance", "allowlist", "RUNTIME_PROFILE_ENV_INHERITED"],
      ["environmentVariablesAllowlist", ["PATH"], "RUNTIME_PROFILE_ENV_ALLOWLIST_MISMATCH"],
      ["localeAndTimeZone", "uncontrolled-local", "RUNTIME_PROFILE_LOCALE_MISMATCH"],
    ] as const) {
      expect(runtimeProfileViolations(edited(base, path, value)), code).toContain(code);
    }
    // [B22-A2 review] security-1: an extra pair among the docker options (before {image}; after it docker hands every token to the
    // container's command, so the old append after the command never reached the environment)
    expect(runtimeProfileViolations(edited(oci, "argvTemplates.run", [...options, "--env", "HOME=/root", ...run.slice(options.length)]))).toContain("RUNTIME_PROFILE_OCI_ENV_MISMATCH");
  });

  it("8. no profile is validated or authoritative-eligible, none carries qualification evidence, and CD-10's gate never makes one authoritative; a synthetic validated profile without evidence, or an eligible local one, is refused", () => {
    const reviewer = { actorId: "reviewer-1", actorKind: "human", role: "reviewer", sessionId: "s1" } as unknown as Parameters<typeof analyticalReferenceProvider>[0];
    for (const settings of [settingsOf({}), settingsOf(Object.fromEntries(Object.entries(RUNTIME_PROFILE_DIGEST_SETTINGS).map(([id, name]) => [name, id === "ngspice-oci" ? `registry.example/sirkit/ngspice@sha256:${fakeHex(id)}` : fakeHex(id)])))]) {
      for (const profile of runtimeProfiles(settings)) {
        expect(profile.validationState, profile.profileId).not.toBe("validated");
        expect(profile.authoritativeEligible, profile.profileId).toBe(false);
        expect(profile.qualificationEvidenceRefs, profile.profileId).toEqual([]);
        for (const provider of [diagnosticNgspiceProvider(), analyticalReferenceProvider(reviewer)]) expect(providerAuthoritative(provider, profile), `${profile.profileId} ${provider.providerId}`).toBe(false);
      }
    }
    const oci = runtimeProfile("ngspice-oci", settingsOf({}));
    const local = runtimeProfile("ngspice-local-diagnostic", settingsOf({}));
    expect(runtimeProfileViolations(edited(oci, "validationState", "validated"))).toContain("RUNTIME_PROFILE_VALIDATED_WITHOUT_EVIDENCE");
    expect(runtimeProfileViolations(edited(local, "validationState", "validated"))).toContain("RUNTIME_PROFILE_VALIDATED_WITHOUT_EVIDENCE");
    expect(runtimeProfileViolations(edited(local, "authoritativeEligible", true))).toContain("RUNTIME_PROFILE_AUTHORITATIVE_INELIGIBLE");
    expect(runtimeProfileViolations(edited(oci, "authoritativeEligible", true))).toContain("RUNTIME_PROFILE_AUTHORITATIVE_INELIGIBLE");
    expect(runtimeProfileViolations(edited(local, "networkPolicy", "deny"))).toContain("RUNTIME_PROFILE_NETWORK_DENY_UNENFORCED");
  });

  it("9. every limit carries enforcedBy; a local profile claims no OS limit (no job object on this Windows host); a value exactly when enforced; CD-10's resourceLimits agree; synthetic violations are refused", () => {
    for (const profile of runtimeProfiles(settingsOf({}))) {
      for (const name of LIMIT_NAMES) {
        const limit = profile.limits[name];
        expect(["os", "runner", "none"], `${profile.profileId} ${name}`).toContain(limit.enforcedBy);
        expect(limit.how.length, `${profile.profileId} ${name}`).toBeGreaterThan(10);
        if (limit.enforcedBy === "none") expect(limit.value).toBeNull();
        else expect(Number.isSafeInteger(limit.value) && (limit.value as number) > 0, `${profile.profileId} ${name}`).toBe(true);
      }
      if (profile.executionBackendKind === "local_subprocess_diagnostic") {
        expect(LIMIT_NAMES.filter((name) => profile.limits[name].enforcedBy === "os"), profile.profileId).toEqual([]);
        for (const name of ["cpuSeconds", "memoryMiB", "processes", "fileBytes"] as const) expect(profile.limits[name].enforcedBy, `${profile.profileId} ${name}`).toBe("none");
        expect([profile.network.enforcedBy, profile.inputMount.enforcedBy, profile.outputDirectory.enforcedBy, profile.kill.enforcedBy], profile.profileId).toEqual(["none", "none", "runner", "runner"]);
        expect(profile.networkPolicy).toBe("allowlisted");
        // [B22-A2 review] coverage-2: the local input and output share the per-run directory; read-only is policy there, enforced by none
        expect([profile.inputMount.path, profile.outputDirectory.path], profile.profileId).toEqual(["{runDir}", "{runDir}"]);
      }
      // [B22-A2 review] coverage-2: the input mount is read-only in every profile (the type allows nothing else) and the output
      // directory is the one writable per-run place
      expect([profile.inputMount.access, profile.outputDirectory.access], profile.profileId).toEqual(["read-only", "read-write"]);
      expect([profile.inputMount.scope, profile.outputDirectory.scope], profile.profileId).toEqual(["per-run", "per-run"]);
      expect(profile.resourceLimits).toEqual({
        timeoutMs: profile.limits.wallClockMs.value,
        memoryMiB: profile.limits.memoryMiB.value ?? 0,
        outputBytes: profile.limits.outputBytes.value,
        processCount: profile.limits.processes.value ?? 0,
        waveformPoints: profile.limits.waveformPoints.value ?? 0,
      });
      expect(profile.limits.outputBytes).toMatchObject({ enforcedBy: "runner", value: DIAGNOSTIC_OUTPUT_MAX_BYTES });
      expect(profile.limits.wallClockMs.enforcedBy).toBe("runner");
    }
    // the values the legacy code holds today (worker, kicad-cli, FreeRouting), as the profiles state them
    expect(runtimeProfile("ngspice-local-diagnostic", settingsOf({})).limits.wallClockMs.value).toBe(120_000);
    expect(runtimeProfile("ngspice-local-diagnostic", settingsOf({})).limits.readBackBytes.value).toBe(100 * 1024 * 1024);
    expect(runtimeProfile("ngspice-local-diagnostic", settingsOf({})).limits.waveformPoints.value).toBe(5_000_000);
    expect(runtimeProfile("kicad-cli-local-diagnostic", settingsOf({})).limits.wallClockMs.value).toBe(60_000);
    expect(runtimeProfile("kicad-cli-local-diagnostic", settingsOf({})).limits.readBackBytes.value).toBe(TOOL_OUTPUT_FILE_MAX_BYTES);
    expect(runtimeProfile("freerouting-local-diagnostic", settingsOf({})).limits.wallClockMs.value).toBe(300_000);
    expect(runtimeProfile("freerouting-local-diagnostic", settingsOf({})).limits.readBackBytes.value).toBe(TOOL_OUTPUT_FILE_MAX_BYTES);
    const oci = runtimeProfile("ngspice-oci", settingsOf({}));
    expect(LIMIT_NAMES.filter((name) => oci.limits[name].enforcedBy === "os")).toEqual(["cpuSeconds", "memoryMiB", "processes", "fileBytes"]);
    const base = runtimeProfile("ngspice-local-diagnostic", settingsOf({}));
    for (const [path, value, code] of [
      ["limits.memoryMiB", { enforcedBy: "os", value: 512, unit: "MiB", how: "a claimed job object" }, "RUNTIME_PROFILE_LOCAL_OS_CLAIM:memoryMiB"],
      ["limits.cpuSeconds.enforcedBy", "kernel", "RUNTIME_PROFILE_LIMIT_ENFORCEMENT:cpuSeconds"],
      ["limits.processes.enforcedBy", undefined, "RUNTIME_PROFILE_MISSING_KEY:profile.limits.processes.enforcedBy"],
      ["limits.wallClockMs.value", null, "RUNTIME_PROFILE_LIMIT_VALUE:wallClockMs"],
      ["limits.wallClockMs.value", 0.5, "RUNTIME_PROFILE_LIMIT_VALUE:wallClockMs"],
      ["limits.fileBytes.value", 10, "RUNTIME_PROFILE_LIMIT_VALUE:fileBytes"],
      ["limits.wallClockMs.unit", "s", "RUNTIME_PROFILE_LIMIT_UNIT:wallClockMs"],
      ["limits.wallClockMs.how", "", "RUNTIME_PROFILE_LIMIT_HOW:wallClockMs"],
      ["resourceLimits.timeoutMs", 1, "RUNTIME_PROFILE_RESOURCE_LIMITS_MISMATCH:timeoutMs"],
      ["resourceLimits.memoryMiB", 4096, "RUNTIME_PROFILE_RESOURCE_LIMITS_MISMATCH:memoryMiB"],
      // [B22-A2 review] tests-6: a local process claims no OS network, mount, directory or kill either (each its own counterexample)
      ["network.enforcedBy", "os", "RUNTIME_PROFILE_LOCAL_OS_CLAIM:network"],
      ["inputMount.enforcedBy", "os", "RUNTIME_PROFILE_LOCAL_OS_CLAIM:inputMount"],
      ["outputDirectory.enforcedBy", "os", "RUNTIME_PROFILE_LOCAL_OS_CLAIM:outputDirectory"],
      ["kill.enforcedBy", "os", "RUNTIME_PROFILE_LOCAL_OS_CLAIM:kill"],
      // [B22-A2 review] coverage-2: the input mount is read-only, whatever enforces it
      ["inputMount.access", "read-write", "RUNTIME_PROFILE_INPUT_NOT_READ_ONLY"],
    ] as const) {
      expect(runtimeProfileViolations(edited(base, path, value)), code).toContain(code);
    }
    expect(runtimeProfileViolations(edited(runtimeProfile("ngspice-oci", settingsOf({})), "inputMount.access", "read-write"))).toContain("RUNTIME_PROFILE_INPUT_NOT_READ_ONLY");
    expectTypeOf<RuntimeProfile["inputMount"]["access"]>().toEqualTypeOf<"read-only">();
  });

  it("10. expected digests are server configuration: read only from the profile's named setting; absent or malformed is unpinned (the value never echoed); a well-formed value is pinned and becomes the CD-10 digest", () => {
    expect(RUNTIME_PROFILE_DIGEST_SETTINGS).toEqual({
      "ngspice-local-diagnostic": "SIRKIT_NGSPICE_INSTALL_SHA256",
      "ngspice-oci": "SIRKIT_NGSPICE_OCI_IMAGE",
      "kicad-cli-local-diagnostic": "SIRKIT_KICAD_CLI_INSTALL_SHA256",
      "freerouting-local-diagnostic": "SIRKIT_FREEROUTING_INSTALL_SHA256",
    });
    for (const id of RUNTIME_PROFILE_IDS) {
      const asked: string[] = [];
      const profile = runtimeProfile(id, (name) => { asked.push(name); return undefined; });
      // [B22-A2 review] coverage-7: the OCI profile also reads its host client's digest setting (case 18); nothing else is read
      expect(asked, id).toEqual(id === "ngspice-oci" ? [RUNTIME_PROFILE_DIGEST_SETTINGS[id], "SIRKIT_OCI_CLI_SHA256"] : [RUNTIME_PROFILE_DIGEST_SETTINGS[id]]);
      expect(profile.executable.digestSetting).toBe(RUNTIME_PROFILE_DIGEST_SETTINGS[id]);
      expect(profile.executable.expectedDigest).toEqual({ state: "unpinned", value: null, reason: "setting-absent" });
      expect("executableOrImageDigest" in profile, id).toBe(false);
      for (const malformed of ["  ", "not-a-digest", fakeHex(id).slice(1), `${fakeHex(id)}0`, "sha256:", `ngspice:latest`]) {
        const unpinned = runtimeProfile(id, settingsOf({ [RUNTIME_PROFILE_DIGEST_SETTINGS[id]]: malformed }));
        expect(unpinned.executable.expectedDigest, `${id} ${JSON.stringify(malformed)}`).toEqual(malformed.trim() === "" ? { state: "unpinned", value: null, reason: "setting-absent" } : { state: "unpinned", value: null, reason: "setting-malformed" });
        if (malformed.trim().length >= 20) expect(JSON.stringify(unpinned), id).not.toContain(malformed.trim());
      }
    }
    const hex = fakeHex("ngspice");
    const local = runtimeProfile("ngspice-local-diagnostic", settingsOf({ SIRKIT_NGSPICE_INSTALL_SHA256: ` ${hex.toUpperCase()} ` }));
    expect(local.executable.expectedDigest).toEqual({ state: "pinned", value: hex, reason: null });
    expect(local.executableOrImageDigest).toBe(`${INSTALL_TREE_DIGEST_ALGORITHM}:${hex}`);
    expect(runtimeProfileViolations(local)).toEqual([]);
    const image = `registry.example/sirkit/ngspice@sha256:${fakeHex("oci")}`;
    const oci = runtimeProfile("ngspice-oci", settingsOf({ SIRKIT_NGSPICE_OCI_IMAGE: image }));
    expect(oci.executable.expectedDigest).toEqual({ state: "pinned", value: image, reason: null });
    expect(oci.executableOrImageDigest).toBe(`sha256:${fakeHex("oci")}`);
    expect(runtimeProfileViolations(oci)).toEqual([]);
    // the default reader is the server's own environment, read at the named setting only (a fake value, stubbed for this case)
    vi.stubEnv("SIRKIT_KICAD_CLI_INSTALL_SHA256", fakeHex("kicad"));
    expect(runtimeProfile("kicad-cli-local-diagnostic").executable.expectedDigest).toEqual({ state: "pinned", value: fakeHex("kicad"), reason: null });
    // a pinned digest that disagrees with its CD-10 copy is a violation
    expect(runtimeProfileViolations(edited(local, "executableOrImageDigest", `${INSTALL_TREE_DIGEST_ALGORITHM}:${fakeHex("other")}`))).toContain("RUNTIME_PROFILE_DIGEST_STATE_MISMATCH");
    expect(runtimeProfileViolations(edited(local, "executableOrImageDigest", undefined))).toContain("RUNTIME_PROFILE_DIGEST_STATE_MISMATCH");
    const unpinned = runtimeProfile("ngspice-local-diagnostic", settingsOf({}));
    expect(runtimeProfileViolations(edited(unpinned, "executableOrImageDigest", `${INSTALL_TREE_DIGEST_ALGORITHM}:${hex}`))).toContain("RUNTIME_PROFILE_DIGEST_STATE_MISMATCH");
    // the profile's own SHA-256 identity covers every field
    expect(local.deterministicDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(local.deterministicDigest).not.toBe(unpinned.deterministicDigest);
    expect(runtimeProfileViolations(edited(local, "deterministicDigest", unpinned.deterministicDigest))).toContain("RUNTIME_PROFILE_DETERMINISTIC_DIGEST");
  });

  it("11. an unknown id is refused with a closed error that never echoes it, prototype names and case variants included", () => {
    for (const id of ["", "ngspice", "NGSPICE-LOCAL-DIAGNOSTIC", "ngspice-oci ", "__proto__", "constructor", "toString", "hasOwnProperty", "ngspice-local-diagnostic\n", 7, null, undefined, {}, ["ngspice-oci"]]) {
      let caught: unknown = null;
      try {
        runtimeProfile(id as string, settingsOf({}));
      } catch (error) {
        caught = error;
      }
      expect(caught, JSON.stringify(id)).toBeInstanceOf(RuntimeProfileError);
      expect((caught as RuntimeProfileError).code).toBe("RUNTIME_PROFILE_UNKNOWN");
      expect((caught as Error).message).toBe("RUNTIME_PROFILE_UNKNOWN: no runtime profile has that id");
    }
  });

  it("12. seed, threads, locale and time zone: each profile states what it pins and how (the installed spinit's num_threads=8 through the install digest; the seed through a deck option)", () => {
    const local = runtimeProfile("ngspice-local-diagnostic", settingsOf({}));
    expect(local.determinism.locale).toMatchObject({ value: "C", pinnedBy: "environment" });
    expect(local.determinism.timeZone).toMatchObject({ value: "UTC", pinnedBy: "environment" });
    expect(local.determinism.seed).toMatchObject({ value: "1", pinnedBy: "deck-option" });
    expect(local.determinism.seed.note).toContain(".options seed=1");
    expect(local.determinism.threads).toMatchObject({ value: "8", pinnedBy: "install-digest" });
    expect(local.determinism.threads.note).toContain("num_threads=8");
    expect(local.floatingPointAndThreadSettings).toEqual(["seed=1 (deck-option)", "num_threads=8 (install-digest)"]);
    const oci = runtimeProfile("ngspice-oci", settingsOf({}));
    expect(oci.determinism.threads).toMatchObject({ value: null, pinnedBy: "image-digest" });
    for (const profile of runtimeProfiles(settingsOf({}))) {
      for (const setting of Object.values(profile.determinism)) expect(setting.note.length, profile.profileId).toBeGreaterThan(10);
      expect(profile.kill.terminalAfter).toBe("exit-observed-or-kill-unconfirmed");
      expect(profile.kill.enforcedBy).toBe("runner");
    }
  });

  it("13. the legacy records are what the code does today: the ngspice allowlist of all three spawners, kicad-cli's allowlist, FreeRouting's allowlist and argv as B22-A1 left them; the FreeRouting contract argv is A1's argv with server placeholders", async () => {
    const local = runtimeProfile("ngspice-local-diagnostic", settingsOf({}));
    const allowlistLine = /const allowed = (\[[^\]]*\]);/;
    for (const site of ["app/lib/spice/server/worker.ts", "app/api/simulate/route.ts", "app/api/spice/models/smoke-test/route.ts"]) {
      expect(local.legacySpawn!.sites, site).toContain(site);
      expect(JSON.parse(read(site).match(allowlistLine)![1]!), site).toEqual(local.legacySpawn!.environment.keys);
    }
    expect(local.legacySpawn!.environment.plus).toEqual(["NODE_ENV"]);
    expect(local.argvTemplates).toEqual({ run: ["-b", "{deckFile}"], version: ["-v"] });
    const kicad = runtimeProfile("kicad-cli-local-diagnostic", settingsOf({}));
    const { KICAD_CLI_ENV_KEYS } = await import("@/app/lib/pcb/fab/kicad-cli-runner");
    expect(kicad.legacySpawn!.environment.keys).toEqual([...KICAD_CLI_ENV_KEYS]);
    const freerouting = runtimeProfile("freerouting-local-diagnostic", settingsOf({}));
    const runner = await import("@/app/lib/pcb/autoroute/runner");
    const everything = Object.fromEntries(["PATH", "Path", "PATHEXT", "SystemRoot", "SystemDrive", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "LANG", "LD_LIBRARY_PATH", "JAVA_HOME", "B22_A2_CANARY_TOKEN", "NODE_ENV"].map((key) => [key, `fake-${key}`]));
    expect(Object.keys(runner.freeroutingEnvironment(everything)).filter((key) => key !== "NODE_ENV").sort()).toEqual([...freerouting.legacySpawn!.environment.keys].sort());
    const markers: Record<string, string> = { "{jarFile}": "<jar path>", "{dsnFile}": "<dsn path>", "{sesFile}": "<ses path>", "{enginePasses}": "<passes>" };
    const built = runner.buildFreeroutingArguments({ freeroutingJarPath: "<jar path>", inPath: "<dsn path>", outPath: "<ses path>", maxPasses: 77 }).map((element) => (element === "77" ? "<passes>" : element));
    expect(freerouting.legacySpawn!.argv.route).toEqual(built);
    expect(freerouting.argvTemplates.route!.map((element) => markers[element] ?? element)).toEqual(built);
    expect(runtimeProfile("ngspice-oci", settingsOf({})).legacySpawn).toBeNull();
    for (const profile of runtimeProfiles(settingsOf({})).filter((candidate) => candidate.legacySpawn !== null)) {
      expect(profile.legacySpawn!.deviations, profile.profileId).toEqual(expect.arrayContaining(["executable-from-path-or-env", "no-digest-check", "host-environment-allowlist", "home-and-userprofile-passed", "no-locale-or-timezone", "direct-child-kill"]));
    }
    const { DEFAULT_WORKER_LIMITS } = await import("@/app/lib/spice/server/worker");
    expect([local.limits.wallClockMs.value, local.limits.readBackBytes.value, local.limits.waveformPoints.value]).toEqual([DEFAULT_WORKER_LIMITS.timeoutMs, DEFAULT_WORKER_LIMITS.maxOutputBytes, DEFAULT_WORKER_LIMITS.maxWaveformPoints]);
    // [B22-A2 review] coverage-5 (discovery 9.5 item 13(c)): FreeRouting's legacy record names every candidate the resolver can
    // pick, derived by driving resolveFreeroutingRuntime with a fake file check (no file is read, nothing is started): each JAR
    // candidate alone, then each java candidate alone
    const { resolveFreeroutingRuntime } = await import("@/app/lib/pcb/autoroute/runtime");
    const cwd = join(tmpdir(), "sirkit-b22-a2-fake-cwd");
    const env = { FREEROUTING_JAR: "fake-env.jar", FREEROUTING_JAVA: "fake-env-java", JAVA_HOME: "fake-java-home" };
    const jarQueries: string[] = [];
    expect(await resolveFreeroutingRuntime({ cwd, env, fileExists: async (path) => { jarQueries.push(path); return false; } })).toMatchObject({ ok: false, error: "jar-missing" });
    const sources = { jar: new Map<string, string>(), java: new Set<string>() };
    for (const jar of jarQueries) {
      const javaQueries: string[] = [];
      const found = await resolveFreeroutingRuntime({ cwd, env, fileExists: async (path) => { if (!jarQueries.includes(path)) javaQueries.push(path); return path === jar; } });
      if (!found.ok) throw new Error("the resolver refused an existing JAR");
      sources.jar.set(found.jarSource, jar);
      sources.java.add(found.javaSource);
      for (const java of javaQueries) {
        const picked = await resolveFreeroutingRuntime({ cwd, env, fileExists: async (path) => path === jar || path === java });
        if (picked.ok) sources.java.add(picked.javaSource);
      }
    }
    const PHRASES = {
      jar: { environment: "FREEROUTING_JAR", "bundled-release": "the bundled release", "source-build": "vendor/freerouting/build/libs/freerouting-current-executable.jar" },
      java: { environment: "FREEROUTING_JAVA", "java-home": "JAVA_HOME", "bundled-jre": "the bundled JRE", path: "java on PATH" },
    } as const;
    expect([...sources.jar.keys()].sort()).toEqual(Object.keys(PHRASES.jar).sort());
    expect([...sources.java].sort()).toEqual(Object.keys(PHRASES.java).sort());
    for (const phrase of [...Object.values(PHRASES.jar), ...Object.values(PHRASES.java)]) expect(freerouting.legacySpawn!.executableFrom, phrase).toContain(phrase);
    // the source-build JAR lies outside the install root the profile digests, and the record says so
    expect(sources.jar.get("source-build")!.split("\\").join("/")).not.toContain("vendor/freerouting/runtime/");
    expect(freerouting.legacySpawn!.executableFrom).toContain("outside the install root");
    // runtime-profiles.md cites the resolver at the lines that hold it (9.5 item 13(c)); each cited range holds its anchor
    const runtimeLines = read("app/lib/pcb/autoroute/runtime.ts").split(NEWLINE);
    const page = read("artifacts/ai-control-plane-b22/runtime-profiles.md");
    for (const [range, anchor] of [["59-69", "source-build"], ["94-97", "env.JAVA_HOME"], ["104-115", "await fileExists(candidate.path)"], ["119-126", 'javaPath: "java"']] as const) {
      expect(page, range).toContain(`\`runtime.ts:${range}\``);
      const [from, to] = range.split("-").map(Number) as [number, number];
      expect(runtimeLines.slice(from - 1, to).join(NEWLINE), range).toContain(anchor);
    }
  });

  it("14. runtime-profiles.md states every field, every profile and every limit's enforcedBy and value as the code holds them", () => {
    const page = read("artifacts/ai-control-plane-b22/runtime-profiles.md");
    expect(page.startsWith("# B22-A2 - ")).toBe(true);
    for (const label of ["CONFIRMED", "INFERRED", "RECORDED", "UNKNOWN"]) expect(page, label).toContain(`**${label}**`);
    const documented = new Set([...page.matchAll(/^\| `([A-Za-z]+)` \|/gm)].map((match) => match[1]));
    for (const key of RUNTIME_PROFILE_KEYS) expect(documented.has(key), key).toBe(true);
    for (const profile of runtimeProfiles(settingsOf({}))) {
      const start = page.indexOf(`${NEWLINE}### \`${profile.profileId}\``);
      expect(start, profile.profileId).toBeGreaterThan(-1);
      const end = page.indexOf(`${NEWLINE}### `, start + 4);
      const section = page.slice(start, end < 0 ? undefined : end);
      const rows = Object.fromEntries([...section.matchAll(/^\| limit `([A-Za-z]+)` \| (os|runner|none) \| ([0-9]+|-) \|/gm)].map((match) => [match[1], [match[2], match[3]]]));
      expect(rows, profile.profileId).toEqual(Object.fromEntries(LIMIT_NAMES.map((name) => [name, [profile.limits[name].enforcedBy, profile.limits[name].value === null ? "-" : String(profile.limits[name].value)]])));
      expect(section, profile.profileId).toContain(`\`${profile.validationState}\``);
      expect(section, profile.profileId).toContain(`\`${profile.executable.digestSetting}\``);
      // [B22-A2 review] coverage-7: a container profile's section names its host client's settings
      if (profile.hostClient !== null) for (const setting of [profile.hostClient.pathSetting, profile.hostClient.digestSetting]) expect(section, setting).toContain(`\`${setting}\``);
    }
  });

  it("15. named digest members: the identity may cover only the install root's named entries - the whole-tree digest when they name every entry, blind to a file beside them, refused for a missing or non-plain member; FreeRouting names the JAR and the JRE because its setup rewrites sirkit-runtime.json beside them on every run", async () => {
    // [B22-A2 review] coverage-4
    const root = fixtureTree(TREE);
    const whole = await installTreeDigest(root);
    const topLevel = [...new Set(TREE.map(([path]) => path.split("/")[0]!))];
    expect(await installTreeDigest(root, { members: topLevel })).toEqual(whole);
    expect(await installTreeDigest(root, { members: null })).toEqual(whole);
    const members = ["bin", "share"];
    const named = await installTreeDigest(root, { members });
    expect(named.sha256).not.toBe(whole.sha256);
    expect(named.fileCount).toBe(TREE.filter(([path]) => members.includes(path.split("/")[0]!)).length);
    // a file beside the members (a manifest rewritten with the time of each setup run) changes the whole tree, not the members' identity
    writeFileSync(join(root, "sirkit-runtime.json"), JSON.stringify({ installedAt: new Date(0).toISOString() }));
    expect((await installTreeDigest(root)).sha256).not.toBe(whole.sha256);
    expect((await installTreeDigest(root, { members })).sha256).toBe(named.sha256);
    expect((await installTreeDigest(root, { members: ["share", "bin"] })).sha256).toBe(named.sha256);
    // a changed byte inside a member changes it
    writeFileSync(join(root, "bin", "ngspice_con.exe"), "MZ fake executable bytez");
    expect((await installTreeDigest(root, { members })).sha256).not.toBe(named.sha256);
    await expect(installTreeDigest(root, { members: ["bin", "absent"] })).rejects.toSatisfy(isDigestError("INSTALL_TREE_MEMBER_MISSING"));
    for (const invalid of [[], ["bin", "bin"], ["."], [".."], ["../x"], ["share/ngspice"], ["share\\ngspice"], [""], ["C:"]]) {
      await expect(installTreeDigest(root, { members: invalid }), JSON.stringify(invalid)).rejects.toSatisfy(isDigestError("INSTALL_TREE_MEMBER_INVALID"));
    }
    // a member that is a link is refused like any link
    symlinkSync(fixtureTree([["x", "x"]]), join(root, "linked"), "junction");
    await expect(installTreeDigest(root, { members: ["bin", "linked"] })).rejects.toSatisfy(isDigestError("INSTALL_TREE_LINK"));
    // the registry: only FreeRouting names members - the JAR and the JRE its resolver takes from the install root - and its executable is inside one
    const { FREEROUTING_JRE_VERSION, FREEROUTING_VERSION } = await import("@/app/lib/pcb/autoroute/runtime");
    for (const profile of runtimeProfiles(settingsOf({}))) {
      expect(profile.executable.digestMembers, profile.profileId).toEqual(profile.profileId === "freerouting-local-diagnostic" ? [`freerouting-${FREEROUTING_VERSION}.jar`, `jdk-${FREEROUTING_JRE_VERSION}-jre`] : null);
    }
    const freerouting = runtimeProfile("freerouting-local-diagnostic", settingsOf({}));
    expect(freerouting.executable.relativePath.startsWith(`jdk-${FREEROUTING_JRE_VERSION}-jre/`)).toBe(true);
    // why: setup writes its manifest into the install root on every run, stamped with the time of the run
    const setup = read("scripts/setup-freerouting.ps1");
    expect(setup).toContain('$RuntimeRoot = Join-Path $VendorRoot "runtime"');
    expect(setup).toMatch(/installedAt = \[DateTime\]::UtcNow/);
    expect(setup).toContain('$manifestPath = Join-Path $RuntimeRoot "sirkit-runtime.json"');
    // the validator: members only on an install tree, plain, unique, non-empty, and covering the executable
    const local = runtimeProfile("ngspice-local-diagnostic", settingsOf({}));
    const oci = runtimeProfile("ngspice-oci", settingsOf({}));
    for (const [profile, value] of [[freerouting, []], [freerouting, ["../runtime"]], [freerouting, ["a/b"]], [freerouting, ["freerouting-2.2.4.jar"]], [freerouting, ["x", "x"]], [local, "bin"], [oci, ["usr"]]] as const) {
      expect(runtimeProfileViolations(edited(profile, "executable.digestMembers", value)), JSON.stringify(value)).toContain("RUNTIME_PROFILE_DIGEST_MEMBERS");
    }
    expect(runtimeProfileViolations(edited(local, "executable.digestMembers", ["bin", "share"]))).not.toContain("RUNTIME_PROFILE_DIGEST_MEMBERS");
  });

  it("16. the OCI run argv: a closed long-option grammar up to {image} (no short flag, no `=` form, no env file, nothing unlisted), --env only as KEY=VALUE, the isolation baseline required and every os claim tied to its flag; each counterexample refused", () => {
    // [B22-A2 review] security-1, coverage-1, tests-2
    const oci = runtimeProfile("ngspice-oci", settingsOf({}));
    const run = [...oci.argvTemplates.run!];
    expect(run).toEqual(OCI_RUN);
    expect(runtimeProfileViolations(oci)).toEqual([]);
    const image = run.indexOf("{image}");
    const at = (token: string): number => {
      const index = run.indexOf(token);
      expect(index, token).toBeGreaterThanOrEqual(0);
      return index;
    };
    /** the run argv with `count` elements from `token` on replaced by `replacement` */
    const swap = (token: string, count: number, replacement: string[]): string[] => [...run.slice(0, at(token)), ...replacement, ...run.slice(at(token) + count)];
    /** the run argv with `extra` options added just before {image} */
    const inject = (extra: string[]): string[] => [...run.slice(0, image), ...extra, ...run.slice(image)];
    const OUT = "/out:rw,noexec,nosuid,nodev,size=128m";
    const MOUNT = "type=bind,source={inputDir},target=/in,readonly";
    const cases: Array<[string, string[], string]> = [
      // every way docker reads an environment other than `--env KEY=VALUE` (a bare NAME copies the docker CLI's own variable)
      ["-e NAME", inject(["-e", "SUPABASE_SERVICE_ROLE_KEY"]), "RUNTIME_PROFILE_OCI_OPTION_REFUSED:-e"],
      ["-eNAME", inject(["-eOPENAI_API_KEY"]), "RUNTIME_PROFILE_OCI_OPTION_REFUSED:-e"],
      ["--env=NAME", inject(["--env=OPENAI_API_KEY"]), "RUNTIME_PROFILE_OCI_OPTION_REFUSED:--env="],
      ["--env-file", inject(["--env-file", "server.env"]), "RUNTIME_PROFILE_OCI_OPTION_REFUSED:--env-file"],
      ["--env-file=", inject(["--env-file=server.env"]), "RUNTIME_PROFILE_OCI_OPTION_REFUSED:--env-file="],
      ["--env NAME", inject(["--env", "OPENAI_API_KEY"]), "RUNTIME_PROFILE_OCI_ENV_FORM"],
      ["--env =x", inject(["--env", "=x"]), "RUNTIME_PROFILE_OCI_ENV_FORM"],
      ["--env HOME=/root", inject(["--env", "HOME=/root"]), "RUNTIME_PROFILE_OCI_ENV_MISMATCH"],
      // anything the grammar does not list
      ["--privileged", inject(["--privileged"]), "RUNTIME_PROFILE_OCI_OPTION_REFUSED:--privileged"],
      ["-v", inject(["-v", "/:/host"]), "RUNTIME_PROFILE_OCI_OPTION_REFUSED:-v"],
      ["--volume", inject(["--volume", "/:/host"]), "RUNTIME_PROFILE_OCI_OPTION_REFUSED:--volume"],
      ["--cap-add", inject(["--cap-add", "SYS_ADMIN"]), "RUNTIME_PROFILE_OCI_OPTION_REFUSED:--cap-add"],
      ["--rm=false", swap("--rm", 1, ["--rm=false"]), "RUNTIME_PROFILE_OCI_OPTION_REFUSED:--rm="],
      ["a stray operand", inject(["stray"]), "RUNTIME_PROFILE_OCI_OPTION_REFUSED:operand"],
      ["a repeated option", inject(["--network", "none"]), "RUNTIME_PROFILE_OCI_OPTION_REPEATED:--network"],
      ["an option without its value", [...run.slice(0, image), "--name"], "RUNTIME_PROFILE_OCI_OPTION_VALUE:--name"],
      ["another subcommand", swap("run", 1, ["create"]), "RUNTIME_PROFILE_OCI_SUBCOMMAND"],
      ["no image", swap("{image}", 1, []), "RUNTIME_PROFILE_OCI_IMAGE"],
      ["two images", [...run, "{image}"], "RUNTIME_PROFILE_OCI_IMAGE"],
      ["another program", swap("ngspice", 1, ["sh"]), "RUNTIME_PROFILE_OCI_COMMAND"],
      // the isolation baseline
      ["no --cap-drop", swap("--cap-drop", 2, []), "RUNTIME_PROFILE_OCI_FLAG_REQUIRED:--cap-drop"],
      ["--cap-drop NET_RAW", swap("--cap-drop", 2, ["--cap-drop", "NET_RAW"]), "RUNTIME_PROFILE_OCI_FLAG_REQUIRED:--cap-drop"],
      ["no --security-opt", swap("--security-opt", 2, []), "RUNTIME_PROFILE_OCI_FLAG_REQUIRED:--security-opt"],
      ["--security-opt seccomp=unconfined", swap("--security-opt", 2, ["--security-opt", "seccomp=unconfined"]), "RUNTIME_PROFILE_OCI_FLAG_REQUIRED:--security-opt"],
      ["no --user", swap("--user", 2, []), "RUNTIME_PROFILE_OCI_FLAG_REQUIRED:--user"],
      ["--user 0:0", swap("--user", 2, ["--user", "0:0"]), "RUNTIME_PROFILE_OCI_FLAG_REQUIRED:--user"],
      ["--user root", swap("--user", 2, ["--user", "root"]), "RUNTIME_PROFILE_OCI_FLAG_REQUIRED:--user"],
      ["--user 65534:0", swap("--user", 2, ["--user", "65534:0"]), "RUNTIME_PROFILE_OCI_FLAG_REQUIRED:--user"],
      ["no --cpus", swap("--cpus", 2, []), "RUNTIME_PROFILE_OCI_FLAG_REQUIRED:--cpus"],
      ["--cpus 0", swap("--cpus", 2, ["--cpus", "0"]), "RUNTIME_PROFILE_OCI_FLAG_REQUIRED:--cpus"],
      // each os claim and its flag
      ["no --network", swap("--network", 2, []), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:network"],
      ["--network host", swap("--network", 2, ["--network", "host"]), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:network"],
      ["--network=none", swap("--network", 2, ["--network=none"]), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:network"],
      ["no --read-only", swap("--read-only", 1, []), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:outputDirectory"],
      ["--workdir /", swap("--workdir", 2, ["--workdir", "/"]), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:outputDirectory"],
      ["the output tmpfs without noexec", swap(OUT, 1, ["/out:rw,nosuid,nodev,size=128m"]), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:outputDirectory"],
      ["an unbounded tmpfs", swap("/tmp:rw,noexec,nosuid,nodev,size=16m", 1, ["/tmp:rw,noexec,nosuid,nodev"]), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:outputDirectory"],
      ["no output tmpfs", swap("--tmpfs", 2, []), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:outputDirectory"],
      ["the output tmpfs at 1g", swap(OUT, 1, ["/out:rw,noexec,nosuid,nodev,size=1g"]), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:fileBytes"],
      ["no output tmpfs (file size)", swap("--tmpfs", 2, []), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:fileBytes"],
      ["no --pids-limit", swap("--pids-limit", 2, []), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:processes"],
      ["--pids-limit 128", swap("--pids-limit", 2, ["--pids-limit", "128"]), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:processes"],
      ["no --memory", swap("--memory", 2, []), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:memoryMiB"],
      ["--memory 4096m", swap("--memory", 2, ["--memory", "4096m"]), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:memoryMiB"],
      ["--memory-swap -1", swap("--memory-swap", 2, ["--memory-swap", "-1"]), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:memoryMiB"],
      ["no --ulimit", swap("--ulimit", 2, []), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:cpuSeconds"],
      ["--ulimit cpu=600:600", swap("--ulimit", 2, ["--ulimit", "cpu=600:600"]), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:cpuSeconds"],
      ["a writable input mount", swap(MOUNT, 1, ["type=bind,source={inputDir},target=/in"]), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:inputMount"],
      ["a mount of another source", swap(MOUNT, 1, ["type=bind,source={runDir},target=/in,readonly"]), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:inputMount"],
      ["no input mount", swap("--mount", 2, []), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:inputMount"],
      ["no --rm", swap("--rm", 1, []), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:kill"],
      ["no --name", swap("--name", 2, []), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:kill"],
    ];
    for (const [label, argv, code] of cases) expect(runtimeProfileViolations(edited(oci, "argvTemplates.run", argv)), label).toContain(code);
    // the claim side: a claimed value the argv does not deliver, or a kill the runner cannot address
    expect(runtimeProfileViolations(edited(oci, "argvTemplates.kill", ["kill", "{containerName}"]))).toContain("RUNTIME_PROFILE_OCI_FLAG_CLAIM:kill");
    expect(runtimeProfileViolations(edited(oci, "limits.processes.value", 128))).toContain("RUNTIME_PROFILE_OCI_FLAG_CLAIM:processes");
    expect(runtimeProfileViolations(edited(oci, "inputMount.path", "{runDir}"))).toContain("RUNTIME_PROFILE_OCI_FLAG_CLAIM:inputMount");
    // an os claim no flag delivers (output size: no docker flag caps it, discovery 1.2)
    expect(runtimeProfileViolations(edited(oci, "limits.outputBytes.enforcedBy", "os"))).toContain("RUNTIME_PROFILE_OCI_FLAG_CLAIM:outputBytes");
    // a container profile runs exactly two docker operations: a second template would escape the run grammar
    expect(runtimeProfileViolations(edited(oci, "argvTemplates.debug", ["run", "--privileged", "{image}", "ngspice"]))).toContain("RUNTIME_PROFILE_OCI_OPERATIONS");
    // a local profile's argv is no docker argv: none of these codes apply to it
    expect(runtimeProfileViolations(runtimeProfile("ngspice-local-diagnostic", settingsOf({}))).filter((code) => code.startsWith("RUNTIME_PROFILE_OCI_"))).toEqual([]);
  });

  it("17. every closed code the validator can return has a synthetic counterexample here, so no validator branch goes unexercised", () => {
    // [B22-A2 review] tests-6
    const source = read("app/lib/computation/runtime-profile.ts");
    const validator = source.slice(source.indexOf("// ── the contract validator"));
    expect(validator.length).toBeGreaterThan(1000);
    // a code is a string or template literal that starts with RUNTIME_PROFILE_ (an identifier such as RUNTIME_PROFILE_KEYS is not)
    const codes = new Set<string>([...validator.matchAll(/["`](RUNTIME_PROFILE_[A-Z_]*[A-Z])/g)].map((match) => match[1]!));
    for (const match of validator.matchAll(/RUNTIME_PROFILE_\$\{prefix\}_([A-Z_]*[A-Z])/g)) for (const prefix of ["ARGV", "ENV"]) codes.add(`RUNTIME_PROFILE_${prefix}_${match[1]}`);
    const local = runtimeProfile("ngspice-local-diagnostic", settingsOf({}));
    const oci = runtimeProfile("ngspice-oci", settingsOf({}));
    const run = [...oci.argvTemplates.run!];
    const image = run.indexOf("{image}");
    const counterexamples: Array<[unknown, string]> = [
      [null, "RUNTIME_PROFILE_NOT_OBJECT"],
      [edited(local, "kill", 7), "RUNTIME_PROFILE_NOT_OBJECT:profile.kill"],
      [edited(local, "callerArgs", []), "RUNTIME_PROFILE_UNKNOWN_KEY:profile.callerArgs"],
      [edited(local, "kill", undefined), "RUNTIME_PROFILE_MISSING_KEY:profile.kill"],
      [edited(local, "profileId", "x"), "RUNTIME_PROFILE_UNKNOWN_ID"],
      [edited(local, "argvTemplates.run", []), "RUNTIME_PROFILE_ARGV_EMPTY:run"],
      [edited(local, "argvTemplates.run", [1]), "RUNTIME_PROFILE_ARGV_NOT_STRING:run"],
      [edited(local, "argvTemplates.run", ["{caller}"]), "RUNTIME_PROFILE_ARGV_CALLER_SLOT:run"],
      [edited(local, "argvTemplates.run", ["$X"]), "RUNTIME_PROFILE_ARGV_EXPANSION:run"],
      [edited(local, "environment.PATH", 7), "RUNTIME_PROFILE_ENV_NOT_STRING:PATH"],
      [edited(local, "environment.PATH", "{caller}"), "RUNTIME_PROFILE_ENV_CALLER_SLOT:PATH"],
      [edited(local, "environment.PATH", "%PATH%"), "RUNTIME_PROFILE_ENV_EXPANSION:PATH"],
      [edited(local, "environment.LC_ALL", "en_US.UTF-8"), "RUNTIME_PROFILE_ENV_REQUIRED:LC_ALL"],
      [edited(local, "environment.HOME", "x"), "RUNTIME_PROFILE_ENV_FORBIDDEN_KEY:HOME"],
      [edited(local, "environment.DB_PASSWORD", "x"), "RUNTIME_PROFILE_ENV_SECRET_KEY:DB_PASSWORD"],
      [edited(local, "environmentVariablesAllowlist", []), "RUNTIME_PROFILE_ENV_ALLOWLIST_MISMATCH"],
      [edited(local, "localeAndTimeZone", "x"), "RUNTIME_PROFILE_LOCALE_MISMATCH"],
      [edited(local, "environmentInheritance", "allowlist"), "RUNTIME_PROFILE_ENV_INHERITED"],
      [edited(oci, "argvTemplates.run", ["create", ...run.slice(1)]), "RUNTIME_PROFILE_OCI_SUBCOMMAND"],
      [edited(oci, "argvTemplates.run", [...run.slice(0, image), "-e", "X", ...run.slice(image)]), "RUNTIME_PROFILE_OCI_OPTION_REFUSED:-e"],
      [edited(oci, "argvTemplates.run", [...run.slice(0, image), "--init", ...run.slice(image)]), "RUNTIME_PROFILE_OCI_OPTION_REPEATED:--init"],
      [edited(oci, "argvTemplates.run", [...run.slice(0, image), "--workdir"]), "RUNTIME_PROFILE_OCI_OPTION_VALUE:--workdir"],
      [edited(oci, "argvTemplates.run", run.filter((element) => element !== "{image}")), "RUNTIME_PROFILE_OCI_IMAGE"],
      [edited(oci, "argvTemplates.run", [...run.slice(0, image + 1), "sh"]), "RUNTIME_PROFILE_OCI_COMMAND"],
      [edited(oci, "argvTemplates.run", [...run.slice(0, image), "--env", "X", ...run.slice(image)]), "RUNTIME_PROFILE_OCI_ENV_FORM"],
      [edited(oci, "environment.LANG", "C"), "RUNTIME_PROFILE_OCI_ENV_MISMATCH"],
      [edited(oci, "argvTemplates.run", run.filter((element) => element !== "--cap-drop" && element !== "ALL")), "RUNTIME_PROFILE_OCI_FLAG_REQUIRED:--cap-drop"],
      [edited(oci, "argvTemplates.run", run.map((element) => (element === "none" ? "bridge" : element))), "RUNTIME_PROFILE_OCI_FLAG_CLAIM:network"],
      [edited(oci, "argvTemplates.debug", ["run"]), "RUNTIME_PROFILE_OCI_OPERATIONS"],
      [edited(oci, "hostClient", null), "RUNTIME_PROFILE_HOST_CLIENT"],
      [edited(local, "limits.cpuSeconds.enforcedBy", "kernel"), "RUNTIME_PROFILE_LIMIT_ENFORCEMENT:cpuSeconds"],
      [edited(local, "limits.wallClockMs.value", null), "RUNTIME_PROFILE_LIMIT_VALUE:wallClockMs"],
      [edited(local, "limits.wallClockMs.unit", "s"), "RUNTIME_PROFILE_LIMIT_UNIT:wallClockMs"],
      [edited(local, "limits.wallClockMs.how", ""), "RUNTIME_PROFILE_LIMIT_HOW:wallClockMs"],
      [edited(local, "limits.memoryMiB", { enforcedBy: "os", value: 512, unit: "MiB", how: "a claimed job object" }), "RUNTIME_PROFILE_LOCAL_OS_CLAIM:memoryMiB"],
      [edited(local, "network.enforcedBy", "os"), "RUNTIME_PROFILE_LOCAL_OS_CLAIM:network"],
      [edited(local, "resourceLimits.timeoutMs", 1), "RUNTIME_PROFILE_RESOURCE_LIMITS_MISMATCH:timeoutMs"],
      [edited(local, "inputMount.access", "read-write"), "RUNTIME_PROFILE_INPUT_NOT_READ_ONLY"],
      [edited(local, "networkPolicy", "deny"), "RUNTIME_PROFILE_NETWORK_DENY_UNENFORCED"],
      [edited(oci, "validationState", "validated"), "RUNTIME_PROFILE_VALIDATED_WITHOUT_EVIDENCE"],
      [edited(local, "authoritativeEligible", true), "RUNTIME_PROFILE_AUTHORITATIVE_INELIGIBLE"],
      // the expected digest's shape alone (no CD-10 copy disagrees: an unpinned profile carries none)
      [edited(local, "executable.expectedDigest", { state: "pinned", value: null, reason: null }), "RUNTIME_PROFILE_DIGEST_STATE_MISMATCH"],
      [edited(local, "executable.digestMembers", []), "RUNTIME_PROFILE_DIGEST_MEMBERS"],
      [edited(local, "deterministicDigest", "0".repeat(64)), "RUNTIME_PROFILE_DETERMINISTIC_DIGEST"],
    ];
    const produced = new Set<string>();
    for (const [candidate, code] of counterexamples) {
      expect(runtimeProfileViolations(candidate), code).toContain(code);
      produced.add(code.split(":")[0]!);
    }
    // the shape check, isolated: with the CD-10 copy in agreement it is the only digest violation
    for (const shape of [{ state: "pinned", value: null, reason: null }, { state: "unpinned", value: "x", reason: "setting-absent" }, { state: "unpinned", value: null, reason: "other" }, { state: "pending", value: null, reason: null }]) {
      expect(runtimeProfileViolations(edited(local, "executable.expectedDigest", shape)).filter((code) => code !== "RUNTIME_PROFILE_DETERMINISTIC_DIGEST"), JSON.stringify(shape)).toEqual(["RUNTIME_PROFILE_DIGEST_STATE_MISMATCH"]);
    }
    expect([...codes].filter((code) => !produced.has(code)).sort(), "a validator code without a counterexample").toEqual([]);
    expect([...produced].filter((code) => !codes.has(code)).sort(), "a counterexample for a code the validator no longer has").toEqual([]);
  });

  it("18. a container profile names the host program that runs its argv - the docker CLI - by a path setting and a file digest setting (server configuration, unpinned until B22-A4); a local profile's executable is its own host program; validated needs both digests pinned", () => {
    // [B22-A2 review] coverage-7: `executable` is ngspice INSIDE the image, while argvTemplates run on the host through the docker
    // CLI, which a replaced binary on PATH could otherwise be (threat T9)
    for (const profile of runtimeProfiles(settingsOf({}))) {
      if (profile.executionBackendKind !== "container") {
        expect(profile.hostClient, profile.profileId).toBeNull();
        continue;
      }
      expect(profile.hostClient, profile.profileId).toEqual({
        program: "docker",
        pathSetting: "SIRKIT_OCI_CLI_PATH",
        digestSetting: "SIRKIT_OCI_CLI_SHA256",
        digestAlgorithm: "sha256-file",
        expectedDigest: { state: "unpinned", value: null, reason: "setting-absent" },
        configuration: expect.stringContaining("UNKNOWN"),
      });
    }
    const hex = fakeHex("docker");
    const oci = runtimeProfile("ngspice-oci", settingsOf({}));
    const pinned = runtimeProfile("ngspice-oci", settingsOf({ SIRKIT_OCI_CLI_SHA256: ` ${hex.toUpperCase()} ` }));
    expect(pinned.hostClient!.expectedDigest).toEqual({ state: "pinned", value: hex, reason: null });
    expect(runtimeProfileViolations(pinned)).toEqual([]);
    expect(pinned.deterministicDigest).not.toBe(oci.deterministicDigest);
    // the CD-10 digest names the image, never the client
    expect("executableOrImageDigest" in pinned).toBe(false);
    const malformed = `${hex}0`;
    const refused = runtimeProfile("ngspice-oci", settingsOf({ SIRKIT_OCI_CLI_SHA256: malformed }));
    expect(refused.hostClient!.expectedDigest).toEqual({ state: "unpinned", value: null, reason: "setting-malformed" });
    expect(JSON.stringify(refused)).not.toContain(malformed);
    // the validator: a container profile names its client, a local one does not; the client's keys are closed; its digest's shape holds
    const local = runtimeProfile("ngspice-local-diagnostic", settingsOf({}));
    expect(runtimeProfileViolations(edited(oci, "hostClient", null))).toContain("RUNTIME_PROFILE_HOST_CLIENT");
    expect(runtimeProfileViolations(edited(local, "hostClient", structuredClone(oci.hostClient)))).toContain("RUNTIME_PROFILE_HOST_CLIENT");
    expect(runtimeProfileViolations(edited(oci, "hostClient.fromPath", true))).toContain("RUNTIME_PROFILE_UNKNOWN_KEY:profile.hostClient.fromPath");
    expect(runtimeProfileViolations(edited(oci, "hostClient.pathSetting", ""))).toContain("RUNTIME_PROFILE_HOST_CLIENT");
    expect(runtimeProfileViolations(edited(oci, "hostClient.expectedDigest", { state: "pinned", value: null, reason: null }))).toContain("RUNTIME_PROFILE_HOST_CLIENT");
    // validated needs qualification evidence, the image pinned AND the client pinned
    const image = `registry.example/sirkit/ngspice@sha256:${fakeHex("oci")}`;
    const qualified: Array<readonly [string, unknown]> = [["validationState", "validated"], ["qualificationEvidenceRefs", ["b22-a4:fake-evidence"]]];
    expect(runtimeProfileViolations(editedAll(runtimeProfile("ngspice-oci", settingsOf({ SIRKIT_NGSPICE_OCI_IMAGE: image })), qualified))).toContain("RUNTIME_PROFILE_VALIDATED_WITHOUT_EVIDENCE");
    expect(runtimeProfileViolations(editedAll(runtimeProfile("ngspice-oci", settingsOf({ SIRKIT_NGSPICE_OCI_IMAGE: image, SIRKIT_OCI_CLI_SHA256: hex })), qualified))).not.toContain("RUNTIME_PROFILE_VALIDATED_WITHOUT_EVIDENCE");
    // the threat model's T9 row covers the client
    const t9 = read("artifacts/ai-control-plane-b22/threat-model.md").split(NEWLINE).find((line) => line.startsWith("| T9 |"));
    expect(t9).toContain("docker CLI");
    expect(t9).toContain("`hostClient`");
    // [B22-A2 lead] the check's new issue: an `os` claim is honest only on a container profile whose argv carries its flag; any other
    // backend kind - CD-10's own `sandboxed_process` included - is refused an `os` claim, exactly as a local profile is
    const sandboxed = runtimeProfileViolations(edited(oci, "executionBackendKind", "sandboxed_process"));
    expect(sandboxed).toContain("RUNTIME_PROFILE_LOCAL_OS_CLAIM:network");
    expect(sandboxed.filter((code) => code.startsWith("RUNTIME_PROFILE_LOCAL_OS_CLAIM:")).length).toBeGreaterThan(1);
  });
});
