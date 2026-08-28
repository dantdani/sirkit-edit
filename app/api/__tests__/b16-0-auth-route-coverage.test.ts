/**
 * B16.0 §CI — the authentication-route coverage registry.
 *
 * Every route in the B01 enumeration receives an auth classification; the
 * release-perimeter routes are migrated to the trusted context; the committed
 * CSV is byte-stable.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { API_ROUTE_COVERAGE } from "@/app/lib/engineering/action-registry";
import { buildAuthRouteCoverage, renderAuthRouteCoverageCsv } from "@/app/lib/auth/route-coverage";

describe("B16.0 §CI — auth route coverage", () => {
  it("every enumerated API route has an auth classification (item 28)", () => {
    const coverage = buildAuthRouteCoverage();
    expect(coverage).toHaveLength(API_ROUTE_COVERAGE.length);
    for (const entry of coverage) {
      expect(entry.authClass, entry.path).toBeTruthy();
      expect(entry.identitySource, entry.path).toBeTruthy();
    }
  });

  it("the release-perimeter routes are migrated to the trusted context (items 24-27)", () => {
    const byPath = new Map(buildAuthRouteCoverage().map((e) => [e.path, e]));
    for (const path of ["/api/pcb-sync", "/api/pcb/qualify", "/api/pcb/release", "/api/physical-bindings", "/api/assignment-queue"]) {
      const entry = byPath.get(path);
      expect(entry, path).toBeDefined();
      expect(entry!.identitySource, path).toBe("trusted-context");
      expect(entry!.migrated, path).toBe(true);
    }
    // qualify/release are release-class.
    expect(byPath.get("/api/pcb/release")!.authClass).toBe("authenticated-release");
    expect(byPath.get("/api/pcb/qualify")!.authClass).toBe("authenticated-release");
    // /api/chat is a provider-credit route with a server-synthesized actor.
    expect(byPath.get("/api/chat")!.identitySource).toBe("body-scope-server-actor");
    // worker routes are the internal-worker class.
    expect(byPath.get("/api/engineering-effects")!.authClass).toBe("internal-worker");
  });

  it("render is deterministic and the committed CSV is byte-identical", () => {
    const first = renderAuthRouteCoverageCsv();
    expect(renderAuthRouteCoverageCsv()).toBe(first);
    const path = join(process.cwd(), "artifacts", "ai-control-plane-b16-0", "auth-route-coverage.csv");
    expect(existsSync(path), "run: npx tsx scripts/generate-b16-0-artifacts.ts").toBe(true);
    expect(readFileSync(path, "utf8").replaceAll("\r\n", "\n")).toBe(first);
  });
});
