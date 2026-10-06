/**
 * [B23-C] The purchase-authorization contract, offline only (runbook B23-C :996 "require a second explicit confirmation bound to exact
 * provider, cart/order lines, quantities, currency, total price ceiling, shipping destination reference, release/BOM digest and expiry
 * ... The AI cannot mint or consume the final purchase authorization."; D23-11; OD-172). A human project administrator requests; a
 * DIFFERENT human project administrator confirms the exact request (proposerCannotApprove), which mints a single-use, server-held
 * authorization; a single compare-and-set burns it, and any changed field refuses. Ordering is turned off in B23 (OD-171), so every
 * case that mints holds the fixture's fake owner record and a wired test port; the store's own default enablement refuses.
 *
 * The approved-importer gate (cases 7 and 8) closes D21-33's gap for this module: the agent loop, the gateway, the chat route, MCP and
 * orchestration are walked, not only the closures B21's gates covered. Files are read as text; nothing is written to disk and nothing
 * leaves the process.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { addDecimal, compareDecimal, multiplyDecimalByInteger } from "@/app/lib/release-engineering/procurement";
import { collectProductionFiles, identifierReferences, moduleImportOffenders, moduleReferences, resolveSpecifier, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { fileOf, importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { orderingEnablement, type OrderingEnablement } from "../ordering-enablement";
import { addMoney, canonicalMoney, compareMoney, linesTotal, multiplyMoney, PURCHASE_AUTHORIZATION_ERRORS, PURCHASE_AUTHORIZATION_MAX_TTL_MS, PURCHASE_BINDING_FIELDS, PURCHASE_LIMITS, PURCHASE_RETENTION_MS, PurchaseAuthorizationStore, purchaseBindingProblems, type PurchaseActor, type PurchaseBinding } from "../purchase-authorization";
import { ADMIN_A, ADMIN_B, ADMIN_C, enabledOrdering, OTHER_SCOPE, REFUSED_ACTORS, SCOPE, testBinding, testClock, testNonces } from "./_b23-c-ordering-fixture";

const ROOT = process.cwd();
const DIR = "app/lib/manufacturing-providers";
const ENABLEMENT = `${DIR}/ordering-enablement.ts`;
const AUTH = `${DIR}/purchase-authorization.ts`;
const ORDER_CONTRACT = `${DIR}/order-contract.ts`;
const WEBHOOK = `${DIR}/webhook-verification.ts`;
const ORDERING_MODULES = [ENABLEMENT, AUTH, ORDER_CONTRACT, WEBHOOK] as const;
/** The exact approved-importer set (the B18-B form: the module that holds the human-only confirmation, and the one server module that
 *  consumes). A confirmation route is a later, separately reviewed change that adds itself here (OD-171, OD-186). */
const APPROVED = new Set([AUTH, ORDER_CONTRACT]);
/** The agent's reach (b23-b-egress-import-gate's entries and directories): the loop, the gateway, the chat route, MCP and orchestration. */
const AGENT_ENTRIES = ["app/lib/agent/loop.ts", "app/lib/agent/gateway.ts", "app/api/chat/route.ts", "app/api/chat/orchestration-runtime.ts", "app/api/mcp/route.ts", "app/api/mcp/read-runtime.ts", "app/lib/mcp/server/dispatch.ts"] as const;
const AGENT_DIRECTORIES = ["app/lib/agent/", "app/lib/mcp/", "app/api/chat/", "app/api/mcp/"] as const;

let production: FileMap | null = null;
const files = (): FileMap => (production ??= collectProductionFiles(ROOT));
/** A file's runtime import edges to production files (type-only declarations erased), as `importClosure` follows them. */
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
const importersOf = (map: FileMap, target: string): string[] => {
  const name = target.split("/").at(-1)!.replace(/\.ts$/, "");
  return [...map.keys()].filter((file) => file !== target && map.get(file)!.includes(name) && runtimeEdges(map, file).includes(target)).sort();
};
const reaches = (map: FileMap, entries: readonly string[], targets: readonly string[]): string[] => {
  const closure = importClosure(map, entries.filter((entry) => map.has(entry)));
  return targets.filter((target) => closure.has(target));
};
/** The property names a source CALLS (`x.y(...)` reads `y`). */
function calledProperties(path: string, source: string): Set<string> {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) names.add(node.expression.name.text);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return names;
}
/** [B23-C fix, 2026-10-04] Every name a source SPELLS (tests-5): identifiers - declared, imported, destructured, read or called - property
 *  names, and string or template keys, so `x["confirm"](...)`, `Reflect.apply(x.confirm, ...)` and `const { confirm } = x` all count. */
