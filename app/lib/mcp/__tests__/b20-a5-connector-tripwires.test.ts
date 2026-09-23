/**
 * [B20 A5] The tripwires that make "no provider-native connector is rendered, and no credential Sirkit holds reaches a
 * provider request" structural (OD-90, OD-45), over the whole production tree:
 *   T1 no production file carries the connector wire vocabulary;
 *   T2 exactly five production modules import a provider SDK at run time;
 *   T3 none of those five reaches `app/lib/mcp/**` or the MCP bearer module through its runtime import closure;
 *   T4 the shape pins of the two new modules, the adapters' client types and every SDK client construction;
 *   T5/T6 the pages state what this increment delivered, and every citation on the new page resolves (S7);
 *   T7 the citations into the two files A5 moved still resolve on the EARLIER pages that carry them.
 * These pin EXISTING behaviour and are green before any A5 code but T4's two new-module pins and T5-T7's pages.
 *
 * Reading only: nothing is written, and nothing reaches a network.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { collectProductionFiles, moduleImportOffenders, moduleReferences, resolveSpecifier, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { importClosure, runtimeDeclarationSpecifiers } from "../server/__tests__/_import-closure";
import { ANTHROPIC_HANDLED_BLOCK_TYPES, OPENAI_HANDLED_OUTPUT_TYPES } from "../../agent/provider-output-guard";
import { PROVIDER_CONNECTOR_REFUSALS, PROVIDER_CONNECTOR_REFUSAL_CLASSES } from "../provider-connector-policy";

const ROOT = process.cwd();
const production = collectProductionFiles(ROOT);
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

/**
 * D6 — the connector wire vocabulary. The body-field and item-type spellings are matched CASE-SENSITIVELY (Sirkit's own
 * `MCP_CALL_…` and `MCP_TOOL_LISTING` constants are not connector vocabulary); header names, header values and provider
 * hosts are matched case-folded. There is no allowlist: any hit is a reviewed pin move.
 */
const D6_TOKENS = [
  "mcp_servers", "mcp_toolset", "mcp_server_name", "mcp_tool_listing", "authorization_token", "server_url", "server_label",
  "server_description", "connector_id", "tunnel_id", "require_approval", "allowed_tools", "defer_loading", "default_config",
  "mcp_approval", "mcp_list_tools", "mcp_call", "mcp_tool_use", "mcp_tool_result",
];
const D6_FOLDED = ["anthropic-beta", "mcp-client-20", "api.openai.com", "api.anthropic.com"];
const D6_PATTERNS = [/["'`]?type["'`]?\s*:\s*["'`]mcp["'`]/, /\.beta\./, /\bbetas\b/];

function connectorVocabularyOffenders(files: FileMap): string[] {
  const offenders: string[] = [];
  for (const [path, source] of files) {
    const folded = source.toLowerCase();
    const hits = [
      ...D6_TOKENS.filter((token) => source.includes(token)),
      ...D6_FOLDED.filter((token) => folded.includes(token)),
      ...D6_PATTERNS.filter((pattern) => pattern.test(source)).map((pattern) => `/${pattern.source}/`),
    ];
    if (hits.length > 0) offenders.push(`${path}: ${hits.join(", ")}`);
  }
  return offenders;
}

/** the provider SDKs, as a specifier resolves (the package itself or any subpath) */
const SDK_SPECIFIER = /^(?:openai|@anthropic-ai\/sdk)(?:\/.*)?$/;
/** Files that import a provider SDK for its VALUES — the edge rule of `importClosure`, applied to a bare specifier. */
function sdkImporters(files: FileMap): string[] {
  const importers: string[] = [];
  for (const [path, source] of files) {
    const runtime = runtimeDeclarationSpecifiers(path, source);
    const hit = moduleReferences(path, source).some((reference) => {
      if (reference.kind === "import-type" || !SDK_SPECIFIER.test(reference.specifier)) return false;
      return (reference.kind !== "static-import" && reference.kind !== "re-export") || runtime.has(reference.specifier);
    });
    if (hit) importers.push(path);
  }
  return importers.sort();
}

