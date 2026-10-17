/**
 * [PR-D] The registry-backed tool manuals gate (assignment D.9):
 *
 *  (a) DRIFT (the digest pin): the manuals regenerated in memory from the current registry and handler modules byte-match the
 *      committed artifacts/product-reliability-simple-ui/manuals/<toolId>.md files, and MANIFEST.json ({ toolId, version, sha256 },
 *      sorted, plus the registry digest) equals the render and the files' own digests - a descriptor or handler change fails here
 *      until `pnpm exec tsx scripts/generate-pr-d-tool-manuals.ts` is re-run and the change reviewed;
 *  (b) coverage: every id in INTENTIONAL_AGENT_EXPOSED_TOOL_IDS and every catalog descriptor has a manual; no manual exists for a
 *      tool outside the catalog (a stale manual fails); the manifest lists exactly the files;
 *  (c) examples: every example of every manual validates against its descriptor's input schema with the project's validator
 *      (tool-io-validation.ts); the render refuses an invalid example; the generation proposal's example is its module's own;
 *  (d) sections: exactly the nine titles, in the fixed order, in every manual;
 *  (e) evidence: every failure code the manual module declares is quoted in the handler file it cites; every cited literal and
 *      every domain unit declaration is found in its file - the manuals state only what the code states;
 *  (f) honesty (D.8): a tool the assistant cannot call opens with NOT available to the assistant and never claims to be callable;
 *      an exposed tool is never marked unavailable; every exposed tool's handler family is classified;
 *  (g) determinism: two renders are identical; LF only; no timestamps.
 *
 * Nothing here names a tool id beyond the generation proposal's example reuse: other builders add tools concurrently and the generator
 * picks them up by re-running.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "../agent-exposure";
import { sirkitToolRegistry } from "../tool-catalog";
import { DEFAULT_INPUT_LIMITS, assertSafeJsonValue, validateAgainstSchema } from "../tool-io-validation";
import { ToolRegistry, type ToolDescriptor } from "../tool-registry";
import { CITED_LITERALS, CLASSIFIED_HANDLER_FAMILIES, DOMAIN_UNIT_DECLARATIONS, HANDLER_CODE_SOURCES, MANUAL_EXAMPLES, MANUAL_SECTION_TITLES, NOT_AVAILABLE, assistantAvailabilityOf, deriveExampleFromSchema, handlerFamilyOf, manualExamplesOf, renderToolManual, renderToolManuals, toolManualFileName, unitsAndFrameOf } from "../tool-manual";
import { AGENT_GENERATION_PROPOSAL_TOOL_ID, GENERATE_PROPOSAL_INPUT_EXAMPLE } from "../../agent/generation-proposals";
import { PR_D_MANUALS_DIR, PR_D_MANUALS_MANIFEST, generateToolManuals, sha256Hex } from "../../../../scripts/generate-pr-d-tool-manuals";

const cwd = process.cwd();
const registry = sirkitToolRegistry();
const generated = generateToolManuals(registry);
const REGENERATE = "run: pnpm exec tsx scripts/generate-pr-d-tool-manuals.ts";
const manualsDir = resolve(cwd, PR_D_MANUALS_DIR);
const readText = (path: string): string => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const committedManualFiles = (): string[] => (existsSync(manualsDir) ? readdirSync(manualsDir).filter((entry) => entry.endsWith(".md")).sort() : []);
const headingsOf = (markdown: string): string[] => markdown.split("\n").filter((line) => line.startsWith("## ")).map((line) => line.slice(3));
const EXPECTED_HEADINGS = MANUAL_SECTION_TITLES.map((title, index) => `${index + 1}. ${title}`);

describe("PR-D tool manuals - (a) the committed manuals equal the render (digest pin)", () => {
  it("every rendered manual is committed byte for byte", () => {
    expect(existsSync(manualsDir), REGENERATE).toBe(true);
    const drifted: string[] = [];
    for (const manual of generated.manuals) {
      const path = resolve(manualsDir, manual.file);
      if (!existsSync(path)) { drifted.push(`${manual.file}: missing`); continue; }
      if (readText(path) !== manual.markdown) drifted.push(`${manual.file}: differs from the render`);
    }
    expect(drifted, REGENERATE).toEqual([]);
  });

  it("MANIFEST.json equals the rendered manifest, lists exactly the committed files sorted by tool id, and every sha256 is the file's", () => {
    const path = resolve(manualsDir, PR_D_MANUALS_MANIFEST);
    expect(existsSync(path), REGENERATE).toBe(true);
    const committed = JSON.parse(readText(path)) as typeof generated.manifest;
    expect(committed, REGENERATE).toEqual(generated.manifest);
    expect(readText(path), REGENERATE).toBe(generated.manifestJson);
    expect(committed.schema).toBe("sirkit.tool-manuals-manifest.v1");
    expect(committed.registryDigest).toBe(registry.digest());
    expect(committed.count).toBe(committed.manuals.length);
    const ids = committed.manuals.map((entry) => entry.toolId);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(committed.manuals.map((entry) => toolManualFileName(entry.toolId)).sort()).toEqual(committedManualFiles());
    for (const entry of committed.manuals) {
      expect(entry).toEqual({ toolId: entry.toolId, version: entry.version, sha256: entry.sha256 });
      expect(entry.sha256, entry.toolId).toMatch(/^[0-9a-f]{64}$/);
      expect(sha256Hex(readText(resolve(manualsDir, toolManualFileName(entry.toolId)))), `${entry.toolId}: sha256 - ${REGENERATE}`).toBe(entry.sha256);
      expect(registry.get(entry.toolId)?.version, entry.toolId).toBe(entry.version);
    }
  });
});

describe("PR-D tool manuals - (b) coverage: every exposed and every registered tool, no stale manual", () => {
  it("every id in INTENTIONAL_AGENT_EXPOSED_TOOL_IDS has a committed manual that marks it available", () => {
    for (const id of INTENTIONAL_AGENT_EXPOSED_TOOL_IDS) {
      const path = resolve(manualsDir, toolManualFileName(id));
      expect(existsSync(path), `${id}: no manual - ${REGENERATE}`).toBe(true);
      const text = readText(path);
      expect(text.includes(`tool id: \`${id}\``), id).toBe(true);
      expect(text.includes(NOT_AVAILABLE), `${id}: an exposed tool is marked unavailable`).toBe(false);
    }
  });

  it("every catalog descriptor has exactly one manual, and every committed manual is a catalog tool (a stale manual fails)", () => {
    const expected = registry.list().map((descriptor) => toolManualFileName(descriptor.toolId)).sort();
    expect(generated.manuals.map((manual) => manual.file)).toEqual(expected);
    expect(committedManualFiles(), `stale or missing manuals - ${REGENERATE}`).toEqual(expected);
    const stale = committedManualFiles().filter((file) => !registry.get(file.replace(/\.md$/, "")));
    expect(stale, `manuals for tools outside the catalog - ${REGENERATE}`).toEqual([]);
    expect(generated.manuals.length).toBe(registry.list().length);
    expect(generated.manuals.length).toBeGreaterThanOrEqual(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
  });

  it("a second version of one tool id is refused (one manual file per id), and a stale directory entry is named by the gate", () => {
    const base = registry.list()[0]!;
    const twice = new ToolRegistry([base, { ...base, version: "9.9.9" }]);
    expect(() => renderToolManuals(twice)).toThrow(/TOOL_MANUAL_DUPLICATE_ID/);
  });
});

describe("PR-D tool manuals - (c) every example validates against its schema with the project's validator", () => {
  it("every example of every descriptor is bounded plain JSON that validates against the descriptor's input schema", () => {
    for (const descriptor of registry.list()) {
      const examples = manualExamplesOf(descriptor);
      expect(examples.length, descriptor.toolId).toBeGreaterThan(0);
      for (const example of examples) {
        expect(example.errors, `${descriptor.toolId}: ${JSON.stringify(example.value)}`).toEqual([]);
        expect(assertSafeJsonValue(example.value, DEFAULT_INPUT_LIMITS, "example"), descriptor.toolId).toEqual([]);
        expect(validateAgainstSchema(example.value, descriptor.inputSchema, "example"), descriptor.toolId).toEqual([]);
      }
      // The manual prints each example verbatim.
      const manual = generated.manuals.find((candidate) => candidate.toolId === descriptor.toolId)!;
      for (const example of examples) expect(manual.markdown.includes(JSON.stringify(example.value, null, 2)), descriptor.toolId).toBe(true);
    }
  });

  it("every curated example names a catalog tool (no example for a tool that does not exist); the generation proposal reuses its module's example", () => {
    expect(Object.keys(MANUAL_EXAMPLES).filter((id) => !registry.get(id))).toEqual([]);
    expect(MANUAL_EXAMPLES[AGENT_GENERATION_PROPOSAL_TOOL_ID]).toEqual([GENERATE_PROPOSAL_INPUT_EXAMPLE]);
    const curated = generated.manuals.filter((manual) => manual.examples.every((example) => example.origin === "curated")).length;
    expect(curated).toBe(Object.keys(MANUAL_EXAMPLES).filter((id) => registry.get(id)).length);
  });

  it("the render refuses an example that does not validate; a schema-derived example validates for every catalog schema", () => {
    // A curated example with at least one key, rendered against a schema that admits none of its keys: the render must refuse.
    const descriptor = registry.list().find((candidate) => (MANUAL_EXAMPLES[candidate.toolId] ?? []).some((example) => Object.keys(example).length > 0))!;
    const broken: ToolDescriptor = { ...descriptor, inputSchema: { type: "object", additionalProperties: false, properties: { onlyThis: { type: "boolean" } }, required: ["onlyThis"] } };
    expect(() => renderToolManual(broken, registry)).toThrow(/TOOL_MANUAL_EXAMPLE_INVALID/);
    for (const candidate of registry.list()) {
      const derived = deriveExampleFromSchema(candidate.inputSchema);
      expect(validateAgainstSchema(derived, candidate.inputSchema, "derived"), candidate.toolId).toEqual([]);
    }
    const unknown: ToolDescriptor = { ...descriptor, toolId: "sirkit.manual.unknown-tool", inputSchema: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, count: { type: "integer" } }, required: ["name"] } };
    const rendered = renderToolManual(unknown, registry);
    expect(rendered.examples.map((example) => example.origin)).toEqual(["derived"]);
    expect(rendered.markdown).toContain("(derived from the schema");
  });
});

describe("PR-D tool manuals - (d) the nine sections in the fixed order", () => {
  it("every manual has exactly the nine section headings in order, and the fixed titles are the assignment's", () => {
    expect([...MANUAL_SECTION_TITLES]).toEqual(["ID and version", "Schema (JSON) with valid examples", "Units and coordinate frame", "Preconditions", "Exact effects", "Permissions and approval", "Budget", "Failure codes", "Postconditions"]);
    for (const manual of generated.manuals) {
      expect(headingsOf(manual.markdown), manual.toolId).toEqual(EXPECTED_HEADINGS);
      expect(manual.markdown.startsWith(`# ${registry.get(manual.toolId)!.title} - \`${manual.toolId}\`\n`), manual.toolId).toBe(true);
      expect(manual.markdown).toContain("Generated by `pnpm exec tsx scripts/generate-pr-d-tool-manuals.ts`");
    }
  });

  it("the schema section prints the registry's input and output schemas verbatim; the failure-code section names a file per stage", () => {
    for (const manual of generated.manuals) {
      const descriptor = registry.get(manual.toolId)!;
      expect(manual.markdown.includes(JSON.stringify(descriptor.inputSchema, null, 2)), manual.toolId).toBe(true);
      expect(manual.markdown.includes(JSON.stringify(descriptor.outputSchema, null, 2)), manual.toolId).toBe(true);
      const failureSection = manual.markdown.split(`## 8. ${MANUAL_SECTION_TITLES[7]}`)[1]!.split("## 9.")[0]!;
      expect(failureSection.includes("`app/lib/agent/loop.ts`"), manual.toolId).toBe(true);
      for (const line of failureSection.split("\n").filter((candidate) => candidate.startsWith("- "))) expect(line, manual.toolId).toMatch(/ - `app\/[^`]+\.ts`/);
    }
  });
});

describe("PR-D tool manuals - (e) every stated code, literal and unit declaration is in the file it cites", () => {
  const sources = new Map<string, string>();
  const fileText = (file: string): string => {
    if (!sources.has(file)) sources.set(file, readText(resolve(cwd, file)));
    return sources.get(file)!;
  };

  it("every failure code of every code source is quoted in its handler file; the stage names its declaring module", () => {
    const missing: string[] = [];
    for (const source of HANDLER_CODE_SOURCES) {
      expect(existsSync(resolve(cwd, source.file)), source.file).toBe(true);
      expect(source.codes.length, source.stage).toBeGreaterThan(0);
      expect(new Set(source.codes).size, source.stage).toBe(source.codes.length);
      const text = fileText(source.file);
      for (const code of source.codes) if (!text.includes(`"${code}"`)) missing.push(`${source.file}: "${code}"`);
    }
    expect(missing).toEqual([]);
    // Today every family declares its own codes: no source falls back to the codes its tests assert.
    expect(HANDLER_CODE_SOURCES.filter((source) => source.declaredBy === "tests")).toEqual([]);
  });

  it("every cited literal is found in its file (a renamed or renumbered constant fails here instead of drifting in a manual)", () => {
    const missing = CITED_LITERALS.filter((literal) => !fileText(literal.file).includes(literal.text)).map((literal) => `${literal.id}: ${literal.file} lacks ${literal.text}`);
    expect(missing).toEqual([]);
  });

  it("every domain unit declaration's evidence is in its file, and every bound module it names exists", () => {
    for (const declaration of DOMAIN_UNIT_DECLARATIONS) {
      expect(fileText(declaration.evidence.file).includes(declaration.evidence.text), `${declaration.evidence.file}: ${declaration.evidence.text}`).toBe(true);
      for (const modulePath of declaration.modules) expect(existsSync(resolve(cwd, modulePath)), modulePath).toBe(true);
    }
  });

  it("a unit or frame is stated only when declared: a descriptor without any declaration prints 'not declared'; a canonical PCB mutation states nanometres and the frame", () => {
    const silent: ToolDescriptor = { ...registry.list()[0]!, toolId: "sirkit.manual.silent", title: "Silent", description: "Reads a thing.", inputSchema: { type: "object", additionalProperties: false, properties: { name: { type: "string" } } }, outputSchema: { type: "object", additionalProperties: false, properties: { result: { type: "object" } }, required: ["result"] }, binding: { status: "bound-read", module: "app/lib/engineering/revision.ts", symbol: "computeProjectRevision" } };
    expect(unitsAndFrameOf(silent)).toEqual([]);
    expect(renderToolManual(silent, registry).markdown).toContain("- not declared:");
    for (const descriptor of registry.list().filter((candidate) => candidate.binding.status === "bound-mutation-editor-session" && candidate.category === "pcb")) {
      const facts = unitsAndFrameOf(descriptor).join("\n");
      expect(facts, descriptor.toolId).toContain("integer nanometres");
      expect(facts, descriptor.toolId).toContain("+x right, +y down");
    }
    for (const descriptor of registry.list().filter((candidate) => candidate.binding.module?.startsWith("app/lib/pcb/ai/"))) expect(unitsAndFrameOf(descriptor).join("\n"), descriptor.toolId).toContain("millimetres");
    for (const descriptor of registry.list().filter((candidate) => candidate.toolId.startsWith("sirkit.computation."))) expect(unitsAndFrameOf(descriptor).join("\n"), descriptor.toolId).toContain("app/lib/computation/catalog.ts");
  });
});

describe("PR-D tool manuals - (f) honesty: an excluded tool is never advertised as callable (D.8)", () => {
  it("a tool the assistant cannot call opens with NOT available and names the registry facts; an exposed tool is classified and never marked unavailable", () => {
    for (const descriptor of registry.list()) {
      const manual = generated.manuals.find((candidate) => candidate.toolId === descriptor.toolId)!;
      const availability = assistantAvailabilityOf(descriptor);
      expect(manual.markdown.includes(`Assistant availability: ${availability}`), descriptor.toolId).toBe(true);
      if (descriptor.agentExposed) {
        expect(manual.family, descriptor.toolId).not.toBe("not-callable");
        expect(manual.family, `${descriptor.toolId}: an exposed tool's handler is not classified in tool-manual.ts`).not.toBe("unclassified");
        expect(availability.includes(NOT_AVAILABLE), descriptor.toolId).toBe(false);
        expect(manual.markdown.includes(NOT_AVAILABLE), descriptor.toolId).toBe(false);
      } else {
        expect(manual.family, descriptor.toolId).toBe("not-callable");
        expect(availability.startsWith(`**${NOT_AVAILABLE}**`), descriptor.toolId).toBe(true);
        expect(availability, descriptor.toolId).toMatch(/agentExposed false|internal-only|callability not-callable|NEVER_EXPOSED|Tier 3/);
        expect(manual.markdown.includes("callable now"), `${descriptor.toolId}: an excluded tool advertised as callable`).toBe(false);
        expect(manual.markdown, descriptor.toolId).toContain("none reachable: the run toolset never offers this tool");
      }
    }
  });

  it("the handler family follows the gateway's dispatch: reads (the B05 service or an own read service), external reads, the MCP read, computations, view-session, the three sealed proposals, the two layout proposals, the generation proposal and the granted executions", () => {
    const families = new Map<string, string[]>();
    for (const descriptor of registry.list().filter((candidate) => candidate.agentExposed)) {
      const family = handlerFamilyOf(descriptor);
      families.set(family, [...(families.get(family) ?? []), descriptor.toolId]);
      expect(CLASSIFIED_HANDLER_FAMILIES, descriptor.toolId).toContain(family);
      if (descriptor.binding.status === "bound-computation") expect(family).toBe("computation");
      else if (descriptor.binding.status === "bound-external-read") expect(["external-read", "mcp-observation"]).toContain(family);
      else if (descriptor.operationClass === "read") expect(["read", "pcb-sync-preflight", "catalog-inspection"], descriptor.toolId).toContain(family);
      else if (descriptor.operationClass === "view-session") expect(family, descriptor.toolId).toBe("view-session");
      else if (descriptor.operationClass === "mutate") expect(family, descriptor.toolId).toBe("granted-execution");
      else expect(["sealed-proposal", "layout-proposal", "generation-proposal"], descriptor.toolId).toContain(family);
    }
    // The families every B18-C.. PR-D exposure already holds; a new family is admitted only through CLASSIFIED_HANDLER_FAMILIES.
    for (const family of ["computation", "external-read", "generation-proposal", "granted-execution", "layout-proposal", "mcp-observation", "read", "sealed-proposal", "view-session"]) expect(families.has(family), family).toBe(true);
    expect(families.has("unclassified")).toBe(false);
    expect(families.has("not-callable")).toBe(false);
  });
});

describe("PR-D tool manuals - (g) determinism", () => {
  it("two renders are identical, LF only, with no timestamp; the manifest is byte-stable", () => {
    const again = generateToolManuals(registry);
    expect(again.manifestJson).toBe(generated.manifestJson);
    expect(again.manuals.map((manual) => manual.markdown)).toEqual(generated.manuals.map((manual) => manual.markdown));
    for (const manual of generated.manuals) {
      expect(manual.markdown.includes("\r"), manual.toolId).toBe(false);
      expect(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}|generatedAt|timestamp/i.test(manual.markdown), manual.toolId).toBe(false);
      expect(manual.markdown.endsWith("\n"), manual.toolId).toBe(true);
    }
    expect(generated.manifestJson.includes("\r")).toBe(false);
    expect(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}|generatedAt|timestamp/i.test(generated.manifestJson)).toBe(false);
  });
});
