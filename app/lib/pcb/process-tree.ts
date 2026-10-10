/**
 * [B24-D2] D24-31, OD-145's method for FreeRouting's and kicad-cli's runners: end a child's whole process tree as B22-A3's
 * `killDiagnosticProcessTree` ends ngspice's (`app/lib/computation/diagnostic-runner.ts`, untouched).
 *
 *  - win32: `taskkill.exe` under `%SystemRoot%\System32` with the fixed argv `/PID <pid> /T /F`, only `{ SystemRoot }` in its environment,
 *    `windowsHide` and no shell; then the direct child, as a fallback, once taskkill ends (or fails to start);
 *  - POSIX: SIGKILL to the process group the detached child leads, the direct child only when the group is gone;
 *  - a child with no pid (never started): the direct kill only.
 *
 * The caller passes the place (`treeKillPlace`: the platform, and the Windows directory read once per run), an `alive()` predicate and
 * the killer's `spawn`, so this module names no process module: the app's process spawners stay the runners themselves. No path built
 * from an unchecked environment value is ever started - a Windows directory that is not an absolute path under B22-A3's rule
 * (`diagnostic-runner.ts` preflight) leaves the direct kill only.
 */
import { win32 } from "node:path";

/** B22-A3's absolute-path rule for the Windows directory (the diagnostic runner's preflight). */
export const WINDOWS_DIRECTORY_PATTERN = /^[A-Za-z]:\\[^;%"]*$/;
/** How long a killed run waits for its child's exit before it settles anyway (B22-A3's DIAGNOSTIC_KILL_CONFIRM_MS). */
export const TREE_KILL_CONFIRM_MS = 5_000;

/** Where the tree kill runs: win32 or POSIX, and on win32 the checked Windows directory (null when unset or not absolute). */
export interface TreeKillPlace {
  readonly win32: boolean;
  readonly systemRoot: string | null;
}

/** The child as the kill needs it (a `ChildProcess` satisfies it). */
export interface TreeKillChild {
  readonly pid?: number;
  kill(signal?: NodeJS.Signals | number): boolean;
}

/** The killer's spawn, passed in by the runner (its own `spawn`). */
export type TreeKillSpawn = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; windowsHide: true; shell: false; stdio: "ignore" },
) => { once(event: "error" | "close", listener: () => void): unknown };

/** How the tree was ended: taskkill /T, the POSIX group, or the direct child alone. */
export type TreeKillMethod = "taskkill-tree" | "process-group" | "direct-only";

/** The place, from the platform name and the Windows directory as the environment holds it (read by the caller, once per run). */
export function treeKillPlace(platform: string, systemRoot: string | undefined): TreeKillPlace {
  const win = platform === "win32";
  return { win32: win, systemRoot: win && typeof systemRoot === "string" && WINDOWS_DIRECTORY_PATTERN.test(systemRoot) ? systemRoot : null };
}

/** End `child`'s tree (see the header). Never throws; the caller observes the exit (`close`) to confirm it. */
export function killProcessTree(child: TreeKillChild, place: TreeKillPlace, alive: () => boolean, spawnKiller: TreeKillSpawn): TreeKillMethod {
  const direct = (): void => {
    if (!alive()) return;
    try {
      child.kill("SIGKILL");
    } catch {
      // the caller records whether the exit was observed
    }
  };
  const pid = child.pid;
  if (pid === undefined) {
    direct();
    return "direct-only";
  }
  if (place.win32) {
    if (place.systemRoot === null) {
      direct();
      return "direct-only";
    }
    try {
      // taskkill's one variable; the cast only satisfies Next's ProcessEnv augmentation (it declares NODE_ENV, which is not passed)
      const systemRootOnly = { SystemRoot: place.systemRoot } as unknown as NodeJS.ProcessEnv;
      const killer = spawnKiller(win32.join(place.systemRoot, "System32", "taskkill.exe"), ["/PID", String(pid), "/T", "/F"], { env: systemRootOnly, windowsHide: true, shell: false, stdio: "ignore" });
      killer.once("error", direct);
      killer.once("close", direct);
    } catch {
      direct();
    }
    return "taskkill-tree";
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    direct();
  }
  return "process-group";
}
