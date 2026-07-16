import { describe, expect, it } from "vitest";
import { buildFreeroutingArguments, freeroutingEnvironment, runFreerouting } from "../runner";

describe("Freerouting subprocess isolation", () => {
  it("does not expose Sirkit secrets to the Java child", () => {
    const env = freeroutingEnvironment({
      Path: "C:\\Windows",
      TEMP: "C:\\Temp",
      OPENAI_API_KEY: "secret-openai",
      ANTHROPIC_API_KEY: "secret-anthropic",
      DATABASE_URL: "secret-database",
      MOUSER_API_KEY: "secret-mouser",
    });

    expect(env).toEqual({ NODE_ENV: "production", Path: "C:\\Windows", TEMP: "C:\\Temp" });
  });

  it("forces the CLI offline, headless, and analytics-free", () => {
    const args = buildFreeroutingArguments({
      freeroutingJarPath: "freerouting.jar",
      inPath: "board.dsn",
      outPath: "board.ses",
      maxPasses: 25,
    });

    expect(args).toContain("--gui.enabled=false");
    expect(args).toContain("--api_server.enabled=false");
    expect(args).toContain("-da");
    expect(args).toEqual(expect.arrayContaining(["-de", "board.dsn", "-do", "board.ses", "-mp", "25"]));
    expect(args.join(" ").toLowerCase()).not.toContain("api_key");
  });

  it("honors an already-cancelled job before touching Java or the filesystem", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runFreerouting({
      dsnText: "(pcb test)",
      freeroutingJarPath: "missing.jar",
      signal: controller.signal,
    })).resolves.toMatchObject({ ok: false, error: "cancelled" });
  });
});
