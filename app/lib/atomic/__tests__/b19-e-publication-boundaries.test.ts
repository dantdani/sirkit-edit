/**
 * [B19-E E4] The boundaries around two-person atomic publication:
 *  - the new publication modules never import distributor fetch, client, egress or cache code, and never the live external
 *    search (the review is cache-only by construction, not only by test);
 *  - publication, approval, withdrawal and transition tool ids can never be exposed to the agent (NEVER_EXPOSED_TOOL_PATTERNS),
 *    and the publication-review action record is not a tool;
 *  - draft authoring sets source classes by rule: KiCad bytes come from the bundled library read on the server, and a
 *    person-entered terminal table, package or datasheet citation is organization_authored under that person, never
 *    manufacturer_datasheet; a request cannot name a file outside the bundled library.
 *
 * Reproduced on the unchanged code: the modules did not exist, and the never-exposed patterns did not cover any publication
 * or catalog transition id.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NEVER_EXPOSED_TOOL_PATTERNS } from "../../engineering/granted-execution-families";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { ACTION_COVERAGE_REGISTRY } from "../../engineering/action-registry";
import { assembleAtomicDraft, authoringCandidates, bundledKicadLibrary, normalizeAtomicPublicationSpec } from "../authoring";
import { evaluateApproval } from "../validation";
import { fixtureKicadLibrary, ne555Spec, NE555_TERMINALS } from "./_publication-fixtures";

const ROOT = process.cwd();
const NEW_MODULES = [
  "app/lib/acquisition/import-review.ts",
  "app/lib/acquisition/offer-cache-observations.ts",
  "app/lib/atomic/authoring.ts",
  "app/lib/atomic/publication-review.ts",
  "app/lib/atomic/publication-review-contract.ts",
  "app/api/components/atomic/publication/route.ts",
  "app/api/components/atomic/publication/handler.ts",
  "app/components/parts/AtomicPublicationReviewPanel.tsx",
  "app/components/parts/hooks/useAtomicPublicationReview.ts",
  // [PR-M, 2026-10-18] M2.4: the acquisition handoff (the publication route's acquired-asset port) and the object store it reads - both
  // must reach acquired bytes from storage, never through egress (the ratchet grows stricter: two more modules walked)
  "app/lib/component-resolution/acquisition/handoff.ts",
  "app/lib/acquisition/cad-object-store.ts",
];
/** distributor fetch, clients, egress, cache or the barrel that re-exports them; the outbound fetch boundary; the live search
 *  [PR-M, 2026-10-18] M2.2: + the CAD egress (cad-egress.ts) and every CAD source adapter (cad-adapters/): STRICTER - the
 *  publication path reads acquired bytes from storage, through a port, never through a network source */
const VENDOR_REACH = /^app\/lib\/distributors\/(?!types\.ts$|shared\.ts$|lifecycle-sql\.ts$)|^app\/lib\/net\/outbound-fetch\.ts$|^app\/lib\/acquisition\/(external-search|admission-control|cad-egress)\.ts$|^app\/lib\/acquisition\/cad-adapters\//;

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  return null;
}

function runtimeImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specs: string[] = [];
  const pattern = /^\s*(import|export)\s+(?!type\s)([^;]*?)\s+from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
  for (const match of source.matchAll(pattern)) specs.push(match[3] ?? match[4]!);
  for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specs.push(match[1]!);
  return specs;
}

