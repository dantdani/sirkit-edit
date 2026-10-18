/**
 * [PR-M, 2026-10-18] Section M2 (design M2.2): the reviewed CAD source registry - separate from the distributor registry (whose only
 * authority class stays `sourcing_observation`), validated, its artifact gated byte for byte, the fixture source refused in production,
 * the gitlab.com source refused WHATEVER the environment (OD-M2-3), and no secret shape anywhere.
 *
 * Regenerate the artifact after a reviewed registry change: npx tsx scripts/generate-cad-source-registry.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  admitCadSource, CAD_KICAD_LIBRARY_LICENSE, CAD_SOURCE_ENTRIES, CAD_SOURCE_OPERATOR_DISABLE_ENV, CAD_SOURCE_REGISTRY, CAD_SOURCE_REGISTRY_ARTIFACT, CAD_SOURCE_REGISTRY_VERSION,
  renderCadSourceRegistryCsv, validateCadSourceRegistry, type CadSourceEntry,
} from "@/app/lib/acquisition/cad-source-registry";
import { SOURCE_IDS, SOURCE_REGISTRY } from "@/app/lib/acquisition/source-registry";
import { KICAD_LIBRARY_LICENSE } from "@/app/lib/atomic/authoring";
import { KICAD_LIBRARY_PINS } from "@/app/lib/kicad/pinned-checkout";

function revised(id: CadSourceEntry["id"], change: (entry: Record<string, unknown> & CadSourceEntry) => void): CadSourceEntry[] {
  return CAD_SOURCE_ENTRIES.map((entry) => {
    if (entry.id !== id) return entry;
    const copy = JSON.parse(JSON.stringify(entry)) as Record<string, unknown> & CadSourceEntry;
    change(copy);
    return copy;
  });
}

describe("[PR-M M2.2] the CAD source registry is reviewed, versioned and gated", () => {
  it("validates, and its artifact byte-matches the render", () => {
    expect(validateCadSourceRegistry()).toEqual([]);
    const path = resolve(process.cwd(), CAD_SOURCE_REGISTRY_ARTIFACT);
    expect(existsSync(path), "run: npx tsx scripts/generate-cad-source-registry.ts").toBe(true);
    expect(readFileSync(path, "utf8").replaceAll("\r\n", "\n")).toBe(renderCadSourceRegistryCsv());
    expect(renderCadSourceRegistryCsv()).toContain(`${CAD_SOURCE_REGISTRY_VERSION},kicad-gitlab,blocked,`);
  });

  it("is a separate registry: the distributor registry still proves no CAD fact and names no CAD source", () => {
    for (const id of SOURCE_IDS) expect(SOURCE_REGISTRY[id].authorityClass).toBe("sourcing_observation");
    expect(SOURCE_IDS.some((id) => (CAD_SOURCE_ENTRIES.map((entry) => entry.id) as readonly string[]).includes(id))).toBe(false);
  });

  it("records the pinned refs, the KiCad licence record field for field, and refuses PDFs, archives and 3D", () => {
    for (const entry of CAD_SOURCE_ENTRIES) {
      expect(entry.refs.symbols).toBe(KICAD_LIBRARY_PINS.symbols.commit);
      expect(entry.refs.footprints).toBe(KICAD_LIBRARY_PINS.footprints.commit);
      expect(entry.license.record).toEqual(KICAD_LIBRARY_LICENSE);
      expect(entry.license.retention).toBe("indefinite");
      expect(entry.license.agentDisclosure).toBe("unknown"); // OD-M2-14
      expect(entry.resilience.maxRedirects).toBe(0);
      expect(entry.assets.find((asset) => asset.kind === "model")!.accepted).toBe(false);
    }
    expect(CAD_KICAD_LIBRARY_LICENSE).toEqual(KICAD_LIBRARY_LICENSE);
    expect(CAD_SOURCE_REGISTRY["kicad-bundled"].hosts).toEqual([]);
    expect(CAD_SOURCE_REGISTRY["kicad-gitlab"].hosts).toEqual(["gitlab.com"]);
    expect(CAD_SOURCE_REGISTRY["fixture-kicad"].hosts).toEqual(["cad-fixture.sirkit.test"]);
  });
});

describe("[PR-M M2.2] admission", () => {
  it("the fixture source is refused in production and admitted only when the composition root says the fixture runtime is in force", () => {
    expect(admitCadSource("fixture-kicad", { env: {}, fixtureAllowed: false })).toMatchObject({ admitted: false, refusal: "fixture_only" });
    expect(admitCadSource("fixture-kicad", { env: { SIRKIT_FIXTURE_RUNTIME: "blinker", NODE_ENV: "development" }, fixtureAllowed: false })).toMatchObject({ admitted: false, refusal: "fixture_only" });
    expect(admitCadSource("fixture-kicad", { env: {}, fixtureAllowed: true })).toMatchObject({ admitted: true });
  });

  it("kicad-gitlab is refused whatever the environment (blocked pending OD-M2-3)", () => {
    for (const env of [{}, { GITLAB_TOKEN: "x" }, { [CAD_SOURCE_OPERATOR_DISABLE_ENV]: "" }]) for (const fixtureAllowed of [false, true]) {
      const admission = admitCadSource("kicad-gitlab", { env, fixtureAllowed });
      expect(admission).toMatchObject({ admitted: false, refusal: "blocked" });
      expect((admission as { message: string }).message).toContain("OD-M2-3");
    }
  });

  it("the bundled checkout is admitted; the operator can switch any source off, never on; an unknown id is refused", () => {
    expect(admitCadSource("kicad-bundled", { env: {}, fixtureAllowed: false })).toMatchObject({ admitted: true });
    expect(admitCadSource("kicad-bundled", { env: { [CAD_SOURCE_OPERATOR_DISABLE_ENV]: "kicad-bundled" }, fixtureAllowed: false })).toMatchObject({ admitted: false, refusal: "operator_disabled" });
    expect(admitCadSource("snapeda", { env: {}, fixtureAllowed: true })).toMatchObject({ admitted: false, refusal: "unknown_source" });
  });
});

describe("[PR-M M2.2] the validator refuses what a revision must never contain", () => {
  it.each([
    ["a redirect followed", revised("fixture-kicad", (entry) => { (entry.resilience as { maxRedirects: number }).maxRedirects = 1; }), /redirects must be refused/],
    ["a PDF datasheet", revised("fixture-kicad", (entry) => { (entry.assets as unknown as Array<{ kind: string; mediaTypes: string[] }>).find((asset) => asset.kind === "datasheet")!.mediaTypes = ["application/pdf"]; }), /PDF, archives/],
    ["a 3D model accepted", revised("kicad-bundled", (entry) => { Object.assign((entry.assets as unknown as Array<{ kind: string }>).find((asset) => asset.kind === "model")!, { accepted: true, sourceClass: "official_kicad_library", mediaTypes: ["model/step"], maxBytes: 1000, refusal: "" }); }), /3D assets are refused/],
    ["a non-indefinite retention", revised("kicad-bundled", (entry) => { (entry.license as { retention: string }).retention = "bounded"; }), /only indefinite retention/],
    ["a blocked source disclosed", revised("kicad-gitlab", (entry) => { (entry.license as { agentDisclosure: string }).agentDisclosure = "permitted"; }), /agentDisclosure may not be "permitted"/],
    ["a wildcard host", revised("kicad-gitlab", (entry) => { (entry as unknown as { hosts: string[] }).hosts = ["*.gitlab.com"]; }), /exact lowercase hostname/],
    ["an arbitrary-URL template", revised("fixture-kicad", (entry) => { (entry.operations as unknown as Array<{ kind: string; pathTemplate: string }>)[0]!.pathTemplate = "/{url}"; }), /placeholder \{url\}/],
    ["a secret-shaped value", revised("kicad-gitlab", (entry) => { (entry.auth as { note: string }).note = "glpat-abcdefghijklmnopqrstuvwx"; }), /shaped like a secret/],
    ["a private-review licence", revised("fixture-kicad", (entry) => { (entry.license as { record: { exportDisposition: string } }).record.exportDisposition = "private_review_only"; }), /not storable in a shared library/],
  ])("refuses %s", (_name, entries, pattern) => {
    expect(validateCadSourceRegistry(entries).join("\n")).toMatch(pattern);
  });

  it("the registry text carries no secret shape", () => {
    expect(JSON.stringify(CAD_SOURCE_ENTRIES)).not.toMatch(/sk-ant-|sk-[A-Za-z0-9]{32}|glpat-|ghp_|AKIA|BEGIN [A-Z ]*PRIVATE KEY/);
  });
});