const SDK_FILES = [
  "app/lib/agent/adapters.ts",
  "app/lib/embeddings.ts",
  "app/lib/llm/anthropic-provider.ts",
  "app/lib/llm/openai-provider.ts",
  "app/lib/parts-search.ts",
];
const MCP_BEARER = "app/lib/auth/mcp-bearer.ts";
const SUITES = [
  "app/lib/mcp/__tests__/b20-a5-provider-connector-policy.test.ts",
  "app/lib/mcp/__tests__/b20-a5-provider-request-shape.test.ts",
  "app/lib/mcp/__tests__/b20-a5-provider-output-guard.test.ts",
  "app/lib/mcp/__tests__/b20-a5-connector-tripwires.test.ts",
];
const PAGE = "artifacts/ai-control-plane-b20/mcp-provider-connectors.md";
const NOTES = "artifacts/ai-control-plane-b20/mcp-reference-notes.md";

describe("[B20 A5] the connector tripwires (OD-90, OD-45)", () => {
  it("T1. no production file carries the connector wire vocabulary, and the scanner catches every token", { timeout: 120_000 }, () => {
    expect(production.size).toBeGreaterThan(500);
    for (const file of SDK_FILES) expect(production.has(file), file).toBe(true);
    expect(connectorVocabularyOffenders(production)).toEqual([]);

    // non-vacuity: every token, in a synthetic map
    for (const token of [...D6_TOKENS, ...D6_FOLDED]) {
      expect(connectorVocabularyOffenders(new Map([["app/lib/x.ts", `const a = "${token}";`]])), token).toHaveLength(1);
    }
    for (const spelling of ['{ type: "mcp" }', "{ type: 'mcp' }", "{ type: `mcp` }", '{ "type": "mcp" }']) {
      expect(connectorVocabularyOffenders(new Map([["app/lib/x.ts", `const a = ${spelling};`]])), spelling).toHaveLength(1);
    }
    for (const spelling of ["client.beta.messages.create({})", "const x = { betas: [] };"]) {
      expect(connectorVocabularyOffenders(new Map([["app/lib/x.ts", spelling]])), spelling).toHaveLength(1);
    }
    // header names and provider hosts are case-folded
    expect(connectorVocabularyOffenders(new Map([["app/lib/x.ts", 'headers["Anthropic-Beta"] = "MCP-Client-2026-09-15";']]))).toHaveLength(1);
    expect(connectorVocabularyOffenders(new Map([["app/lib/x.ts", 'const host = "API.OPENAI.COM";']]))).toHaveLength(1);
    // and Sirkit's own vocabulary is not connector vocabulary
    expect(connectorVocabularyOffenders(new Map([
      ["app/lib/a.ts", 'const channel = { type: "mcp-exposure" };'],
      ["app/lib/b.ts", "const ALLOWED_TOOLS = new Set();"],
      ["app/lib/c.ts", "const MCP_CALL_REDACTION_SUBJECTS_MAX = 64;"],
      ["app/lib/d.ts", "const MCP_TOOL_LISTING = 'sirkit.mcp-tool-listing.v1';"],
    ]))).toEqual([]);
  });

  it("T2. exactly five production modules import a provider SDK at run time, and a type-only import is not one of them", { timeout: 120_000 }, () => {
    expect(sdkImporters(production)).toEqual([...SDK_FILES].sort());

    const synthetic: FileMap = new Map([
      ["app/lib/type-only.ts", 'import type OpenAI from "openai";\nexport type T = OpenAI;'],
      ["app/lib/named-type-only.ts", 'import { type Response } from "openai/resources/responses/responses";\nexport type R = Response;'],
      ["app/lib/dynamic.ts", 'export const load = () => import("openai");'],
      ["app/lib/required.ts", 'const A = require("@anthropic-ai/sdk/x");\nexport const a = A;'],
      ["app/lib/static.ts", 'import Anthropic from "@anthropic-ai/sdk";\nexport const a = Anthropic;'],
      ["app/lib/re-export.ts", 'export { default } from "openai";'],
      ["app/lib/unrelated.ts", 'import { join } from "node:path";\nexport const j = join;'],
    ]);
    expect(sdkImporters(synthetic)).toEqual(["app/lib/dynamic.ts", "app/lib/re-export.ts", "app/lib/required.ts", "app/lib/static.ts"]);
  });

  it("T3. no provider-SDK module reaches app/lib/mcp/** or the MCP bearer module through its runtime import closure (OD-45)", { timeout: 120_000 }, () => {
    const closure = importClosure(production, SDK_FILES);
    expect(closure.size).toBeGreaterThan(SDK_FILES.length);
    const reached = [...closure].filter(([file]) => file.startsWith("app/lib/mcp/") || file === MCP_BEARER).map(([, chain]) => chain.join(" -> "));
    expect(reached).toEqual([]);
    // the modules A3 and A4 added under app/lib/mcp/ are in the tree, so the forbid is about them too
    for (const file of ["app/lib/mcp/authorization.ts", "app/lib/mcp/agent-port.ts", "app/lib/mcp/http-transport.ts", "app/lib/mcp/tool-call.ts", MCP_BEARER]) {
      expect(production.has(file), file).toBe(true);
    }

    // non-vacuity: a new SDK module that reaches the MCP client is reported with the chain that reaches it
    const injected = new Map(production);
    injected.set("app/lib/agent/evil-provider.ts", 'import OpenAI from "openai";\nimport { callMcpTool } from "../mcp/tool-call";\nexport const x = [OpenAI, callMcpTool];');
    injected.set("app/lib/agent/evil-case.ts", 'import OpenAI from "openai";\nimport { callMcpTool } from "../MCP/tool-call";\nexport const x = [OpenAI, callMcpTool];');
    injected.set("app/lib/agent/evil-bearer.ts", 'import OpenAI from "openai";\nimport { MCP_TOKEN_SECRET_ENV } from "../auth/mcp-bearer";\nexport const x = [OpenAI, MCP_TOKEN_SECRET_ENV];');
    injected.set("app/lib/agent/types-only.ts", 'import OpenAI from "openai";\nimport type { McpServerRegistryEntry } from "../mcp/server-registry";\nexport const x = OpenAI;\nexport type E = McpServerRegistryEntry;');
    const reaches = (entry: string): string[] =>
      [...importClosure(injected, [entry])].filter(([file]) => file.startsWith("app/lib/mcp/") || file === MCP_BEARER).map(([, chain]) => chain.join(" -> "));
    expect(reaches("app/lib/agent/evil-provider.ts")[0]).toBe("app/lib/agent/evil-provider.ts -> app/lib/mcp/tool-call.ts");
    expect(reaches("app/lib/agent/evil-case.ts")[0]).toBe("app/lib/agent/evil-case.ts -> app/lib/mcp/tool-call.ts");
    expect(reaches("app/lib/agent/evil-bearer.ts")[0]).toBe(`app/lib/agent/evil-bearer.ts -> ${MCP_BEARER}`);
    expect(reaches("app/lib/agent/types-only.ts")).toEqual([]);
    expect(sdkImporters(injected)).toContain("app/lib/agent/evil-provider.ts");
  });

  it("T4. shape pins: the guard imports nothing, the adapters import it, the policy has no production importer, and every SDK client takes only apiKey, maxRetries and timeout", { timeout: 120_000 }, () => {
    const GUARD = "app/lib/agent/provider-output-guard.ts";
    const POLICY = "app/lib/mcp/provider-connector-policy.ts";
    expect(moduleReferences(GUARD, production.get(GUARD)!)).toEqual([]);
    expect([...runtimeDeclarationSpecifiers("app/lib/agent/adapters.ts", production.get("app/lib/agent/adapters.ts")!)]).toContain("./provider-output-guard");

    expect(moduleImportOffenders(production, POLICY.replace(/\.ts$/, ""), new Set())).toEqual([]);
    const policySource = production.get(POLICY)!;
    const policyRuntime = moduleReferences(POLICY, policySource)
      .filter((reference) => reference.kind !== "import-type" && ((reference.kind !== "static-import" && reference.kind !== "re-export") || runtimeDeclarationSpecifiers(POLICY, policySource).has(reference.specifier)))
      .map((reference) => reference.specifier);
    expect(policyRuntime).toEqual(["./server-registry"]);
    for (const reference of policyRuntime) expect(resolveSpecifier(POLICY, reference)).toEqual({ kind: "module", module: "app/lib/mcp/server-registry" });

    const adapters = production.get("app/lib/agent/adapters.ts")!;
    for (const pin of ['Pick<OpenAI, "responses">', 'Pick<Anthropic, "messages">']) {
      expect(adapters.split(pin).length - 1, pin).toBe(1);
    }

    // every SDK client construction, by AST: exactly six, each with ONE object-literal argument of known option keys
    const constructions: string[] = [];
    for (const file of SDK_FILES) {
      const source = production.get(file)!;
      for (const name of ["defaultHeaders", "defaultQuery", "baseURL"]) expect(source, `${file} names ${name}`).not.toContain(name);
      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const visit = (node: ts.Node): void => {
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === "OpenAI" || node.expression.text === "Anthropic")) {
          constructions.push(`${file}:${node.expression.text}`);
          expect(node.arguments?.length, `${file} ${node.expression.text}`).toBe(1);
          const argument = node.arguments![0]!;
          expect(ts.isObjectLiteralExpression(argument), `${file} ${node.expression.text}`).toBe(true);
          for (const property of (argument as ts.ObjectLiteralExpression).properties) {
            // a named option only: a plain `key: value`, or the shorthand `{ apiKey }`. A spread or a computed name would
            // put an unreviewed option on a provider client and is refused here.
            const named = (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)))
              || ts.isShorthandPropertyAssignment(property);
            expect(named, `${file} option kind ${ts.SyntaxKind[property.kind]}`).toBe(true);
            const key = (property.name as ts.Identifier | ts.StringLiteral).text;
            expect(["apiKey", "maxRetries", "timeout"], `${file} option ${key}`).toContain(key);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);
    }
    expect(constructions).toHaveLength(6);
  });

  it("T5. the pages state what A5 delivered: the closed refusal in order, the handled types, every suite's case count and the dated re-read (S7)", () => {
    const page = read(PAGE);
    const table = page.slice(page.indexOf("## The closed refusal"), page.indexOf("## What enforces it"));
    expect(table.length, "the closed-refusal section exists").toBeGreaterThan(500);
    const rows = [...table.matchAll(/^\|\s*`([a-z_]+)`\s*\|\s*([a-z]+)\s*\|/gm)];
    expect(rows.map((row) => row[1])).toEqual([...PROVIDER_CONNECTOR_REFUSALS]);
    expect(rows.map((row) => row[2])).toEqual(PROVIDER_CONNECTOR_REFUSALS.map((code) => PROVIDER_CONNECTOR_REFUSAL_CLASSES[code]));

    const list = (types: readonly string[]): string => types.map((type) => `\`${type}\``).join(", ");
    expect(page).toContain(`handled OpenAI output item types: ${list(OPENAI_HANDLED_OUTPUT_TYPES)}`);
    expect(page).toContain(`handled Anthropic content block types: ${list(ANTHROPIC_HANDLED_BLOCK_TYPES)}`);

    let total = 0;
    for (const suite of SUITES) {
      const cases = (read(suite).match(/^\s*it\(/gm) ?? []).length;
      expect(cases, suite).toBeGreaterThan(0);
      total += cases;
      expect(page, suite).toContain(`\`${suite}\` — ${cases} cases`);
    }
    expect(page).toContain(`A5 total: ${total} cases`);
    for (const named of ["OD-45", "OD-90", "OD-91", "OD-92", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, named).toContain(named);

    // [B20 A5 review] the OD-91 bullet must state the behaviour CHANGE at item level, not parity: before A5 only a
    // non-array list threw, and a malformed ITEM inside a well-formed list was round-tripped into the continuation.
    expect(page).toContain("a malformed list fails `provider_unknown` as it did before A5");
    expect(page).toContain("a malformed ITEM now fails the run too");
    expect(page).not.toContain("a malformed list or item fails `provider_unknown`, as it did before A5");
    // [B20 A5 review] the claim that no other page's citations shift was false: four pages cite the two files A5 moved
    expect(page).not.toContain("no other page's citations shift");
    // [B20 A5 review] the B09 row the reconciliation is about is cited, not only the neighbouring `thinking` row
    expect(page).toContain("artifacts/ai-control-plane-b09/provider-continuation-matrix.md:7");

    // [B20 A5 review] OD-92 is the one artifact whose job is to enumerate what a future connector may not carry, and it
    // must name every credential-bearing and server-reference field the A5 re-read recorded, plus A4L's per-tool
    // allowlist — a connector built strictly to OD-92 must not be weaker than the landed Sirkit-mediated policy.
    const od92 = page.slice(page.indexOf("## OD-92"), page.indexOf("## Sirkit's own endpoint"));
    expect(od92.length, "the OD-92 section exists").toBeGreaterThan(500);
    const OD92_CONDITIONS = [
      "NON-EMPTY `agentTools`",                                        // (2) the row requirement
      "sorted INTERSECTION of the row's `agentTools` allowlist",       // (6) the rendered allowed-tool list
      "no tunnel reference (`tunnel_id`)",                             // (8) the forbidden fields
      "no provider-hosted connector id (`connector_id`)",              // (8) the forbidden fields
      "`agentTools` change that empties the allowlist",                // (11) withdrawal
    ];
    for (const condition of OD92_CONDITIONS) expect(od92, `OD-92 states: ${condition}`).toContain(condition);

    const notes = read(NOTES);
    const heading = /^## \d+\. Re-read of \d{4}-\d{2}-\d{2} \(B20-A5/m.exec(notes);
    expect(heading, "the dated A5 re-read section").not.toBeNull();
    // [B20 A5 review] bounded at the NEXT numbered heading, not at end of file: the notes grow by one dated section per
    // increment, and an unbounded slice would let a later section satisfy these label counts for A5.
    const rest = notes.slice(heading!.index + heading![0].length);
    const next = /^## \d+\. /m.exec(rest);
    const section = next === null ? rest : rest.slice(0, next.index);
    expect(section).toContain("Anthropic");
    expect(section).toContain("OpenAI");
    for (const label of ["Request fields:", "Credential-bearing fields:", "Approval controls:", "Output items and content blocks:", "Linked protocol revision:", "Account-level configuration:"]) {
      expect(section.split(label).length - 1, label).toBeGreaterThanOrEqual(2);
    }
  });

  it("T6. every file:line citation on the provider-connector page resolves to a range that holds the anchor it names", () => {
    const FILE_CITATION = /^([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.(?:ts|tsx|md|yml|json)):(\d+)(?:-(\d+))?$/;
    const BARE_CITATION = /^:(\d+)(?:-(\d+))?$/;
    const sources = new Map<string, string[] | null>();
    const linesOf = (path: string): string[] | null => {
      if (!sources.has(path)) {
        let lines: string[] | null = null;
        try { lines = read(path).split("\n"); } catch { lines = null; }
        sources.set(path, lines);
      }
      return sources.get(path) ?? null;
    };
    /** a table row's cells, split on `|` outside backticks only */
    const cellsOf = (line: string): string[] => {
      if (!line.startsWith("|")) return [line];
      const cells: string[] = [];
      let current = "";
      let quoted = false;
      for (const char of line) {
        if (char === "`") quoted = !quoted;
        if (char === "|" && !quoted) { cells.push(current); current = ""; } else current += char;
      }
      cells.push(current);
      return cells;
    };
    const problems: string[] = [];
    let citations = 0;
    read(PAGE).split("\n").forEach((line, index) => {
      const at = `page line ${index + 1}`;
      let rowFirst: string | null = null;
      for (const cell of cellsOf(line)) {
        let current: string | null = null;
        for (const match of cell.matchAll(/`([^`]+)`(?:\s*\(`([^`]+)`\))?/g)) {
          const file = FILE_CITATION.exec(match[1]!);
          const bare = BARE_CITATION.exec(match[1]!);
          if (file === null && bare === null) continue;
          let cited: string | null;
          let start: number;
          let end: number;
          if (file !== null) {
            cited = file[1]!;
            start = Number(file[2]);
            end = Number(file[3] ?? file[2]);
            current = cited;
            rowFirst ??= cited;
          } else {
            cited = current ?? rowFirst;
            start = Number(bare![1]);
            end = Number(bare![2] ?? bare![1]);
          }
          if (cited === null) continue; // a bare ":N" with no file before it is prose (a port), never a citation
          citations += 1;
          const lines = linesOf(cited);
          if (lines === null) { problems.push(`${at}: ${cited} is not a file of the tree`); continue; }
          if (!(start >= 1 && end >= start && end <= lines.length)) { problems.push(`${at}: ${cited}:${start}-${end} lies outside its ${lines.length} lines`); continue; }
          const anchor = match[2];
          if (anchor === undefined) { problems.push(`${at}: ${cited}:${start}-${end} names no anchor`); continue; }
          if (!lines.slice(start - 1, end).join("\n").includes(anchor.replace(/\(\)$/, ""))) problems.push(`${at}: ${cited}:${start}-${end} does not hold \`${anchor}\``);
        }
      }
    });
    expect(problems).toEqual([]);
    expect(citations, "the page cites the code it describes").toBeGreaterThanOrEqual(15);
  });

  it("T7. every citation into the two files A5 moved still resolves, on the earlier pages too, and no page carries a pre-A5 spelling of one", () => {
    // [B20 A5 review] A5 inserted sixteen lines above `normalizeOpenAIStep` (a header paragraph and the guard import) and
    // six inside each normalizer, so every line of `app/lib/agent/adapters.ts` from 20 onward moved. Four pages outside
    // B20 cite that file by line and none was re-pinned; the new page asserted the opposite. Nothing gated it: T6 above
    // is scoped to the A5 page, and the A2 resolver's basename map holds neither adapters.ts nor errors.ts.
    const ADAPTERS = "app/lib/agent/adapters.ts";
    const lines = read(ADAPTERS).split("\n");
    const holds = (start: number, end: number, text: string): boolean => lines.slice(start - 1, end).join("\n").includes(text);

    /** page → the citation it now carries → the ranges that citation names and what each must hold */
    const REPINNED: Array<{ page: string; cites: string; ranges: Array<[number, number, string]> }> = [
      { page: "artifacts/ai-control-plane-b18/chat-execution-ux.md", cites: "`adapters.ts:130,182`", ranges: [[130, 130, "stream: false"], [182, 182, 'block.type === "text"']] },
      { page: "artifacts/ai-control-plane-b18/safe-mutation-contract.md", cites: "`adapters.ts:264-269`", ranges: [[264, 269, "agentAdapterFor"]] },
      { page: "artifacts/ai-control-plane-b19/import-security-matrix.md", cites: "`adapters.ts:150-154,248-253`", ranges: [[150, 154, "function_call_output"], [248, 253, "tool_result"]] },
      { page: "artifacts/ai-control-plane-b19/import-security-matrix.md", cites: "`adapters.ts:136,232`", ranges: [[136, 136, "input.history.map"], [232, 232, "input.history.map"]] },
    ];
    for (const { page, cites, ranges } of REPINNED) {
      expect(read(page), `${page} carries ${cites}`).toContain(cites);
      for (const [start, end, text] of ranges) {
        expect(holds(start, end, text), `${cites} → ${ADAPTERS}:${start}-${end} holds ${text}`).toBe(true);
      }
    }

    // the pre-A5 spellings are gone everywhere. `artifacts/ai-control-plane-b20/discovery.md` is the LEAD's file: its
    // own citation (lines 42-43 become 58-59) is handed over in the report, so it is excluded here.
    const LEAD_OWNED = ["artifacts/ai-control-plane-b20/discovery.md"];
    const STALE = ["adapters.ts:108,154", "adapters.ts:128-132,220-225", "adapters.ts:114,204", "adapters.ts:234-235"];
    const pages = [...new Set(REPINNED.map((entry) => entry.page))];
    for (const page of pages) {
      expect(LEAD_OWNED, page).not.toContain(page);
      for (const spelling of STALE) expect(read(page), `${page} still carries ${spelling}`).not.toContain(spelling);
    }
  });
});
