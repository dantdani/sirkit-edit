/**
 * Resolve Sirkit's local Freerouting CLI runtime.
 *
 * Resolution is deliberately local-only: an explicit operator override wins,
 * followed by the pinned release installed by `npm run setup:freerouting`, then
 * a JAR built from the cloned source. The hosted Freerouting API is never used.
 */

import { access } from "node:fs/promises";
import { join } from "node:path";

export const FREEROUTING_VERSION = "2.2.4";
export const FREEROUTING_JRE_VERSION = "25.0.3+9";

export type FreeroutingJarSource = "environment" | "bundled-release" | "source-build";
export type FreeroutingJavaSource = "environment" | "java-home" | "bundled-jre" | "path";

export type FreeroutingRuntimeResolution =
  | {
      ok: true;
      jarPath: string;
      javaPath: string;
      version: string;
      jarSource: FreeroutingJarSource;
      javaSource: FreeroutingJavaSource;
    }
  | {
      ok: false;
      error: "jar-missing";
      stderr: string;
    };

interface ResolutionOptions {
  cwd?: string;
  env?: Partial<NodeJS.ProcessEnv>;
  fileExists?: (path: string) => Promise<boolean>;
}

async function defaultFileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveFreeroutingRuntime(
  options: ResolutionOptions = {},
): Promise<FreeroutingRuntimeResolution> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const fileExists = options.fileExists ?? defaultFileExists;
  const runtimeRoot = join(cwd, "vendor", "freerouting", "runtime");

  const jarCandidates: Array<{
    path: string | undefined;
    source: FreeroutingJarSource;
  }> = [
    { path: env.FREEROUTING_JAR?.trim() || undefined, source: "environment" },
    {
      path: join(runtimeRoot, `freerouting-${FREEROUTING_VERSION}.jar`),
      source: "bundled-release",
    },
    {
      path: join(cwd, "vendor", "freerouting", "build", "libs", "freerouting-current-executable.jar"),
      source: "source-build",
    },
  ];

  let jar: (typeof jarCandidates)[number] | undefined;
  for (const candidate of jarCandidates) {
    if (candidate.path && (await fileExists(candidate.path))) {
      jar = candidate;
      break;
    }
  }
  if (!jar?.path) {
    return {
      ok: false,
      error: "jar-missing",
      stderr:
        `Local Freerouting ${FREEROUTING_VERSION} is not installed. ` +
        "Run `npm run setup:freerouting`; no Freerouting API key is required.",
    };
  }

  const executable = process.platform === "win32" ? "java.exe" : "java";
  const javaCandidates: Array<{
    path: string | undefined;
    source: Exclude<FreeroutingJavaSource, "path">;
  }> = [
    { path: env.FREEROUTING_JAVA?.trim() || undefined, source: "environment" },
    {
      path: env.JAVA_HOME ? join(env.JAVA_HOME, "bin", executable) : undefined,
      source: "java-home",
    },
    {
      path: join(runtimeRoot, `jdk-${FREEROUTING_JRE_VERSION}-jre`, "bin", executable),
      source: "bundled-jre",
    },
  ];

  for (const candidate of javaCandidates) {
    if (candidate.path && (await fileExists(candidate.path))) {
      return {
        ok: true,
        jarPath: jar.path,
        javaPath: candidate.path,
        version: FREEROUTING_VERSION,
        jarSource: jar.source,
        javaSource: candidate.source,
      };
    }
  }

  // The runner maps an absent PATH command to the existing `java-missing`
  // result. This preserves compatibility with system-managed Java installs.
  return {
    ok: true,
    jarPath: jar.path,
    javaPath: "java",
    version: FREEROUTING_VERSION,
    jarSource: jar.source,
    javaSource: "path",
  };
}