/** Every production module reachable at runtime from `entry` through repository imports (tests are never walked). */
function vendorReach(entry: string): string[] {
  const seen = new Set<string>();
  const offenders: string[] = [];
  const queue = [path.join(ROOT, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const relative = path.relative(ROOT, file).split(path.sep).join("/");
    if (VENDOR_REACH.test(relative)) { offenders.push(relative); continue; }
    for (const spec of runtimeImports(file)) {
      const resolved = resolveImport(file, spec);
      if (resolved && !/__tests__/.test(resolved)) queue.push(resolved);
    }
  }
  return offenders;
}

describe("[B19-E E4] the publication modules cannot reach a vendor", () => {
  it.each(NEW_MODULES)("%s reaches no distributor fetch, client, egress or cache code, and not the live search", (entry) => {
    expect(existsSync(path.join(ROOT, entry)), entry).toBe(true);
    expect(vendorReach(entry)).toEqual([]);
  });

  it("the walker bites: the pricing orchestrator reaches the distributor clients (baseline)", () => {
    expect(vendorReach("app/lib/bom/build.ts").length).toBeGreaterThan(0);
  });
});

describe("[B19-E E4] publication never becomes an agent tool", () => {
  it.each([
    "sirkit.atomic.approve", "sirkit.atomic.publish", "sirkit.atomic.revoke", "sirkit.atomic.deprecate", "sirkit.atomic.supersede", "sirkit.atomic.transition",
    "sirkit.parts.atomic.publish-revision", "sirkit.parts.publication-request", "sirkit.parts.publication-resolve", "sirkit.parts.publication-review",
  ])("%s matches a never-exposed pattern", (toolId) => {
    expect(NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(toolId))).toBe(true);
  });

  it("no registered tool matches the new patterns, and no tool is owned by the publication-review record", () => {
    const added = NEVER_EXPOSED_TOOL_PATTERNS.filter((pattern) => /atomic|publication/.test(pattern.source));
    expect(added).toHaveLength(2);
    const tools = sirkitToolRegistry().list();
    expect(tools.filter((tool) => added.some((pattern) => pattern.test(tool.toolId))).map((tool) => tool.toolId)).toEqual([]);
    expect(tools.filter((tool) => tool.owningCommandId === "parts.atomic-publication-review")).toEqual([]);
    expect(ACTION_COVERAGE_REGISTRY.find((record) => record.id === "parts.atomic-publication-review")?.toolExposure).toBe("none");
  });

  it("the patterns do not catch the read tools that already exist (baseline)", () => {
    for (const toolId of ["sirkit.parts.search", "sirkit.pcb.move-footprint", "sirkit.atomic-parts.read"]) expect(NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(toolId)), toolId).toBe(false);
  });
});

