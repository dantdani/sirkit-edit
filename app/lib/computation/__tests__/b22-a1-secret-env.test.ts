/**
 * [B22-A1] D22-5 (the half SEC-1 left; OD-148) - kicad-cli no longer inherits the whole server environment: the runner
 * passes `env` equal to an explicit allowlist (what kicad-cli needs to find its install, its per-user settings and a
 * temporary directory - the FreeRouting `freeroutingEnvironment()` precedent; no provider, database, Supabase or distributor
 * key) and `windowsHide: true`.
 *
 * Test-first: run RED on the unmodified tree 0432fb8 (kicad-cli-runner.ts:50-53 passed no `env`, so Node's default
 * `process.env` reached the child, and no `windowsHide`). The ngspice allowlist is SEC-1's and is not touched here
 * (sec-1-deck-injection pins it literally; HOME/USERPROFILE and `-n` stay with B22-A3).
 *
 * No process starts: `child_process` (the bare specifier the runner imports) is an in-process fake that records the spawn
 * options' environment KEY NAMES only, never a value. The canaries are fake names assembled at runtime with fake values.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const spawned = vi.hoisted(() => ({ calls: [] as Array<{ command: string; args: readonly string[]; envKeys: string[] | null; windowsHide: unknown; stdio: unknown; cwd: unknown }> }));
vi.mock("child_process", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: (command: string, args: readonly string[], options?: { env?: Record<string, unknown>; windowsHide?: unknown; stdio?: unknown; cwd?: unknown }) => {
      spawned.calls.push({ command, args: [...args], envKeys: options?.env ? Object.keys(options.env).sort() : null, windowsHide: options?.windowsHide, stdio: options?.stdio, cwd: options?.cwd });
      const child = new EventEmitter() as InstanceType<typeof EventEmitter> & { stdout: InstanceType<typeof EventEmitter>; stderr: InstanceType<typeof EventEmitter>; kill: () => void };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => child.emit("close", 0));
      return child;
    },
  };
});

import * as runner from "@/app/lib/pcb/fab/kicad-cli-runner";

/** The allowlist, pinned literally (a key added to the source fails here). */
const KICAD_CLI_ALLOWLIST = ["PATH", "Path", "PATHEXT", "SystemRoot", "SystemDrive", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "LANG", "LD_LIBRARY_PATH", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "KICAD_CONFIG_HOME"];
const ALLOWED = [...KICAD_CLI_ALLOWLIST, "NODE_ENV"];
/** Secret-shaped NAMES of the kind the server holds, assembled at runtime; the values are obvious fakes. */
const CANARIES = [
  ["SIRKIT", "B22A1", "ENV", "CANARY"],
  ["OPENAI", "API", "KEY"],
  ["ANTHROPIC", "API", "KEY"],
  ["DATABASE", "URL"],
  ["SUPABASE", "SERVICE", "ROLE", "KEY"],
  ["MOUSER", "API", "KEY"],
].map((parts) => parts.join("_"));

afterEach(() => {
  spawned.calls = [];
  vi.unstubAllEnvs();
});

describe("[B22-A1] kicad-cli gets an explicit environment, never the inherited one (D22-5, OD-148)", () => {
  it("the spawn passes env (inside the allowlist, none of the canaries set in this process) and windowsHide, with the stdio and cwd unchanged", async () => {
    for (const name of CANARIES) vi.stubEnv(name, "b22a1-fake-canary");
    vi.stubEnv("PATH", "b22a1-fake-path");
    const result = await runner.runKicadCli({ cliPath: "kicad-cli", args: ["pcb", "export", "gerbers"], cwd: "b22a1-work" });
    expect(result.ok).toBe(true);
    expect(spawned.calls).toHaveLength(1);
    const call = spawned.calls[0]!;
    expect(call.envKeys, "an explicit env option (no option means the whole server environment)").not.toBeNull();
    expect((call.envKeys ?? []).filter((key) => !ALLOWED.includes(key)), "keys outside the allowlist").toEqual([]);
    for (const name of CANARIES) expect(call.envKeys ?? [], name).not.toContain(name);
    expect(call.envKeys, "PATH reaches the child: kicad-cli and its libraries resolve").toContain("PATH");
    expect({ windowsHide: call.windowsHide, stdio: call.stdio, cwd: call.cwd, command: call.command }).toEqual({ windowsHide: true, stdio: "pipe", cwd: "b22a1-work", command: "kicad-cli" });
  });

  it("the allowlist is exactly the reviewed list, and the environment helper keeps only those keys (and NODE_ENV)", () => {
    const helper = (runner as Record<string, unknown>).kicadCliEnvironment as ((env?: Partial<NodeJS.ProcessEnv>) => NodeJS.ProcessEnv) | undefined;
    expect(typeof helper, "kicad-cli-runner exports kicadCliEnvironment").toBe("function");
    expect((runner as Record<string, unknown>).KICAD_CLI_ENV_KEYS).toEqual(KICAD_CLI_ALLOWLIST);
    const env = helper!({ ...Object.fromEntries(CANARIES.map((name) => [name, "b22a1-fake-canary"])), Path: "C:/b22a1/bin", APPDATA: "C:/b22a1/appdata", HOME: "/home/b22a1", NODE_ENV: "test" });
    expect(env).toEqual({ NODE_ENV: "test", Path: "C:/b22a1/bin", APPDATA: "C:/b22a1/appdata", HOME: "/home/b22a1" });
    expect(helper!({})).toEqual({ NODE_ENV: "production" });
  });
});
