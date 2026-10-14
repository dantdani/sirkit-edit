/**
 * [B24-C3] D24-24 as recorded (OD-210) and the rest of D24-26: every limit observability-and-replay.md part 3 states is a pin that
 * reads the code at the cited line, never prose - the page goes red when the fact changes. Each code-fact check runs over the production
 * file map (`collectProductionFiles`) and then over an INJECTED in-memory variant of the file it pins (the B21-A case-3 pattern), which
 * must turn it red; a check over a call's result (`policyFor`) runs again over a stubbed result. No file on disk is edited.
 *
 *  1. Tier 2 approvals are browser-only: the two approved-mutation IndexedDB journals (and the Tier 1 grant journal) are in no
 *     app/api/**\/route.ts runtime closure, pinned by exact path - the three `-journal-idb.ts` files on disk are exactly those;
 *  2. `policyFor` for POST /api/pcb/apply-authorization and POST /api/replacement-authority: authenticated-read, authoritativeWrite
 *     false (route-policy.ts:107, :111, :313);
 *  3. the apply-authorization route's one runtime import is the canonical wrapper, and both routes say they write nothing;
 *  4. Tier 1, structural (AST): under app/lib/execution-grant/ the only string literal ever assigned to an `attestation` property - as an
 *     object-literal member (a plain, quoted or computed key) or by an assignment statement to `.attestation` / `["attestation"]`, with no
 *     call naming the property (`defineProperty`, `Reflect.set`) - is "browser-attested" (settle.ts:58), the only other `attestation:`
 *     copies an existing settlement's field (store.ts:175), and SettleRequest.settlement omits `attestation` (settle.ts:13-19);
 *  5. the grant is server-held and bound to the run: session.runId (execution-grant.ts:114) is set from the run context at mint
 *     (mint.ts:175, the idempotency key :186) and required by the browser-side parser (:367, :379);
 *  6. the grant's browser journal (agent-execution-journal-idb.ts; importer PcbEditor.tsx:63) is in no route closure; the behavioural
 *     pins exist (b18-b-execution-grant-route 206, b18-b-mint-consume-decisions 268);
 *  7. Tier 3: the exchange ledger names committedBy (exchange-ledger.ts:62) and its closed key list carries no run id (:179);
 *  8. replay covers authored capsules only: replay-capsule.ts is in no route closure, its runtime importers are the evaluation modules
 *     and the B11 generator, trace.ts:11-13's sentence stands verbatim;
 *  9. the MCP request and read traces and B05's read traces die with their process or instance: the ring constants (1,000; 1,000; 500),
 *     no production caller of either sink setter, tool-invocation.ts imports nothing under durable-workflow, one instance per gateway
 *     and per MCP read path;
 * 10. no access audit: the read mode states `accessAudit: "not_recorded"`, reaches no retention module and no access-audit store exists
 *     (the three filters shown over an injected retention import in the core and an injected access-audit store);
 * 11. the page: part 3 names each limit with its citations and its pinning case, and every citation resolves on its line.
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { collectProductionFiles, moduleReferences, resolveSpecifier, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { fileOf, importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { listRouteFiles } from "@/app/lib/auth/route-tree";
import { policyFor, type RoutePolicy } from "@/app/lib/auth/route-policy";
import { MCP_SERVER_TRACE_RING_MAX } from "@/app/lib/mcp/server/request-trace";
import { MCP_READ_TRACE_RING_MAX } from "@/app/lib/mcp/server/read-trace";
import { TRACE_READ_ACCESS_AUDIT } from "@/app/lib/observability/trace-read";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const lineOf = (map: FileMap, path: string, line: number): string => (map.get(path) ?? read(path)).split(NEWLINE)[line - 1] ?? "";
const production = collectProductionFiles(ROOT);
const routeFiles = (): string[] => listRouteFiles(ROOT).map((file) => relative(ROOT, file).split(sep).join("/"));
let routeClosureMemo: Map<string, readonly string[]> | null = null;
/** The runtime closure of every route file (one walk, memoized). */
const routeClosure = (): Map<string, readonly string[]> => (routeClosureMemo ??= importClosure(production, routeFiles()));
/** The production map with `path` rewritten (an injected variant; nothing on disk changes). */
const variant = (path: string, source: string): FileMap => new Map(production).set(path, source);
const appended = (path: string, extra: string): FileMap => variant(path, `${production.get(path)!}${NEWLINE}${extra}${NEWLINE}`);
const withLine = (path: string, line: number, text: string): FileMap => { const lines = production.get(path)!.split(NEWLINE); lines[line - 1] = text; return variant(path, lines.join(NEWLINE)); };
const yieldNow = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const PAGE = "artifacts/ai-control-plane-b24/observability-and-replay.md";
const TIER2_JOURNALS = ["app/lib/engineering/approved-mutation-journal-idb.ts", "app/lib/engineering/approved-pcb-mutation-journal-idb.ts"] as const;
const GRANT_JOURNAL = "app/lib/engineering/agent-execution-journal-idb.ts";
const APPLY_ROUTE = "app/api/pcb/apply-authorization/route.ts";
const REPLACEMENT_ROUTE = "app/api/replacement-authority/route.ts";
const GRANT_DIR = "app/lib/execution-grant/";
const SETTLE = "app/lib/execution-grant/settle.ts";
const GRANT_STORE = "app/lib/execution-grant/store.ts";
const MINT = "app/lib/execution-grant/mint.ts";
const GRANT_TYPES = "app/lib/engineering/execution-grant.ts";
const LEDGER = "app/lib/manufacturing-providers/exchange-ledger.ts";
const CAPSULE = "app/lib/agent/replay-capsule.ts";
const TRACE = "app/lib/agent/trace.ts";
const REQUEST_TRACE = "app/lib/mcp/server/request-trace.ts";
const READ_TRACE = "app/lib/mcp/server/read-trace.ts";
const TOOL_INVOCATION = "app/lib/engineering/tool-invocation.ts";
const TRACE_READ_CORE = "app/lib/observability/trace-read.ts";