function spelledNames(path: string, source: string): Set<string> {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return names;
}

function store(options: { enablement?: () => OrderingEnablement; clock?: ReturnType<typeof testClock> } = {}) {
  const clock = options.clock ?? testClock();
  return { clock, store: new PurchaseAuthorizationStore({ now: clock.now, nonce: testNonces(), enablement: options.enablement ?? enabledOrdering }) };
}
/** A request by A, confirmed by B: the handle, and the binding that was approved. */
async function minted(target: PurchaseAuthorizationStore, now: number, binding: PurchaseBinding = testBinding(now)) {
  const requested = await target.request({ actor: ADMIN_A, scope: SCOPE, binding });
  if (!requested.ok) throw new Error(`request refused: ${requested.code}`);
  const confirmed = await target.confirm({ actor: ADMIN_B, scope: SCOPE, requestId: requested.request.requestId, requestDigest: requested.request.requestDigest });
  if (!confirmed.ok) throw new Error(`confirm refused: ${confirmed.code}`);
  return { handle: confirmed.authorization, binding };
}
const codeOf = (answer: { ok: boolean; code?: string }): string => (answer.ok ? "ok" : answer.code!);

describe("[B23-C] the purchase authorization: human-only, two people, single use, bound to every field", () => {
  it("1. only the human confirmation mints: A requests, B confirms the exact request digest; the handle carries an id, a digest and the expiry - the binding stays on the server - and consuming it with the approved binding answers every bound field", async () => {
    const { clock, store: target } = store();
    const binding = testBinding(clock.now());
    const requested = await target.request({ actor: ADMIN_A, scope: SCOPE, binding });
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    expect(requested.request.requestDigest).toMatch(/^dw1-[0-9a-f]{64}$/);
    expect(requested.request.requestedBy).toBe(ADMIN_A.actorId);
    // the server holds its own copy: changing the caller's object afterwards changes nothing it holds
    (binding.lines as unknown as Array<{ quantity: number }>)[0]!.quantity = 999;
    expect(requested.request.binding.lines[0]!.quantity).toBe(10);
    const confirmed = await target.confirm({ actor: ADMIN_B, scope: SCOPE, requestId: requested.request.requestId, requestDigest: requested.request.requestDigest });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(Object.keys(confirmed.authorization).sort()).toEqual(["authorizationDigest", "authorizationId", "expiresAt"]);
    expect(confirmed.authorization.expiresAt).toBe(requested.request.binding.expiresAt);
    expect(target.stateOf(SCOPE, confirmed.authorization.authorizationId)).toBe("issued");
    const consumed = await target.consume({ actor: ADMIN_A, scope: SCOPE, ...confirmed.authorization, binding: testBinding(clock.now()) });
    expect(consumed.ok).toBe(true);
    if (!consumed.ok) return;
    expect(consumed.authorization.binding).toEqual(testBinding(clock.now()));
    expect(consumed.authorization).toMatchObject({ authorizationId: confirmed.authorization.authorizationId, requestedBy: ADMIN_A.actorId, approvedBy: ADMIN_B.actorId, consumedBy: ADMIN_A.actorId, expiresAt: binding.expiresAt });
    expect(target.stateOf(SCOPE, confirmed.authorization.authorizationId)).toBe("consumed");
    expect([...PURCHASE_BINDING_FIELDS]).toEqual(["providerId", "operationId", "lines", "currency", "priceCeilingDecimal", "shippingDestinationRef", "releaseDigest", "expiresAt"]);
  });

  it("2. the requester and the approver are different humans, both project administrators (proposerCannotApprove); every other actor - another role, ai, automation, the migration actor - is refused at request, confirm and consume, and a refusal writes nothing", async () => {
    const { clock, store: target } = store();
    const requested = await target.request({ actor: ADMIN_A, scope: SCOPE, binding: testBinding(clock.now()) });
    if (!requested.ok) throw new Error(requested.code);
    const ids = { requestId: requested.request.requestId, requestDigest: requested.request.requestDigest };
    expect(codeOf(await target.confirm({ actor: ADMIN_A, scope: SCOPE, ...ids }))).toBe("PA_PROPOSER_CANNOT_APPROVE");
    // the same person under another kind or role is still not a second human administrator
    expect(codeOf(await target.confirm({ actor: { ...ADMIN_A, actorKind: "ai" }, scope: SCOPE, ...ids }))).toBe("PA_HUMAN_ADMIN_REQUIRED");
    for (const actor of REFUSED_ACTORS) {
      expect(codeOf(await target.request({ actor, scope: SCOPE, binding: testBinding(clock.now()) })), `request ${actor.actorId}`).toBe("PA_HUMAN_ADMIN_REQUIRED");
      expect(codeOf(await target.confirm({ actor, scope: SCOPE, ...ids })), `confirm ${actor.actorId}`).toBe("PA_HUMAN_ADMIN_REQUIRED");
    }
    for (const malformed of [null, undefined, {}, { actorId: "", actorKind: "human", role: "project_admin" }, { actorId: "user:x", actorKind: "Human", role: "project_admin" }] as unknown as PurchaseActor[]) {
      expect(codeOf(await target.request({ actor: malformed, scope: SCOPE, binding: testBinding(clock.now()) })), JSON.stringify(malformed)).toBe("PA_HUMAN_ADMIN_REQUIRED");
    }
    // nothing above wrote: B still confirms the untouched request, and only a human administrator consumes
    const confirmed = await target.confirm({ actor: ADMIN_B, scope: SCOPE, ...ids });
    if (!confirmed.ok) throw new Error(confirmed.code);
    for (const actor of REFUSED_ACTORS) expect(codeOf(await target.consume({ actor, scope: SCOPE, ...confirmed.authorization, binding: testBinding(clock.now()) })), `consume ${actor.actorId}`).toBe("PA_HUMAN_ADMIN_REQUIRED");
    expect(target.stateOf(SCOPE, confirmed.authorization.authorizationId)).toBe("issued");
    expect(codeOf(await target.consume({ actor: ADMIN_C, scope: SCOPE, ...confirmed.authorization, binding: testBinding(clock.now()) }))).toBe("ok");
  });

  it("3. the binding: closed keys, a registry ordering operation, 1-64 lines with unique ids and whole quantities, exact canonical decimals (never a JavaScript number), a ceiling at or above the lines' total, an ISO currency, a destination reference, a release/BOM digest and an expiry at most 10 minutes ahead", async () => {
    const { clock, store: target } = store();
    const now = clock.now();
    const base = testBinding(now);
    const line = base.lines[0]!;
    const withLine = (patch: Record<string, unknown>) => ({ ...base, lines: [{ ...line, ...patch }, base.lines[1]!] });
    const bad: Array<[string, unknown]> = [
      ["an extra key", { ...base, note: "x" }],
      ["a missing key", Object.fromEntries(Object.entries(base).filter(([key]) => key !== "currency"))],
      ["an unknown provider", { ...base, providerId: "boardhouse" }],
      ["a read operation", { ...base, operationId: "product-information" }],
      ["a quote operation", { ...base, operationId: "quote" }],
      ["no line", { ...base, lines: [] }],
      ["65 lines", { ...base, lines: Array.from({ length: 65 }, (_, index) => ({ ...line, lineId: `L${index}` })), priceCeilingDecimal: "1000" }],
      ["a repeated line id", { ...base, lines: [line, { ...base.lines[1]!, lineId: "L1" }] }],
      ["a line with an extra key", withLine({ note: "x" })],
      ["quantity 0", withLine({ quantity: 0 })],
      ["quantity 1.5", withLine({ quantity: 1.5 })],
      ["quantity -1", withLine({ quantity: -1 })],
      ["quantity over the bound", withLine({ quantity: 1_000_001 })],
      ["quantity as text", withLine({ quantity: "10" })],
      ["a price as a JavaScript number", withLine({ unitPriceDecimal: 0.45 })],
      ["a price with a trailing zero", withLine({ unitPriceDecimal: "0.450" })],
      ["an exponent", withLine({ unitPriceDecimal: "4.5e-1" })],
      ["a negative price", withLine({ unitPriceDecimal: "-0.45" })],
      ["a bare fraction", withLine({ unitPriceDecimal: ".45" })],
      ["seven decimals", withLine({ unitPriceDecimal: "0.0000001" })],
      ["thirteen integer digits", withLine({ unitPriceDecimal: "1234567890123" })],
      ["an empty part number", withLine({ providerPartNumber: "" })],
      ["a ceiling below the lines' total", { ...base, priceCeilingDecimal: "5.72" }],
      ["a ceiling as a number", { ...base, priceCeilingDecimal: 25 }],
      ["a lower-case currency", { ...base, currency: "usd" }],
      ["a two-letter currency", { ...base, currency: "US" }],
      ["an address, not a reference", { ...base, shippingDestinationRef: "12 Main Street" }],
      ["no destination", { ...base, shippingDestinationRef: "" }],
      ["no release digest", { ...base, releaseDigest: "" }],
      ["an expiry past 10 minutes", { ...base, expiresAt: new Date(now + PURCHASE_AUTHORIZATION_MAX_TTL_MS + 1).toISOString() }],
      ["an expiry now", { ...base, expiresAt: new Date(now).toISOString() }],
      ["an expiry that is no date", { ...base, expiresAt: "soon" }],
      ["a non-canonical expiry", { ...base, expiresAt: new Date(now + 60_000).toISOString().replace(".000Z", "Z") }],
    ];
    for (const [label, binding] of bad) {
      const answer = await target.request({ actor: ADMIN_A, scope: SCOPE, binding });
      expect(codeOf(answer), label).toBe("PA_BINDING_INVALID");
      expect(answer.ok ? [] : answer.problems ?? [], label).not.toEqual([]);
    }
    expect(codeOf(await target.request({ actor: ADMIN_A, scope: SCOPE, binding: { ...base, expiresAt: new Date(now + PURCHASE_AUTHORIZATION_MAX_TTL_MS).toISOString() } }))).toBe("ok");
    expect(codeOf(await target.request({ actor: ADMIN_A, scope: SCOPE, binding: { ...base, priceCeilingDecimal: "5.73" } }))).toBe("ok");
    // what is validated is what is held: an accessor that answers a valid ceiling once and an invalid one after cannot split the two
    let reads = 0;
    const shifty = { ...base };
    Object.defineProperty(shifty, "priceCeilingDecimal", { enumerable: true, get: () => (reads++ === 0 ? "25" : "0") });
    const held = await target.request({ actor: ADMIN_A, scope: SCOPE, binding: shifty });
    expect(held.ok && held.request.binding.priceCeilingDecimal).toBe("25");
    expect(reads).toBe(1);
    expect(codeOf(await target.request({ actor: ADMIN_A, scope: SCOPE, binding: { ...base, lines: [{ ...line, providerPartNumber: () => "x" }, base.lines[1]!] } }))).toBe("PA_BINDING_INVALID");
    expect(PURCHASE_AUTHORIZATION_MAX_TTL_MS).toBe(10 * 60_000);
    // exact decimals: where JavaScript numbers drift, the money arithmetic does not, and it agrees with CD-12's
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(addMoney("0.1", "0.2")).toBe("0.3");
    expect(multiplyMoney("0.0123", 100)).toBe("1.23");
    expect(linesTotal(base.lines)).toBe("5.73");
    expect(canonicalMoney("1.50")).toBe("1.5");
    expect(canonicalMoney("007")).toBe(null);
    expect(canonicalMoney(1.5)).toBe(null);
    expect(compareMoney("5.73", "5.730001")).toBe(-1);
    expect(compareMoney("25", "25.0")).toBe(0);
    for (const [a, b] of [["0.1", "0.2"], ["999999999999.999999", "0.000001"], ["5.73", "7.5"], ["0", "0.000001"]] as const) {
      expect(addMoney(a, b), `${a}+${b}`).toBe(addDecimal(a, b));
      expect(compareMoney(a, b), `${a}?${b}`).toBe(compareDecimal(a, b));
    }
    expect(multiplyMoney("0.0123", 7)).toBe(multiplyDecimalByInteger("0.0123", 7));
  });

  it("4. a single-use compare-and-set burns it: a second consume and a concurrent one are refused, an expired one is refused and burned, a forged id or digest or another project is refused with zero writes; a request is confirmed once, also under two racing approvers", async () => {
    const { clock, store: target } = store();
    const first = await minted(target, clock.now());
    expect(codeOf(await target.consume({ actor: ADMIN_A, scope: SCOPE, ...first.handle, authorizationDigest: `dw1-${"0".repeat(64)}`, binding: first.binding }))).toBe("PA_NOT_FOUND");
    expect(codeOf(await target.consume({ actor: ADMIN_A, scope: SCOPE, ...first.handle, authorizationId: "purchase-authorization:forged", binding: first.binding }))).toBe("PA_NOT_FOUND");
    expect(codeOf(await target.consume({ actor: ADMIN_A, scope: OTHER_SCOPE, ...first.handle, binding: first.binding }))).toBe("PA_NOT_FOUND");
    expect(target.stateOf(SCOPE, first.handle.authorizationId)).toBe("issued");
    expect(codeOf(await target.consume({ actor: ADMIN_A, scope: SCOPE, ...first.handle, binding: first.binding }))).toBe("ok");
    expect(codeOf(await target.consume({ actor: ADMIN_A, scope: SCOPE, ...first.handle, binding: first.binding }))).toBe("PA_ALREADY_USED");
    // two consumes racing: the compare-and-set lets exactly one through
    const raced = await minted(target, clock.now());
    const answers = await Promise.all([ADMIN_A, ADMIN_B].map((actor) => target.consume({ actor, scope: SCOPE, ...raced.handle, binding: raced.binding })));
    expect(answers.map(codeOf).sort()).toEqual(["PA_ALREADY_USED", "ok"]);
    // expiry: refused and burned
    const late = await minted(target, clock.now());
    clock.advance(9 * 60_000);
    expect(codeOf(await target.consume({ actor: ADMIN_A, scope: SCOPE, ...late.handle, binding: late.binding }))).toBe("PA_EXPIRED");
    expect(target.stateOf(SCOPE, late.handle.authorizationId)).toBe("expired");
    // a request: a wrong digest, an expired request, then confirmed exactly once - also when two approvers race
    const requested = await target.request({ actor: ADMIN_A, scope: SCOPE, binding: testBinding(clock.now()) });
    if (!requested.ok) throw new Error(requested.code);
    expect(codeOf(await target.confirm({ actor: ADMIN_B, scope: SCOPE, requestId: requested.request.requestId, requestDigest: `dw1-${"1".repeat(64)}` }))).toBe("PA_REQUEST_DIGEST_MISMATCH");
    expect(codeOf(await target.confirm({ actor: ADMIN_B, scope: OTHER_SCOPE, requestId: requested.request.requestId, requestDigest: requested.request.requestDigest }))).toBe("PA_REQUEST_NOT_FOUND");
    const racing = await Promise.all([ADMIN_B, ADMIN_C].map((actor) => target.confirm({ actor, scope: SCOPE, requestId: requested.request.requestId, requestDigest: requested.request.requestDigest })));
    expect(racing.map(codeOf).sort()).toEqual(["PA_REQUEST_ALREADY_CONFIRMED", "ok"]);
    const stale = await target.request({ actor: ADMIN_A, scope: SCOPE, binding: testBinding(clock.now()) });
    if (!stale.ok) throw new Error(stale.code);
    clock.advance(9 * 60_000);
    expect(codeOf(await target.confirm({ actor: ADMIN_B, scope: SCOPE, requestId: stale.request.requestId, requestDigest: stale.request.requestDigest }))).toBe("PA_REQUEST_EXPIRED");
  });

  it("5. any changed field refuses (PA_BINDING_CHANGED, naming it) and burns the authorization: the provider, the operation, each line's id, part, quantity and price, a line added, removed or reordered, the currency, the ceiling, the destination, the release digest and the expiry", async () => {
    const { clock, store: target } = store();
    const now = clock.now();
    const base = testBinding(now);
    const [l1, l2] = base.lines as [PurchaseBinding["lines"][number], PurchaseBinding["lines"][number]];
    const changes: Array<[string, Record<string, unknown>]> = [
      ["providerId", { providerId: "mouser" }],
      ["operationId", { operationId: "quote" }],
      ["lines", { lines: [{ ...l1, lineId: "L9" }, l2] }],
      ["lines", { lines: [{ ...l1, providerPartNumber: "296-1411-6-ND" }, l2] }],
      ["lines", { lines: [{ ...l1, quantity: 11 }, l2] }],
      ["lines", { lines: [{ ...l1, unitPriceDecimal: "0.46" }, l2] }],
      ["lines", { lines: [l1, l2, { ...l2, lineId: "L3" }] }],
      ["lines", { lines: [l1] }],
      ["lines", { lines: [l2, l1] }],
      ["currency", { currency: "EUR" }],
      ["priceCeilingDecimal", { priceCeilingDecimal: "26" }],
      ["shippingDestinationRef", { shippingDestinationRef: "destination:lab-bench-2" }],
      ["releaseDigest", { releaseDigest: "mfg-release-00000000000000000000000000000000" }],
      ["expiresAt", { expiresAt: new Date(Date.parse(base.expiresAt) + 1).toISOString() }],
      ["extra", { note: "x" }],
    ];
    for (const [field, change] of changes) {
      const { handle } = await minted(target, now);
      const answer = await target.consume({ actor: ADMIN_A, scope: SCOPE, ...handle, binding: { ...base, ...change } });
      expect(codeOf(answer), field).toBe("PA_BINDING_CHANGED");
      expect(answer.ok ? [] : answer.fields, field).toEqual([field]);
      expect(target.stateOf(SCOPE, handle.authorizationId), field).toBe("void");
      expect(codeOf(await target.consume({ actor: ADMIN_A, scope: SCOPE, ...handle, binding: base })), field).toBe("PA_ALREADY_USED");
    }
    for (const garbage of [null, "binding", 42, []]) {
      const { handle } = await minted(target, now);
      expect(codeOf(await target.consume({ actor: ADMIN_A, scope: SCOPE, ...handle, binding: garbage })), JSON.stringify(garbage)).toBe("PA_BINDING_CHANGED");
    }
  });

  it("6. while ordering is turned off nothing is requested, confirmed or consumed: the store's default is the production enablement (disabled); a flip to disabled refuses the confirm and the consume with zero writes", async () => {
    const clock = testClock();
    const production = new PurchaseAuthorizationStore({ now: clock.now, nonce: testNonces() });
    expect(orderingEnablement().enabled).toBe(false);
    expect(codeOf(await production.request({ actor: ADMIN_A, scope: SCOPE, binding: testBinding(clock.now()) }))).toBe("PA_ORDERING_DISABLED");
    let on = true;
    const { store: target } = store({ clock, enablement: () => (on ? enabledOrdering() : orderingEnablement()) });
    const requested = await target.request({ actor: ADMIN_A, scope: SCOPE, binding: testBinding(clock.now()) });
    if (!requested.ok) throw new Error(requested.code);
    on = false;
    expect(codeOf(await target.confirm({ actor: ADMIN_B, scope: SCOPE, requestId: requested.request.requestId, requestDigest: requested.request.requestDigest }))).toBe("PA_ORDERING_DISABLED");
    on = true;
    const confirmed = await target.confirm({ actor: ADMIN_B, scope: SCOPE, requestId: requested.request.requestId, requestDigest: requested.request.requestDigest });
    if (!confirmed.ok) throw new Error(confirmed.code);
    on = false;
    expect(codeOf(await target.consume({ actor: ADMIN_A, scope: SCOPE, ...confirmed.authorization, binding: testBinding(clock.now()) }))).toBe("PA_ORDERING_DISABLED");
    expect(target.stateOf(SCOPE, confirmed.authorization.authorizationId)).toBe("issued");
    expect(Object.keys(PURCHASE_AUTHORIZATION_ERRORS).sort()).toEqual(["PA_ALREADY_USED", "PA_BINDING_CHANGED", "PA_BINDING_INVALID", "PA_EXPIRED", "PA_HUMAN_ADMIN_REQUIRED", "PA_LIMIT_REACHED", "PA_NOT_FOUND", "PA_ORDERING_DISABLED", "PA_PROPOSER_CANNOT_APPROVE", "PA_REQUEST_ALREADY_CONFIRMED", "PA_REQUEST_DIGEST_MISMATCH", "PA_REQUEST_EXPIRED", "PA_REQUEST_NOT_FOUND"]);
  });

  it("7. the approved-importer gate: the mint/consume module is imported only within its exact approved set, and order-contract.ts is its one importer, which consumes and never requests or confirms; the agent loop, the gateway, the chat route, MCP and every orchestration module reach none of the four ordering modules (D21-33's gap, closed for them)", { timeout: 120_000 }, async () => {
    const map = files();
    const yieldNow = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve)); // between whole-tree walks (lead lesson 3)
    for (const file of ORDERING_MODULES) expect(map.has(file), file).toBe(true);
    await yieldNow();
    expect(moduleImportOffenders(map, AUTH.replace(/\.ts$/, ""), APPROVED)).toEqual([]);
    await yieldNow();
    expect(importersOf(map, AUTH)).toEqual([ORDER_CONTRACT]);
    await yieldNow();
    expect(identifierReferences(map, "PurchaseAuthorizationStore", APPROVED)).toEqual([]);
    await yieldNow();
    const called = calledProperties(ORDER_CONTRACT, map.get(ORDER_CONTRACT)!);
    expect(called.has("consume")).toBe(true);
    // [B23-C fix, 2026-10-04] reviewed strengthening (tests-5): a mint name is refused however it is spelled, not only as `x.confirm(...)`
    const spelled = spelledNames(ORDER_CONTRACT, map.get(ORDER_CONTRACT)!);
    for (const mint of ["request", "confirm"]) expect(called.has(mint) || spelled.has(mint), mint).toBe(false);
    for (const entry of AGENT_ENTRIES) {
      expect(map.has(entry), entry).toBe(true);
      expect(reaches(map, [entry], ORDERING_MODULES), entry).toEqual([]);
    }
    const modules = [...map.keys()].filter((file) => AGENT_DIRECTORIES.some((dir) => file.startsWith(dir)));
    expect(modules.length).toBeGreaterThanOrEqual(80);
    expect(modules.filter((file) => file.startsWith("app/lib/agent/orchestration/")).length).toBeGreaterThan(5);
    for (const [index, file] of modules.entries()) {
      expect(reaches(map, [file], ORDERING_MODULES), file).toEqual([]);
      if (index % 20 === 19) await new Promise((resolve) => setImmediate(resolve)); // yield between walks (lead lesson 3)
    }
  });

  it("8. the gate bites: a gateway that imports the module, a third importer (type-only included), an orchestration module reaching it through a helper, and an order contract that confirms are each caught", { timeout: 120_000 }, () => {
    const map = files();
    const withGateway: FileMap = new Map(map).set("app/lib/agent/gateway.ts", `${map.get("app/lib/agent/gateway.ts")!}\nimport { PurchaseAuthorizationStore } from "../manufacturing-providers/purchase-authorization";\nvoid PurchaseAuthorizationStore;\n`);
    expect(reaches(withGateway, ["app/lib/agent/gateway.ts"], ORDERING_MODULES)).toContain(AUTH);
    const withThird: FileMap = new Map(map).set("app/lib/bom/b23c-probe.ts", 'import type { PurchaseBinding } from "../manufacturing-providers/purchase-authorization";\nexport type Probe = PurchaseBinding;\n');
    expect(moduleImportOffenders(withThird, AUTH.replace(/\.ts$/, ""), APPROVED)).toEqual(["app/lib/bom/b23c-probe.ts"]);
    const viaHelper: FileMap = new Map(map)
      .set("app/lib/bom/b23c-helper.ts", 'import { OrderContract } from "../manufacturing-providers/order-contract";\nexport const helper = OrderContract;\n')
      .set("app/lib/agent/orchestration/b23c-probe.ts", 'import { helper } from "../../bom/b23c-helper";\nexport const probe = helper;\n');
    expect(reaches(viaHelper, ["app/lib/agent/orchestration/b23c-probe.ts"], ORDERING_MODULES)).toEqual(expect.arrayContaining([ORDER_CONTRACT, AUTH]));
    const confirming = `${map.get(ORDER_CONTRACT)!}\nexport async function b23cProbe(store: { confirm(input: unknown): Promise<unknown> }): Promise<unknown> { return store.confirm({}); }\n`;
    expect(calledProperties(ORDER_CONTRACT, confirming).has("confirm")).toBe(true);
    // [B23-C fix, 2026-10-04] the spellings the call check missed (tests-5) are each caught
    for (const probe of ["export const b23cProbe = (store: Record<string, (input: unknown) => unknown>) => store[\"confirm\"]({});", "export const b23cProbe = (store: { request: (input: unknown) => unknown }) => Reflect.apply(store.request, store, [{}]);", "export const b23cProbe = (store: { confirm: (input: unknown) => unknown }) => { const { confirm } = store; return confirm.call(store, {}); };", "export const b23cProbe = (store: Record<string, (input: unknown) => unknown>) => store[`request`]({});"]) {
      const probed = `${map.get(ORDER_CONTRACT)!}\n${probe}\n`;
      const names = spelledNames(ORDER_CONTRACT, probed), calls = calledProperties(ORDER_CONTRACT, probed);
      expect(names.has("confirm") || names.has("request"), probe).toBe(true);
      expect(calls.has("confirm") || calls.has("request"), probe).toBe(false); // the call check alone misses it
    }
  });

  // [B23-C fix, 2026-10-04] cases 9-11 close the adversarial review's findings regressions-1, coverage-3 / tests-3 and tests-9
  // (ordering-boundary.md section 8).
  it("9. exact money never throws on its own results: a lines' total past 12 integer digits stays exact, a binding whose total overflows its ceiling is refused PA_BINDING_INVALID (never thrown), a hostile binding is a problem, and what comes in is still bounded", async () => {
    const { clock, store: target } = store();
    const now = clock.now();
    const base = testBinding(now);
    const huge = { ...base, lines: [{ ...base.lines[0]!, quantity: 1_000_000, unitPriceDecimal: "1000000" }, base.lines[1]!] };
    for (const priceCeilingDecimal of ["25", "999999999999.999999"]) {
      const binding = { ...huge, priceCeilingDecimal };
      expect(() => purchaseBindingProblems(binding, now), priceCeilingDecimal).not.toThrow();
      expect(purchaseBindingProblems(binding, now), priceCeilingDecimal).toEqual(["priceCeilingDecimal: below the lines' total"]);
      const answer = await target.request({ actor: ADMIN_A, scope: SCOPE, binding });
      expect(answer.ok ? "ok" : [answer.code, answer.problems], priceCeilingDecimal).toEqual(["PA_BINDING_INVALID", ["priceCeilingDecimal: below the lines' total"]]);
    }
    const overflowing = [{ quantity: 10, unitPriceDecimal: "999999999999" }, { quantity: 100, unitPriceDecimal: "0.0123" }];
    expect(linesTotal(overflowing)).toBe("9999999999991.23");
    expect(linesTotal(overflowing)).toBe(addDecimal(multiplyDecimalByInteger("999999999999", 10), multiplyDecimalByInteger("0.0123", 100)));
    expect(addMoney(linesTotal(overflowing), "7.5")).toBe("9999999999998.73");
    expect(compareMoney(linesTotal(overflowing), "999999999999.999999")).toBe(1);
    expect(canonicalMoney("9999999999991.23")).toBe(null);
    expect(canonicalMoney("999999999999.999999")).toBe("999999999999.999999");
    const hostile = { ...base, get lines(): unknown { throw new Error("hostile binding"); } };
    expect(purchaseBindingProblems(hostile, now)).toEqual(["binding: unreadable"]);
  });

  it("10. the stores are bounded and refuse when full, writing nothing: a project's requests and authorizations, and the server's requests, each stop at their limit while another project is unaffected; an entry is dropped only once its expiry plus the retention period has passed", async () => {
    expect(PURCHASE_LIMITS).toEqual({ maxLines: 64, maxLineQuantity: 1_000_000, requestsPerScope: 32, requests: 2048, authorizationsPerScope: 64, authorizations: 4096 });
    expect(PURCHASE_RETENTION_MS).toBe(60 * 60_000);
    const clock = testClock();
    const bounded = new PurchaseAuthorizationStore({ now: clock.now, nonce: testNonces(), enablement: enabledOrdering, limits: { requestsPerScope: 2, requests: 3, authorizationsPerScope: 1 } });
    const ask = (scope = SCOPE) => bounded.request({ actor: ADMIN_A, scope, binding: testBinding(clock.now()) });
    const first = await ask(), second = await ask();
    if (!first.ok || !second.ok) throw new Error("the first two requests are admitted");
    expect(codeOf(await ask())).toBe("PA_LIMIT_REACHED"); // the project's limit
    expect(codeOf(await ask(OTHER_SCOPE))).toBe("ok"); // the refusal above wrote nothing, or the server's limit of 3 would refuse this
    expect(codeOf(await ask(OTHER_SCOPE))).toBe("PA_LIMIT_REACHED"); // the server's limit
    const approveAs = (held: { request: { requestId: string; requestDigest: string } }, actor: PurchaseActor = ADMIN_B) => bounded.confirm({ actor, scope: SCOPE, requestId: held.request.requestId, requestDigest: held.request.requestDigest });
    expect(codeOf(await approveAs(first))).toBe("ok");
    expect(codeOf(await approveAs(second))).toBe("PA_LIMIT_REACHED");
    expect(codeOf(await approveAs(second, ADMIN_C))).toBe("PA_LIMIT_REACHED"); // still unconfirmed: the refusal wrote nothing
    const expiry = Date.parse(first.request.binding.expiresAt);
    clock.advance(expiry + PURCHASE_RETENTION_MS - 1 - clock.now());
    expect(codeOf(await ask())).toBe("PA_LIMIT_REACHED"); // one millisecond before expiry + retention, nothing is dropped
    clock.advance(1);
    expect(codeOf(await ask())).toBe("ok");
  });

  it("11. the fixture's server nonces are distinct: 4096 calls of each sequence give 4096 different 32-hex values, so no request or authorization id repeats within a suite", () => {
    for (const prefix of ["a", "c", "d", "e"]) {
      const next = testNonces(prefix);
      const values = Array.from({ length: 4096 }, () => next());
      expect(new Set(values).size, prefix).toBe(4096);
      expect(values.every((value) => /^[0-9a-f]{32}$/.test(value)), prefix).toBe(true);
    }
  });
});