describe("[B19-E E4] draft authoring sets source classes by rule", () => {
  const context = (library = fixtureKicadLibrary()) => ({ authoredBy: "u-catalog-editor", authoredAt: "2026-09-13T12:00:00.000Z", identity: { manufacturerId: null, exactPartId: null, logicalPartId: null, latestRevision: 3 }, library });

  it("the KiCad assets come from the bundled library; the terminal table, package and citation are organization_authored under the person", () => {
    const assembled = assembleAtomicDraft(ne555Spec(), { ...context(), manufacturer: { canonicalName: "Texas Instruments", officialDomains: ["ti.com"] } });
    const classes = [...assembled.catalog.sources.values()].map((source) => source.sourceClass).sort();
    expect(classes).toEqual(["official_kicad_library", "organization_authored"]);
    const organization = [...assembled.catalog.sources.values()].find((source) => source.sourceClass === "organization_authored")!;
    expect(organization.name).toContain("u-catalog-editor");
    expect(JSON.stringify([...assembled.catalog.sources.values()])).not.toContain("manufacturer_datasheet");
    expect(assembled.draft).toMatchObject({ publicationState: "draft", revision: 4, createdBy: "u-catalog-editor" });
    expect(assembled.mapping?.state).toBe("approved");
    expect(assembled.symbol.origin.sourceRecordId).toBe([...assembled.catalog.sourceRecords.values()].find((record) => record.locator.includes("Timer.kicad_symdir/NE555D.kicad_sym"))!.id);
    const decision = evaluateApproval(assembled.draft, "pcb_assignable", assembled.catalog.validationContext());
    expect(decision.blockers).toEqual([]);
    // every engineering candidate the request offers the reviewer is from an engineering-authority class set by rule
    const { candidates } = authoringCandidates(ne555Spec(), context());
    expect([...new Set(candidates.flatMap((candidate) => candidate.facts.map((fact) => fact.sourceClass)))].sort()).toEqual(["official_kicad_library", "organization_authored"]);
  });

  it("a symbol missing from the bundled library yields no symbol candidate (the reviewer sees it missing), never a body-supplied asset", () => {
    const library = fixtureKicadLibrary({ symbols: { "Timer/NE555D": null } });
    const { candidates, diagnostics } = authoringCandidates(ne555Spec(), context(library));
    expect(diagnostics.join(" ")).toMatch(/not in the bundled KiCad library/);
    expect(candidates.flatMap((candidate) => candidate.facts).some((fact) => fact.property === "symbol")).toBe(false);
  });

  it("the spec is closed and bounded: no asset bytes, source classes or reviewer stamps; text is inert", () => {
    const RLO = String.fromCharCode(0x202e);
    expect(normalizeAtomicPublicationSpec({ ...ne555Spec(), symbol: { library: "Timer", name: "NE555D", content: "(kicad_symbol_lib)" } }).ok).toBe(false);
    expect(normalizeAtomicPublicationSpec({ ...ne555Spec(), terminals: [{ number: "1", function: "GND", pads: ["1"], sourceClass: "manufacturer_datasheet" }] }).ok).toBe(false);
    expect(normalizeAtomicPublicationSpec({ ...ne555Spec(), manufacturer: { canonicalName: "TI", officialDomains: [], reviewerId: "u" } }).ok).toBe(false);
    expect(normalizeAtomicPublicationSpec({ ...ne555Spec(), terminals: Array.from({ length: 2_000 }, (_, index) => ({ number: String(index + 1), function: "NC", pads: [String(index + 1)] })) }).ok).toBe(false);
    expect(normalizeAtomicPublicationSpec({ ...ne555Spec(), exactMpn: `NE555DR${RLO}` }).ok).toBe(false);
    const cleaned = normalizeAtomicPublicationSpec({ ...ne555Spec(), terminals: NE555_TERMINALS.map((terminal) => ({ ...terminal, function: `${terminal.function}${RLO}` })), datasheet: { url: "javascript:alert(1)", locator: `Table 1${RLO}` } });
    expect(cleaned.ok).toBe(true);
    if (cleaned.ok) {
      expect(JSON.stringify(cleaned.spec)).not.toContain(RLO);
      expect(cleaned.spec.datasheet?.url).toBeNull();
    }
    for (const name of ["../../../etc/passwd", "Timer/../../x", "NE555D.kicad_sym", ""]) {
      expect(normalizeAtomicPublicationSpec({ ...ne555Spec(), symbol: { library: "Timer", name } }).ok, name).toBe(false);
    }
  });

  it("the server's bundled-library reader never leaves its library directories", () => {
    const root = mkdtempSync(path.join(tmpdir(), "b19e-e4-kicad-"));
    mkdirSync(path.join(root, "data", "kicad-symbols", "Timer.kicad_symdir"), { recursive: true });
    writeFileSync(path.join(root, "data", "kicad-symbols", "Timer.kicad_symdir", "NE555D.kicad_sym"), "(kicad_symbol_lib)");
    writeFileSync(path.join(root, "secret.kicad_sym"), "(secret)");
    const library = bundledKicadLibrary(root);
    expect(library.symbol("Timer", "NE555D")).toBe("(kicad_symbol_lib)");
    expect(library.symbol("Timer", "Missing")).toBeNull();
    for (const [lib, name] of [["..", "secret"], ["Timer", "../../../secret"], ["Timer.kicad_symdir/..", "NE555D"], ["C:", "x"]]) expect(library.symbol(lib!, name!), `${lib}/${name}`).toBeNull();
  });

  it("[B19-E E4 review] a valid reference through a link that leaves the library directory is refused (the realpath containment check)", (context) => {
    const root = mkdtempSync(path.join(tmpdir(), "b19e-e4-kicad-link-"));
    const symbols = path.join(root, "data", "kicad-symbols");
    mkdirSync(path.join(symbols, "Timer.kicad_symdir"), { recursive: true });
    mkdirSync(path.join(root, "outside"), { recursive: true });
    writeFileSync(path.join(root, "outside", "Evil.kicad_sym"), "(secret outside the library)");
    // a file link inside a library directory, or (where file links need privileges) a directory junction standing in for a library
    let fileLink = false;
    try {
      symlinkSync(path.join(root, "outside", "Evil.kicad_sym"), path.join(symbols, "Timer.kicad_symdir", "Evil.kicad_sym"), "file");
      fileLink = true;
    } catch {
      try {
        symlinkSync(path.join(root, "outside"), path.join(symbols, "Evil.kicad_symdir"), "junction");
      } catch {
        context.skip();
      }
    }
    const library = bundledKicadLibrary(root);
    // the reference itself is valid: only the containment check can refuse it
    expect(normalizeAtomicPublicationSpec({ ...ne555Spec(), symbol: fileLink ? { library: "Timer", name: "Evil" } : { library: "Evil", name: "Evil" } }).ok).toBe(true);
    expect(fileLink ? library.symbol("Timer", "Evil") : library.symbol("Evil", "Evil")).toBeNull();
  });
});
