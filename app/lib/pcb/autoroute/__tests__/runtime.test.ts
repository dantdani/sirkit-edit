import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FREEROUTING_JRE_VERSION,
  FREEROUTING_VERSION,
  resolveFreeroutingRuntime,
} from "../runtime";

function fakeFiles(...paths: string[]): (path: string) => Promise<boolean> {
  const available = new Set(paths);
  return async (path) => available.has(path);
}

describe("resolveFreeroutingRuntime", () => {
  const cwd = join("C:", "sirkit-test");
  const bundledJar = join(cwd, "vendor", "freerouting", "runtime", `freerouting-${FREEROUTING_VERSION}.jar`);
  const bundledJava = join(
    cwd,
    "vendor",
    "freerouting",
    "runtime",
    `jdk-${FREEROUTING_JRE_VERSION}-jre`,
    "bin",
    process.platform === "win32" ? "java.exe" : "java",
  );

  it("prefers explicit operator overrides", async () => {
    const jar = join(cwd, "custom", "freerouting.jar");
    const java = join(cwd, "custom", "java.exe");
    await expect(
      resolveFreeroutingRuntime({
        cwd,
        env: { FREEROUTING_JAR: jar, FREEROUTING_JAVA: java },
        fileExists: fakeFiles(jar, java),
      }),
    ).resolves.toMatchObject({
      ok: true,
      jarPath: jar,
      javaPath: java,
      jarSource: "environment",
      javaSource: "environment",
    });
  });

  it("uses Sirkit's pinned release and private Java runtime by default", async () => {
    await expect(
      resolveFreeroutingRuntime({ cwd, env: {}, fileExists: fakeFiles(bundledJar, bundledJava) }),
    ).resolves.toMatchObject({
      ok: true,
      jarPath: bundledJar,
      javaPath: bundledJava,
      version: FREEROUTING_VERSION,
      jarSource: "bundled-release",
      javaSource: "bundled-jre",
    });
  });

  it("falls back to a JAR built from the pinned source clone", async () => {
    const builtJar = join(cwd, "vendor", "freerouting", "build", "libs", "freerouting-current-executable.jar");
    await expect(
      resolveFreeroutingRuntime({ cwd, env: {}, fileExists: fakeFiles(builtJar) }),
    ).resolves.toMatchObject({
      ok: true,
      jarPath: builtJar,
      javaPath: "java",
      jarSource: "source-build",
      javaSource: "path",
    });
  });

  it("gives an actionable local-install error without requesting an API key", async () => {
    const result = await resolveFreeroutingRuntime({ cwd, env: {}, fileExists: fakeFiles() });
    expect(result).toMatchObject({ ok: false, error: "jar-missing" });
    if (!result.ok) {
      expect(result.stderr).toContain("npm run setup:freerouting");
      expect(result.stderr).toContain("no Freerouting API key is required");
    }
  });
});