// ── the checks, each a function over a file map (or a lookup) that answers its problems ──────────────────────────────────────────
/** The journals (or any file) a closure reaches, as `file <- chain`. */
const reachedBy = (closure: ReadonlyMap<string, readonly string[]>, files: readonly string[]): string[] => files.filter((file) => closure.has(file)).map((file) => `${file} <- ${closure.get(file)!.join(" -> ")}`);
/** The two read-only server checks: authenticated-read rows that hold no write authority. */
function readOnlyPolicyProblems(lookup: (pathname: string, method: string) => RoutePolicy | null): string[] {
  const problems: string[] = [];
  for (const pathname of ["/api/pcb/apply-authorization", "/api/replacement-authority"]) {
    const policy = lookup(pathname, "POST");
    if (policy === null) { problems.push(`${pathname}: no POST policy`); continue; }
    if (policy.authClass !== "authenticated-read") problems.push(`${pathname}: authClass ${policy.authClass}`);
    if (policy.authoritativeWrite !== false) problems.push(`${pathname}: authoritativeWrite ${String(policy.authoritativeWrite)}`);
    if (policy.releaseOrQualification !== false || policy.externalTransfer !== false || policy.spend !== false) problems.push(`${pathname}: a release, transfer or spend flag is set`);
    if (policy.requiresAuth !== true) problems.push(`${pathname}: requiresAuth ${String(policy.requiresAuth)}`);
  }
  return problems;
}
type AttestationAssignment = { file: string; kind: "literal" | "copy" | "other"; text: string };
/** Does this property name spell `attestation` - a plain identifier, a quoted key or a computed string key? ([B24-C3 review fix, 2026-10-09]: was the plain identifier's text alone) */
const namesAttestation = (name: ts.PropertyName): boolean => (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) ? name.text === "attestation" : ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression) && name.expression.text === "attestation";
/** The value assigned: a string literal, a copy of a stored settlement's field, or anything else (reported with the whole node's text). */
const classifyAssigned = (file: string, tree: ts.SourceFile, value: ts.Expression | null, node: ts.Node): AttestationAssignment => {
  if (value !== null && ts.isStringLiteralLike(value)) return { file, kind: "literal", text: value.text };
  if (value !== null && ts.isPropertyAccessExpression(value) && value.getText(tree).endsWith(".settlement.attestation")) return { file, kind: "copy", text: value.getText(tree) };
  return { file, kind: "other", text: node.getText(tree) };
};
/**
 * Every assignment of an `attestation` property under app/lib/execution-grant/, by file, kind and text (AST): an object-literal member (a
 * plain, quoted or computed key), an assignment statement to `.attestation` or `["attestation"]`, and any call that names the property by
 * string (`Object.defineProperty`, `Reflect.set`, ...), which is `other` whatever its value. [B24-C3 review fix, 2026-10-09] the last two
 * forms and the quoted and computed keys were invisible to the object-literal-only visitor.
 */
function attestationAssignments(map: FileMap): AttestationAssignment[] {
  const found: AttestationAssignment[] = [];
  for (const [file, source] of [...map].filter(([path]) => path.startsWith(GRANT_DIR)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && namesAttestation(node.name)) found.push(classifyAssigned(file, tree, ts.isPropertyAssignment(node) ? node.initializer : null, node));
      else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ((ts.isPropertyAccessExpression(node.left) && node.left.name.text === "attestation") || (ts.isElementAccessExpression(node.left) && ts.isStringLiteralLike(node.left.argumentExpression) && node.left.argumentExpression.text === "attestation"))) found.push(classifyAssigned(file, tree, node.right, node));
      else if (ts.isCallExpression(node) && node.arguments.some((argument) => ts.isStringLiteralLike(argument) && argument.text === "attestation")) found.push({ file, kind: "other", text: node.getText(tree) });
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return found;
}
/** The structural Tier 1 pin: one literal, one copy, the settle request without the field, the type's literal. */
function attestationProblems(map: FileMap): string[] {
  const problems: string[] = [];
  const assignments = attestationAssignments(map);
  const literals = assignments.filter((entry) => entry.kind === "literal");
  if (literals.length !== 1 || literals[0]!.file !== SETTLE || literals[0]!.text !== "browser-attested") problems.push(`literals: ${JSON.stringify(literals)}`);
  const copies = assignments.filter((entry) => entry.kind !== "literal");
  if (copies.length !== 1 || copies[0]!.file !== GRANT_STORE || copies[0]!.kind !== "copy" || copies[0]!.text !== "transition.settlement.attestation") problems.push(`copies: ${JSON.stringify(copies)}`);
  if (!lineOf(map, SETTLE, 58).includes('attestation: "browser-attested"')) problems.push("settle.ts:58 is not the attestation");
  if (!lineOf(map, SETTLE, 13).startsWith("export interface SettleRequest {") || !lineOf(map, SETTLE, 18).includes('settlement: Omit<ExecutionGrantSettlement, "attestation" | "late" | "at">;') || !lineOf(map, SETTLE, 19).startsWith("}")) problems.push("settle.ts:13-19 is not SettleRequest omitting attestation");
  if (!lineOf(map, GRANT_STORE, 175).includes("attestation: transition.settlement.attestation")) problems.push("store.ts:175 is not the copy");
  if (lineOf(map, GRANT_TYPES, 192).trim() !== 'attestation: "browser-attested";') problems.push("execution-grant.ts:192 is not the settlement type's literal");
  return problems;
}
/** The grant's run binding: the session's runId, set from the run context at mint, required by the browser-side parser. */
function runBindingProblems(map: FileMap): string[] {
  const pins: Array<[path: string, line: number, anchor: string]> = [
    [GRANT_TYPES, 114, "export interface ExecutionGrantSession { editor: \"pcb\" | \"schematic\"; lineageId: string; runId: string; viewSessionId: string | null }"],
    [MINT, 175, "session: { ...request.session, runId: ctx.runId },"],
    [MINT, 186, "idempotencyKey: `grant-mint:${ctx.runId}:${request.origin.callId}`"],
    [GRANT_TYPES, 367, "export function parsePublicExecutionGrant(raw: unknown): PublicExecutionGrant | null {"],
    [GRANT_TYPES, 379, "!str(session.runId)) return null;"],
  ];
  return pins.filter(([path, line, anchor]) => !lineOf(map, path, line).includes(anchor)).map(([path, line]) => `${path}:${line}`);
}
/** The closed attempt key list of the exchange ledger (its line 179), parsed. */
function attemptKeys(map: FileMap): string[] | null {
  const line = lineOf(map, LEDGER, 179);
  const match = /^const ATTEMPT_KEYS = \[([^\]]*)\] as const;$/.exec(line);
  return match ? [...match[1]!.matchAll(/"([^"]+)"/g)].map((key) => key[1]!) : null;
}
function ledgerProblems(map: FileMap): string[] {
  const problems: string[] = [];
  if (lineOf(map, LEDGER, 62).trim() !== "readonly committedBy: string;") problems.push("exchange-ledger.ts:62 is not committedBy");
  const keys = attemptKeys(map);
  if (keys === null) problems.push("exchange-ledger.ts:179 is not the closed key list");
  else { if (!keys.includes("committedBy")) problems.push("the key list lacks committedBy"); if (keys.some((key) => /run/i.test(key))) problems.push(`the key list names a run: ${keys.filter((key) => /run/i.test(key)).join(", ")}`); }
  return problems;
}
/** The rings and their lifetimes. */
function ringProblems(map: FileMap): string[] {
  const pins: Array<[path: string, line: number, anchor: string]> = [
    [REQUEST_TRACE, 15, "export const MCP_SERVER_TRACE_RING_MAX = 1000;"], [REQUEST_TRACE, 116, "ring.push(trace);"], [REQUEST_TRACE, 117, "while (ring.length > MCP_SERVER_TRACE_RING_MAX) ring.shift();"], [REQUEST_TRACE, 124, "export function setMcpServerTraceSinkFactory("],
    [READ_TRACE, 15, "export const MCP_READ_TRACE_RING_MAX = 1_000;"], [READ_TRACE, 211, "ring.push(trace);"], [READ_TRACE, 212, "while (ring.length > MCP_READ_TRACE_RING_MAX) ring.shift();"], [READ_TRACE, 219, "export function setMcpReadTraceSinkFactory("],
    [TOOL_INVOCATION, 204, "this.maxTraces = options?.maxTraces ?? 500;"], [TOOL_INVOCATION, 440, "private record(trace: ReadInvocationTrace): void {"], [TOOL_INVOCATION, 441, "this.traceLog.push(trace);"], [TOOL_INVOCATION, 442, "if (this.traceLog.length > this.maxTraces) this.traceLog.shift();"],
    ["app/lib/agent/gateway.ts", 494, "new ReadToolInvocationService(registry)"], ["app/lib/mcp/server/read-call.ts", 235, "service = new ReadToolInvocationService(registry, { now: () => Date.now() });"],
  ];
  const problems = pins.filter(([path, line, anchor]) => !lineOf(map, path, line).includes(anchor)).map(([path, line]) => `${path}:${line}`);
  const setterCallers = [...map].filter(([path, source]) => path !== REQUEST_TRACE && path !== READ_TRACE && /\bsetMcp(?:Server|Read)TraceSinkFactory\s*\(/.test(source)).map(([path]) => path);
  if (setterCallers.length > 0) problems.push(`a production caller of a sink setter: ${setterCallers.join(", ")}`);
  const durable = [...runtimeDeclarationSpecifiers(TOOL_INVOCATION, map.get(TOOL_INVOCATION)!)].filter((specifier) => specifier.includes("durable-workflow"));
  if (durable.length > 0) problems.push(`tool-invocation.ts imports ${durable.join(", ")}`);
  return problems;
}
/** [B24-C3 review fix, 2026-10-09] No access audit: the read core reaches no retention module, and no production path or aggregate type names an access audit. */
function accessAuditProblems(map: FileMap): string[] {
  const problems: string[] = [];
  for (const file of [...importClosure(map, [TRACE_READ_CORE]).keys()].filter((file) => /retention|access-audit|trace-access/.test(file))) problems.push(`the core's closure reaches ${file}`);
  for (const path of [...map.keys()].filter((path) => /access-audit|trace-access|read-audit/.test(path))) problems.push(`a production path names an access audit: ${path}`);
  for (const [path] of [...map].filter(([, source]) => /aggregateType:\s*"[a-z.-]*access-audit/.test(source))) problems.push(`an aggregate type names an access audit: ${path}`);
  return problems;
}
/** The direct runtime importers of `target` (a type-only import does not count); only a file naming the target's basename can. */
function importersOf(map: FileMap, target: string): string[] {
  const name = target.split("/").at(-1)!.replace(/\.ts$/, "");
  return [...map.keys()].filter((file) => file !== target && map.get(file)!.includes(name) && runtimeEdges(map, file).includes(target)).sort();
}
function runtimeEdges(map: FileMap, file: string): string[] {
  const source = map.get(file)!;
  const runtime = runtimeDeclarationSpecifiers(file, source);
  const edges: string[] = [];
  for (const reference of moduleReferences(file, source)) {
    if (reference.kind === "import-type") continue;
    if ((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)) continue;
    const resolution = resolveSpecifier(file, reference.specifier);
    if (resolution.kind !== "module") continue;
    const target = fileOf(map, resolution.module);
    if (target !== null && !edges.includes(target)) edges.push(target);
  }
  return edges;
}

describe("[B24-C3] the recorded limits (D24-24 as recorded, OD-210; D24-26), each a pin on the code", () => {
  it("1. Tier 2 approvals are browser-only: the approved-mutation and approved-PCB-mutation IndexedDB journals (and the Tier 1 grant journal) are in no app/api/**/route.ts runtime closure, each pinned by exact path; the `-journal-idb.ts` files on disk are exactly those three, imported by the PCB editor component; an injected route import of a journal is caught with its chain", { timeout: 180_000 }, async () => {
    const onDisk = [...production.keys()].filter((path) => path.endsWith("-journal-idb.ts")).sort();
    expect(onDisk).toEqual([GRANT_JOURNAL, ...TIER2_JOURNALS].sort());
    expect(routeFiles().length).toBeGreaterThan(100);
    await yieldNow();
    const closure = routeClosure();
    expect(closure.size).toBeGreaterThan(300);
    expect(reachedBy(closure, [...TIER2_JOURNALS, GRANT_JOURNAL])).toEqual([]);
    expect(closure.has("app/lib/auth/route-handlers.ts")).toBe(true); // not vacuous: the routes' closure holds the canonical wrappers
    expect(lineOf(production, "app/components/pcb/PcbEditor.tsx", 60)).toContain('from "@/app/lib/engineering/approved-pcb-mutation-journal-idb"');
    expect(lineOf(production, "app/components/pcb/PcbEditor.tsx", 63)).toContain('from "@/app/lib/engineering/agent-execution-journal-idb"');
    expect(lineOf(production, "app/lib/engineering/approved-mutation-journal.ts", 49)).toContain("`IndexedDbApprovedMutationJournalStore` (approved-mutation-journal-idb.ts),");
    // the variant: a route that imports a Tier 2 journal is reached, with its chain
    const probed = appended(APPLY_ROUTE, 'import { IndexedDbApprovedMutationJournalStore as b24c3Probe } from "@/app/lib/engineering/approved-mutation-journal-idb";' + NEWLINE + "export const b24c3 = b24c3Probe;");
    expect(reachedBy(importClosure(probed, [APPLY_ROUTE]), [...TIER2_JOURNALS])).toEqual([`${TIER2_JOURNALS[0]} <- ${APPLY_ROUTE} -> ${TIER2_JOURNALS[0]}`]);
    expect(reachedBy(importClosure(production, [APPLY_ROUTE]), [...TIER2_JOURNALS])).toEqual([]);
  });

  it("2. policyFor(\"/api/pcb/apply-authorization\", \"POST\") and policyFor(\"/api/replacement-authority\", \"POST\") are both authenticated-read rows with authoritativeWrite false (route-policy.ts:107, :111; the lookup :313); the same assertion over a stubbed write row goes red", () => {
    expect(readOnlyPolicyProblems(policyFor)).toEqual([]);
    expect(policyFor("/api/pcb/apply-authorization", "POST")).toMatchObject({ authClass: "authenticated-read", authoritativeWrite: false, requiresCsrf: true, identitySource: "trusted-context" });
    expect(policyFor("/api/replacement-authority", "POST")).toMatchObject({ authClass: "authenticated-read", authoritativeWrite: false, requiresCsrf: true, identitySource: "trusted-context" });
    expect(lineOf(production, "app/lib/auth/route-policy.ts", 107)).toContain('...read("/api/replacement-authority", ["POST"], "app/api/replacement-authority", EDITORS),');
    expect(lineOf(production, "app/lib/auth/route-policy.ts", 111)).toContain('...read("/api/pcb/apply-authorization", ["POST"], "app/api/pcb/apply-authorization"),');
    expect(lineOf(production, "app/lib/auth/route-policy.ts", 313)).toBe("export function policyFor(pathname: string, method: string): RoutePolicy | null {");
    // the strength of the assertion: a stubbed write row, a stubbed mutation class, a missing row
    expect(readOnlyPolicyProblems((pathname, method) => ({ ...policyFor(pathname, method)!, authoritativeWrite: true }))).toHaveLength(2);
    expect(readOnlyPolicyProblems((pathname, method) => (pathname === "/api/replacement-authority" ? { ...policyFor(pathname, method)!, authClass: "authenticated-mutation" } : policyFor(pathname, method)))).toEqual(["/api/replacement-authority: authClass authenticated-mutation"]);
    expect(readOnlyPolicyProblems(() => null)).toHaveLength(2);
  });

  it("3. the apply-authorization route's only runtime import is the canonical wrapper `@/app/lib/auth/route-handlers`, and both read-only routes state that they write nothing (apply-authorization route.ts:10, replacement-authority route.ts:5); an injected second import goes red", () => {
    const imports = (map: FileMap): string[] => [...runtimeDeclarationSpecifiers(APPLY_ROUTE, map.get(APPLY_ROUTE)!)].sort();
    expect(imports(production)).toEqual(["@/app/lib/auth/route-handlers"]);
    expect(lineOf(production, APPLY_ROUTE, 10)).toBe(" * It performs NO mutation, holds NO apply/commit authority, and is never");
    expect(lineOf(production, REPLACEMENT_ROUTE, 5)).toBe(" * READ/PROVE ONLY. It derives fresh server-owned component authority and");
    expect(lineOf(production, REPLACEMENT_ROUTE, 8)).toBe(" * session, writes nothing).");
    expect(imports(appended(APPLY_ROUTE, 'import { getDurableWorkflowRepository } from "@/app/lib/durable-workflow/runtime";' + NEWLINE + "export const b24c3 = getDurableWorkflowRepository;"))).toEqual(["@/app/lib/auth/route-handlers", "@/app/lib/durable-workflow/runtime"]);
    expect(imports(appended(APPLY_ROUTE, 'import type { DurableWorkflowRepository } from "@/app/lib/durable-workflow/types";' + NEWLINE + "export type B24c3 = DurableWorkflowRepository;"))).toEqual(["@/app/lib/auth/route-handlers"]); // a type-only import is erased
  });

  it("4. Tier 1 settlement is browser-attested, structurally (AST): under app/lib/execution-grant/ the only string literal assigned to an `attestation` property - as an object-literal member (plain, quoted or computed key) or by an assignment statement to `.attestation` / `[\"attestation\"]`, with no call naming the property - is \"browser-attested\" (settle.ts:58), the only other `attestation:` copies an existing settlement's field (store.ts:175), SettleRequest.settlement omits `attestation` (settle.ts:13-19) and the type's literal is :192; an injected second literal (plain, quoted, computed, by assignment, by element access, by defineProperty), a server literal and a request carrying the field each go red", () => {
    expect(attestationProblems(production)).toEqual([]);
    expect(attestationAssignments(production)).toEqual([{ file: SETTLE, kind: "literal", text: "browser-attested" }, { file: GRANT_STORE, kind: "copy", text: "transition.settlement.attestation" }]);
    expect([...production.keys()].filter((path) => path.startsWith(GRANT_DIR)).sort()).toEqual(["app/lib/execution-grant/consume.ts", MINT, "app/lib/execution-grant/route-contract.ts", SETTLE, GRANT_STORE]);
    expect(attestationProblems(appended(SETTLE, 'export const b24c3Probe = { attestation: "server-attested" };'))).toContain('literals: [{"file":"app/lib/execution-grant/settle.ts","kind":"literal","text":"browser-attested"},{"file":"app/lib/execution-grant/settle.ts","kind":"literal","text":"server-attested"}]');
    expect(attestationProblems(withLine(SETTLE, 58, lineOf(production, SETTLE, 58).replace('attestation: "browser-attested"', 'attestation: "server-attested"')))).not.toEqual([]);
    expect(attestationProblems(appended(MINT, "export const b24c3Probe = (settlement: { attestation: string }) => ({ attestation: settlement.attestation });"))).not.toEqual([]); // a copy outside the store's transition
    expect(attestationProblems(withLine(SETTLE, 18, '  settlement: Omit<ExecutionGrantSettlement, "late" | "at">;'))).toContain("settle.ts:13-19 is not SettleRequest omitting attestation");
    // [B24-C3 review fix, 2026-10-09] the forms an object-literal-only visitor misses, each a second literal (or an unclassified assignment) under the grant root: a computed key, a quoted key, an assignment statement, an element-access assignment, a defineProperty call
    const evasions: Array<[path: string, probe: string, expected: AttestationAssignment]> = [
      [SETTLE, 'export const b24c3Probe = { ["attestation"]: "server-attested" } as unknown as ExecutionGrantSettlement;', { file: SETTLE, kind: "literal", text: "server-attested" }],
      [SETTLE, 'export const b24c3Probe = { "attestation": "server-attested" };', { file: SETTLE, kind: "literal", text: "server-attested" }],
      [GRANT_STORE, 'export const b24c3Probe = (settlement: { attestation: string }): void => { settlement.attestation = "server-attested"; };', { file: GRANT_STORE, kind: "literal", text: "server-attested" }],
      [MINT, 'export const b24c3Probe = (target: Record<string, string>): void => { target["attestation"] = "server-attested"; };', { file: MINT, kind: "literal", text: "server-attested" }],
      [MINT, 'export const b24c3Probe = (target: object): object => Object.defineProperty(target, "attestation", { value: "server-attested" });', { file: MINT, kind: "other", text: 'Object.defineProperty(target, "attestation", { value: "server-attested" })' }],
      [GRANT_STORE, 'export const b24c3Probe = (target: object): boolean => Reflect.set(target, "attestation", "server-attested");', { file: GRANT_STORE, kind: "other", text: 'Reflect.set(target, "attestation", "server-attested")' }],
    ];
    for (const [path, probe, expected] of evasions) {
      const probed = appended(path, probe);
      expect(attestationAssignments(probed), probe).toContainEqual(expected);
      expect(attestationProblems(probed), probe).not.toEqual([]);
    }
    expect(attestationAssignments(appended(SETTLE, 'export const b24c3Probe = (settlement: { attestation: string }): string => settlement.attestation;'))).toEqual(attestationAssignments(production)); // a read of the property is no assignment
  });

  it("5. the grant is a server record bound to the run: ExecutionGrantSession.runId (execution-grant.ts:114) is set from the run context at mint (mint.ts:175) with the mint's idempotency key on the run and call (:186), and the browser-side parser requires it (:367, :379) - the limit is the OUTCOME's attestation, not a missing run-bound record; a moved line goes red", () => {
    expect(runBindingProblems(production)).toEqual([]);
    expect(runBindingProblems(withLine(MINT, 175, "          session: { ...request.session },"))).toEqual([`${MINT}:175`]);
    expect(runBindingProblems(withLine(GRANT_TYPES, 379, lineOf(production, GRANT_TYPES, 379).replace(" || !str(session.runId)", "")))).toEqual([`${GRANT_TYPES}:379`]);
  });

  it("6. the grant's browser journal (agent-execution-journal-idb.ts, B18-B; importer PcbEditor.tsx:63) is in no route closure - the server holds the grant record and its browser-attested settlement only; the behavioural pins the page cites exist: b18-b-execution-grant-route.test.ts:206 and b18-b-mint-consume-decisions.test.ts:268 each assert the settlement's attestation", { timeout: 180_000 }, async () => {
    await yieldNow();
    expect(reachedBy(routeClosure(), [GRANT_JOURNAL])).toEqual([]);
    expect(production.has(GRANT_JOURNAL)).toBe(true);
    expect(lineOf(production, "app/lib/engineering/agent-execution-journal.ts", 2)).toContain("[B18-B] The DURABLE agent-execution journal");
    expect(read("app/api/agent/__tests__/b18-b-execution-grant-route.test.ts").split(NEWLINE)[205]).toContain('attestation: "browser-attested"');
    expect(read("app/lib/execution-grant/__tests__/b18-b-mint-consume-decisions.test.ts").split(NEWLINE)[267]).toContain('attestation: "browser-attested"');
    const probed = appended("app/api/agent/execution-grant/settle/route.ts", 'import * as b24c3Probe from "@/app/lib/engineering/agent-execution-journal-idb";' + NEWLINE + "export const b24c3 = b24c3Probe;");
    expect(production.has("app/api/agent/execution-grant/settle/route.ts")).toBe(true);
    expect(reachedBy(importClosure(probed, ["app/api/agent/execution-grant/settle/route.ts"]), [GRANT_JOURNAL])).toHaveLength(1);
  });

  it("7. Tier 3: the exchange ledger names the committer (committedBy, exchange-ledger.ts:62) and its closed attempt key list (:179) carries no run id; a key list naming a run goes red", () => {
    expect(ledgerProblems(production)).toEqual([]);
    const keys = attemptKeys(production)!;
    expect(keys).toContain("committedBy");
    expect(keys.length).toBeGreaterThan(20);
    expect(keys.filter((key) => /run/i.test(key))).toEqual([]);
    expect(ledgerProblems(withLine(LEDGER, 179, lineOf(production, LEDGER, 179).replace('"committedBy",', '"committedBy", "runId",')))).toEqual(["the key list names a run: runId"]);
    expect(ledgerProblems(withLine(LEDGER, 62, "  readonly committedBy: string | null;"))).toEqual(["exchange-ledger.ts:62 is not committedBy"]);
  });

  it("8. replay covers authored capsules only: replay-capsule.ts is in no route closure; its runtime importers are the two evaluation modules and the B11 generator; trace.ts:11-13 stands verbatim (digest-only traces cannot reconstruct model output; the capsule is never persisted from live runs); an injected route import goes red", { timeout: 180_000 }, async () => {
    await yieldNow();
    expect(reachedBy(routeClosure(), [CAPSULE])).toEqual([]);
    expect(importersOf(production, CAPSULE)).toEqual(["app/lib/agent/evaluation-cases.ts", "app/lib/agent/evaluation.ts", "scripts/generate-b11-artifacts.ts"]);
    expect([lineOf(production, TRACE, 11), lineOf(production, TRACE, 12), lineOf(production, TRACE, 13)].map((line) => line.replace(/^ \* /, "")).join(" ")).toBe("claims. Digest-only traces deliberately CANNOT reconstruct model output — reconstruction lives only in the explicit sanitized replay capsule (`replay-capsule.ts`), which is never persisted from live runs.");
    const probed = appended("app/api/chat/route.ts", 'import { replayCapsule as b24c3Probe } from "@/app/lib/agent/replay-capsule";' + NEWLINE + "export const b24c3 = b24c3Probe;");
    expect(reachedBy(importClosure(probed, ["app/api/chat/route.ts"]), [CAPSULE])).toEqual([`${CAPSULE} <- app/api/chat/route.ts -> ${CAPSULE}`]);
    expect(importersOf(probed, CAPSULE)).toContain("app/api/chat/route.ts");
  });

  it("9. the MCP request and read traces and B05's read traces die with their process or instance: the ring constants are 1,000 (request-trace.ts:15, :116-117), 1,000 (read-trace.ts:15, :211-212) and 500 per ReadToolInvocationService (tool-invocation.ts:204, :440-442, one instance per gateway :494 and per MCP read path read-call.ts:235); no production caller of either sink setter (:124, :219); tool-invocation.ts imports nothing under durable-workflow; an injected caller, an injected durable import and a moved constant each go red", () => {
    expect(ringProblems(production)).toEqual([]);
    expect([MCP_SERVER_TRACE_RING_MAX, MCP_READ_TRACE_RING_MAX]).toEqual([1000, 1000]);
    expect(ringProblems(appended("app/lib/mcp/server/dispatch.ts", "setMcpServerTraceSinkFactory(() => null);"))).toEqual(["a production caller of a sink setter: app/lib/mcp/server/dispatch.ts"]);
    expect(ringProblems(appended(TOOL_INVOCATION, 'import { getDurableWorkflowRepository } from "../durable-workflow/runtime";' + NEWLINE + "export const b24c3 = getDurableWorkflowRepository;"))).toEqual(["tool-invocation.ts imports ../durable-workflow/runtime"]);
    expect(ringProblems(withLine(REQUEST_TRACE, 15, "export const MCP_SERVER_TRACE_RING_MAX = 100000;"))).toEqual([`${REQUEST_TRACE}:15`]);
    expect(ringProblems(withLine(TOOL_INVOCATION, 204, "    this.maxTraces = options?.maxTraces ?? 500000;"))).toEqual([`${TOOL_INVOCATION}:204`]);
  });

  it("10. no access audit: the read mode states accessAudit \"not_recorded\" (OD-211; OD-111 stands), its core reaches no retention module and no access-audit store exists in the tree; an injected retention import in the core and an injected access-audit store each go red", { timeout: 60_000 }, () => {
    expect(TRACE_READ_ACCESS_AUDIT).toBe("not_recorded");
    expect(accessAuditProblems(production)).toEqual([]);
    // [B24-C3 review fix, 2026-10-09] the three filters bite: the core importing the retention port, and a store whose path and aggregate type name an access audit
    expect(accessAuditProblems(appended(TRACE_READ_CORE, 'import { PostgresRetentionPort as b24c3Probe } from "../durable-workflow/retention";' + NEWLINE + "export const b24c3 = b24c3Probe;"))).toContain("the core's closure reaches app/lib/durable-workflow/retention.ts");
    expect(accessAuditProblems(variant("app/lib/observability/access-audit-store.ts", 'export const ACCESS_AUDIT_AGGREGATE_TYPE = "agent.access-audit.v1" as const;' + NEWLINE + "export const ACCESS_AUDIT = { aggregateType: ACCESS_AUDIT_AGGREGATE_TYPE };" + NEWLINE + 'export const ACCESS_AUDIT_INLINE = { aggregateType: "agent.access-audit.v1" };'))).toEqual(["a production path names an access audit: app/lib/observability/access-audit-store.ts", "an aggregate type names an access audit: app/lib/observability/access-audit-store.ts"]);
    expect(accessAuditProblems(variant("app/lib/observability/read-ledger.ts", 'export const READ_LEDGER = { aggregateType: "agent.trace-read-audit.v1" };'))).toEqual([]); // a name neither filter knows is not caught: the filters are the three stated ones (section 36)
  });

  it("11. the page: part 3 of observability-and-replay.md names every limit with its citations and its pinning case here, each citation of its table resolves on the line it names, and the pinning cases named are exactly 1 to 10", () => {
    const page = read(PAGE);
    const start = page.indexOf(`${NEWLINE}# B24-C3 - Observability and replay, part 3:`);
    expect(start, "part 3").toBeGreaterThan(0);
    const part = page.slice(start);
    const limits = [...part.matchAll(/^\| ([^|]+) \| ([^|]+) \| `b24-c3-recorded-limits` ([\d, ]+) \|$/gm)].map((row) => ({ limit: row[1]!.trim(), facts: row[2]!, cases: row[3]!.split(/,\s*/).map(Number) }));
    expect(limits.length).toBeGreaterThanOrEqual(8);
    expect([...new Set(limits.flatMap((row) => row.cases))].sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, index) => index + 1));
    const citations = [...part.matchAll(/^\| (C\d+) \| `([^`]+)` \| (\d+) \| `([^`]+)` \|$/gm)].map((row) => ({ id: row[1]!, path: row[2]!, line: Number(row[3]), anchor: row[4]! }));
    expect(citations.length).toBeGreaterThanOrEqual(30);
    expect(citations.map((citation) => citation.id)).toEqual(citations.map((_, index) => `C${index + 1}`));
    const stale = citations.filter((citation) => !lineOf(production, citation.path, citation.line).includes(citation.anchor)).map((citation) => `${citation.id} ${citation.path}:${citation.line}`);
    expect(stale).toEqual([]);
    const ids = new Set(citations.map((citation) => citation.id));
    for (const row of limits) {
      const named = [...row.facts.matchAll(/\bC\d+\b/g)].map((match) => match[0]);
      expect(named.length, row.limit).toBeGreaterThan(0);
      for (const id of named) expect(ids.has(id), `${row.limit}: ${id}`).toBe(true);
    }
    for (const cited of [SETTLE, GRANT_STORE, MINT, GRANT_TYPES, LEDGER, TRACE, REQUEST_TRACE, READ_TRACE, TOOL_INVOCATION, "app/lib/auth/route-policy.ts", APPLY_ROUTE, "app/components/pcb/PcbEditor.tsx"]) expect(citations.some((citation) => citation.path === cited), cited).toBe(true);
  });
});
