/**
 * [B23-C] The order contract, against a fake provider port only (runbook B23-C :996-998: "Re-read price and availability immediately
 * before submission." and "Duplicate submission, retry after timeout and webhook replay must not create duplicate orders. An ambiguous
 * provider response must be `UNKNOWN_PENDING_RECONCILIATION`, never silently retried."; D23-4's order-contract half, D23-11; OD-172).
 *
 * The port is injected and only a test injects one: no production composition root wires it (case 7), ordering is turned off (OD-171),
 * and every case that submits holds the fixture's fake owner record and a wired TEST port. The fake port is an in-process object whose
 * answers each case scripts; nothing leaves the process and nothing is written.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectProductionFiles, identifierReferences, moduleImportOffenders, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { ORDER_SUBMISSION_PORT_WIRING, ORDERING_OWNER_RECORD, orderingEnablement } from "../ordering-enablement";
import { ORDER_CONTRACT_CODES, ORDER_DEADLINES_MS, ORDER_LIMITS, ORDER_STATES, OrderContract, orderIdempotencyKeyOf, type OrderAnswer, type OrderContractOptions, type OrderSubmissionPort } from "../order-contract";
import { addMoney, cartDigestOf, linesTotal, PurchaseAuthorizationStore, type PurchaseBinding, type PurchaseScope } from "../purchase-authorization";
import { signWebhook, WEBHOOK_HEADER_NAMES, WebhookReplayStore } from "../webhook-verification";
import { ADMIN_A, ADMIN_B, enabledOrdering, fakeOrderPort, never, OTHER_SCOPE, quoteFor, REFUSED_ACTORS, SCOPE, TEST_OWNER_RECORD, TEST_WEBHOOK_SECRET, testBinding, testClock, testNonces } from "./_b23-c-ordering-fixture";
import { durableWorkflowJson } from "../../durable-workflow/stable";
import { PROVIDER_ROWS, type ProviderRow } from "../provider-registry";

const ORDER_CONTRACT = "app/lib/manufacturing-providers/order-contract.ts";
type Fake = ReturnType<typeof fakeOrderPort>;

function harness(options: { port?: Fake; enabled?: boolean; enablementEnv?: Record<string, string>; deadlines?: { requoteMs?: number; submitMs?: number }; webhook?: boolean; webhookProvider?: string; limits?: OrderContractOptions["limits"] } = {}) {
  const clock = testClock();
  const authorizations = new PurchaseAuthorizationStore({ now: clock.now, nonce: testNonces("a"), enablement: enabledOrdering });
  const port = options.port ?? fakeOrderPort();
  const enablement = options.enablementEnv ? () => orderingEnablement({ ownerRecord: TEST_OWNER_RECORD, submissionPort: "wired", env: options.enablementEnv }) : options.enabled === false ? undefined : enabledOrdering;
  const replay = new WebhookReplayStore();
  const contract = new OrderContract({ port, authorizations, enablement, now: clock.now, deadlines: options.deadlines, webhook: options.webhook === false ? undefined : { providerId: options.webhookProvider ?? "digikey", secret: TEST_WEBHOOK_SECRET, replay }, limits: options.limits });
  return { clock, authorizations, port, contract, replay };
}
/** A, then B, approve `binding` in `scope`; the handle, the binding to submit and the scope. */
async function approve(authorizations: PurchaseAuthorizationStore, binding: PurchaseBinding, scope: PurchaseScope = SCOPE) {
  const requested = await authorizations.request({ actor: ADMIN_A, scope, binding });
  if (!requested.ok) throw new Error(`request refused: ${requested.code}`);
  const confirmed = await authorizations.confirm({ actor: ADMIN_B, scope, requestId: requested.request.requestId, requestDigest: requested.request.requestDigest });
  if (!confirmed.ok) throw new Error(`confirm refused: ${confirmed.code}`);
  return { authorizationId: confirmed.authorization.authorizationId, authorizationDigest: confirmed.authorization.authorizationDigest, binding, scope };
}
const submitAs = (contract: OrderContract, approved: Awaited<ReturnType<typeof approve>>, actor = ADMIN_A): Promise<OrderAnswer> => contract.submit({ actor, ...approved }); // the approval carries its scope
/** A binding for its own cart (its own part number on line 2), so carts never block one another unless a case wants them to. */
const cart = (now: number, tag: string): PurchaseBinding => {
  const base = testBinding(now);
  return { ...base, lines: [base.lines[0]!, { ...base.lines[1]!, providerPartNumber: `part-${tag}` }] };
};

describe("[B23-C] the order contract against a fake provider port", () => {
  it("1. turned off by default: with the production enablement the contract refuses ORDER_DISABLED before anything - no authorization consumed, no port called - whoever asks; the operator switch turns even a complete fake record off", async () => {
    const off = harness({ enabled: false });
    const approved = await approve(off.authorizations, testBinding(off.clock.now()));
    for (const actor of [ADMIN_A, ...REFUSED_ACTORS]) {
      const answer = await submitAs(off.contract, approved, actor);
      expect(answer.code, actor.actorId).toBe("ORDER_DISABLED");
      expect(answer.order, actor.actorId).toBe(null);
    }
    expect(off.port.calls).toEqual([]);
    expect(off.authorizations.stateOf(SCOPE, approved.authorizationId)).toBe("issued");
    const switched = harness({ enablementEnv: { SIRKIT_ORDERING_DISABLED: "1" } });
    const second = await approve(switched.authorizations, testBinding(switched.clock.now()));
    expect((await submitAs(switched.contract, second)).code).toBe("ORDER_DISABLED");
    expect(switched.port.calls).toEqual([]);
    expect([...ORDER_STATES]).toEqual(["prepared", "submitted", "accepted", "rejected", "UNKNOWN_PENDING_RECONCILIATION", "not_submitted"]);
  });

  it("2. consume, then re-read, then ONE submission: the record is accepted with the provider's order id; the submission carries the re-read prices, a total under the ceiling and the one idempotency key derived from the authorization; a refused actor writes nothing", async () => {
    let stateAtRequote: string | null = null;
    const holder: { authorizations?: PurchaseAuthorizationStore; id?: string } = {};
    const port = fakeOrderPort({ requote: (input) => { stateAtRequote = holder.authorizations!.stateOf(SCOPE, holder.id!); return quoteFor(input); } });
    const { authorizations, contract, clock } = harness({ port });
    const approved = await approve(authorizations, testBinding(clock.now()));
    Object.assign(holder, { authorizations, id: approved.authorizationId });
    for (const actor of REFUSED_ACTORS) expect((await submitAs(contract, approved, actor)).code, actor.actorId).toBe("ORDER_HUMAN_ADMIN_REQUIRED");
    expect(port.calls).toEqual([]);
    expect(authorizations.stateOf(SCOPE, approved.authorizationId)).toBe("issued");
    const answer = await submitAs(contract, approved);
    expect(answer).toMatchObject({ ok: true, code: "ORDER_ACCEPTED", idempotent: false });
    expect(port.calls.map((call) => call.kind)).toEqual(["requote", "submit"]);
    expect(stateAtRequote).toBe("consumed"); // the re-read runs after the burn, immediately before the hand-over
    const submitted = port.calls[1]!;
    if (submitted.kind !== "submit") throw new Error("expected a submission");
    const key = orderIdempotencyKeyOf(SCOPE, approved.authorizationId);
    expect(key).toMatch(/^so-[0-9a-f]{64}$/);
    expect(submitted.input).toEqual({ providerId: "digikey", operationId: "ordering", idempotencyKey: key, currency: "USD", lines: [{ lineId: "L1", providerPartNumber: "296-1411-5-ND", quantity: 10, unitPriceDecimal: "0.45" }, { lineId: "L2", providerPartNumber: "311-10.0KCRCT-ND", quantity: 100, unitPriceDecimal: "0.0123" }], chargesDecimal: "7.5", totalDecimal: "13.23", maxTotalDecimal: "25", shippingDestinationRef: "destination:lab-bench-1", releaseDigest: "mfg-release-45b3b7efbc85dc3a8ecd233c906384cd" });
    expect(answer.order).toMatchObject({ state: "accepted", providerOrderId: "fake-provider-order-2", idempotencyKey: key, submittedBy: ADMIN_A.actorId, requote: { currency: "USD", chargesDecimal: "7.5", totalDecimal: "13.23" } });
    expect(orderIdempotencyKeyOf(SCOPE, `${approved.authorizationId}x`)).not.toBe(key);
    expect(ORDER_DEADLINES_MS).toEqual({ requoteMs: 15_000, submitMs: 30_000 });
  });

  it("3. price and availability are re-read immediately before submission: a changed price (up or down), short or unknown stock, a total above the ceiling, another currency, other lines or an inconsistent total each refuse; nothing is submitted; the burned authorization replays the refusal", { timeout: 30_000 }, async () => {
    const cases: Array<[string, (input: Parameters<OrderSubmissionPort["requote"]>[0]) => unknown, string]> = [
      ["a dearer line", (input) => quoteFor(input, { prices: { L1: "0.46" }, total: "13.33" }), "ORDER_PRICE_CHANGED"],
      ["a cheaper line", (input) => quoteFor(input, { prices: { L1: "0.44" }, total: "13.13" }), "ORDER_PRICE_CHANGED"],
      ["short stock", (input) => quoteFor(input, { available: { L1: 9 } }), "ORDER_AVAILABILITY_SHORT"],
      ["unknown stock", (input) => quoteFor(input, { available: { L2: null } }), "ORDER_AVAILABILITY_SHORT"],
      ["a total over the ceiling", (input) => quoteFor(input, { charges: "19.28", total: "25.01" }), "ORDER_ABOVE_CEILING"],
      ["another currency", (input) => quoteFor(input, { currency: "EUR" }), "ORDER_REQUOTE_MISMATCH"],
      ["a line missing", (input) => ({ ...quoteFor(input), lines: (quoteFor(input).lines as unknown[]).slice(0, 1) }), "ORDER_REQUOTE_MISMATCH"],
      ["a line added", (input) => ({ ...quoteFor(input), lines: [...(quoteFor(input).lines as unknown[]), { lineId: "L3", providerPartNumber: "x", unitPriceDecimal: "1", availableQuantity: 5 }] }), "ORDER_REQUOTE_MISMATCH"],
      ["an inconsistent total", (input) => quoteFor(input, { total: "13.24" }), "ORDER_REQUOTE_MISMATCH"],
      ["a price as a JavaScript number", (input) => ({ ...quoteFor(input), lines: (quoteFor(input).lines as Array<Record<string, unknown>>).map((line) => ({ ...line, unitPriceDecimal: Number(line.unitPriceDecimal) })) }), "ORDER_REQUOTE_MISMATCH"],
      ["an unreadable answer", () => "ok", "ORDER_REQUOTE_MISMATCH"],
      ["a throwing re-read", () => { throw new Error("provider unavailable"); }, "ORDER_REQUOTE_FAILED"],
      ["a re-read that never answers", () => never(), "ORDER_REQUOTE_FAILED"],
    ];
    for (const [label, requote, code] of cases) {
      const port = fakeOrderPort({ requote });
      const { authorizations, contract, clock } = harness({ port, deadlines: { requoteMs: 20 } });
      const approved = await approve(authorizations, testBinding(clock.now()));
      const answer = await submitAs(contract, approved);
      expect(answer.code, label).toBe(code);
      expect(answer.ok, label).toBe(false);
      expect(answer.order?.state, label).toBe("not_submitted");
      expect(port.count("submit"), label).toBe(0);
      expect(authorizations.stateOf(SCOPE, approved.authorizationId), label).toBe("consumed");
      const replay = await submitAs(contract, approved);
      expect([replay.code, replay.idempotent], label).toEqual([code, true]);
      expect(port.count("requote"), label).toBe(1);
    }
    // controls: a provider's longer spelling of the bound price, and a total exactly at the ceiling, are accepted
    for (const [label, requote] of [["0.01230 for 0.0123", (input: Parameters<OrderSubmissionPort["requote"]>[0]) => quoteFor(input, { prices: { L2: "0.01230" } })], ["the ceiling exactly", (input: Parameters<OrderSubmissionPort["requote"]>[0]) => quoteFor(input, { charges: "19.27", total: "25" })]] as const) {
      const port = fakeOrderPort({ requote });
      const { authorizations, contract, clock } = harness({ port });
      expect((await submitAs(contract, await approve(authorizations, testBinding(clock.now())))).code, label).toBe("ORDER_ACCEPTED");
    }
  });

  it("4. a duplicate submit, two racing submits and a retry after a timeout never create a second order; a new authorization for a cart whose order is unresolved is refused before its authorization is burned", async () => {
    const { authorizations, contract, port, clock } = harness();
    const approved = await approve(authorizations, cart(clock.now(), "dup"));
    expect((await submitAs(contract, approved)).code).toBe("ORDER_ACCEPTED");
    const again = await submitAs(contract, approved);
    expect([again.code, again.idempotent, port.count("submit")]).toEqual(["ORDER_ACCEPTED", true, 1]);
    // racing: one submission reaches the port
    const raced = await approve(authorizations, cart(clock.now(), "race"));
    const answers = await Promise.all([submitAs(contract, raced), submitAs(contract, raced, ADMIN_B)]);
    expect(port.count("submit")).toBe(2);
    // [B23-C fix, 2026-10-04] the loser is pinned exactly (tests-7; it accepted any of three codes): it answers the winner's record, idempotent
    expect(answers.map((answer) => [answer.code, answer.idempotent])).toEqual([["ORDER_ACCEPTED", false], ["ORDER_IN_FLIGHT", true]]);
    expect(answers[1]!.order?.orderId).toBe(answers[0]!.order!.orderId);
    expect((await submitAs(contract, raced)).code).toBe("ORDER_ACCEPTED");
    expect(port.count("submit")).toBe(2);
    // a timeout: UNKNOWN, never retried - neither by the same authorization nor by a fresh one for the same cart
    const slow = fakeOrderPort({ submit: () => never() });
    const timed = harness({ port: slow, deadlines: { submitMs: 20 } });
    const first = await approve(timed.authorizations, cart(timed.clock.now(), "slow"));
    const unknown = await submitAs(timed.contract, first);
    expect([unknown.code, unknown.order?.state]).toEqual(["ORDER_UNKNOWN_PENDING_RECONCILIATION", "UNKNOWN_PENDING_RECONCILIATION"]);
    const retried = await submitAs(timed.contract, first);
    expect([retried.code, retried.idempotent]).toEqual(["ORDER_UNKNOWN_PENDING_RECONCILIATION", true]);
    const fresh = await approve(timed.authorizations, cart(timed.clock.now(), "slow"));
    const blocked = await submitAs(timed.contract, fresh);
    expect(blocked.code).toBe("ORDER_IN_FLIGHT");
    expect(timed.authorizations.stateOf(SCOPE, fresh.authorizationId)).toBe("issued");
    expect([slow.count("requote"), slow.count("submit")]).toEqual([1, 1]);
    // another cart is not blocked
    const other = await approve(timed.authorizations, cart(timed.clock.now(), "other"));
    expect((await submitAs(timed.contract, other)).code).toBe("ORDER_UNKNOWN_PENDING_RECONCILIATION");
    expect(slow.count("submit")).toBe(2);
  });

  it("5. an ambiguous answer is UNKNOWN_PENDING_RECONCILIATION and is never retried - a throw, an abort, a server-error answer, an unreadable answer, an acceptance without an order id, an unknown outcome; a definite refusal is rejected and never retried either", async () => {
    const ambiguous: Array<[string, (input: unknown, signal: AbortSignal) => unknown]> = [
      ["a throw", () => { throw new Error("socket hang up"); }],
      ["an abort", () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }],
      ["a server-error answer", () => ({ outcome: "error", status: 503 })],
      ["an unreadable answer", () => "<html>gateway</html>"],
      ["an acceptance without an order id", () => ({ outcome: "accepted" })],
      ["an acceptance with an unusable order id", () => ({ outcome: "accepted", providerOrderId: "has space" })],
      ["an unknown outcome", () => ({ outcome: "queued", providerOrderId: "p-1" })],
      ["null", () => null],
    ];
    for (const [label, submit] of ambiguous) {
      const port = fakeOrderPort({ submit });
      const { authorizations, contract, clock } = harness({ port });
      const approved = await approve(authorizations, testBinding(clock.now()));
      const answer = await submitAs(contract, approved);
      expect([answer.code, answer.order?.state, port.count("submit")], label).toEqual(["ORDER_UNKNOWN_PENDING_RECONCILIATION", "UNKNOWN_PENDING_RECONCILIATION", 1]);
      expect(answer.order?.providerOrderId ?? null, label).toBe(null);
      expect((await submitAs(contract, approved)).code, label).toBe("ORDER_UNKNOWN_PENDING_RECONCILIATION");
      expect(port.count("submit"), label).toBe(1);
    }
    const refusing = fakeOrderPort({ submit: () => ({ outcome: "rejected", reason: "the provider refused the lines" }) });
    const { authorizations, contract, clock } = harness({ port: refusing });
    const approved = await approve(authorizations, testBinding(clock.now()));
    const answer = await submitAs(contract, approved);
    expect([answer.code, answer.order?.state, refusing.count("submit")]).toEqual(["ORDER_REJECTED", "rejected", 1]);
    expect((await submitAs(contract, approved)).idempotent).toBe(true);
    expect(refusing.count("submit")).toBe(1);
    // a throw that arrives after the deadline is dropped: the order stays UNKNOWN and nothing is left unhandled
    const late = fakeOrderPort({ submit: () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error("late reset")), 40)) });
    const lateRun = harness({ port: late, deadlines: { submitMs: 10 } });
    const lateAnswer = await submitAs(lateRun.contract, await approve(lateRun.authorizations, testBinding(lateRun.clock.now())));
    expect([lateAnswer.code, late.count("submit")]).toEqual(["ORDER_UNKNOWN_PENDING_RECONCILIATION", 1]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(lateRun.contract.orders(SCOPE).map((order) => order.state)).toEqual(["UNKNOWN_PENDING_RECONCILIATION"]);
    // [B23-C fix, 2026-10-04] reviewed pin move: + ORDER_DISABLED_BEFORE_SUBMISSION, the second enablement check before the hand-over (security-1); [B23-C lead, 2026-10-04] + ORDER_CART_BUSY, a claim conflict's own answer (case 15)
    expect(Object.keys(ORDER_CONTRACT_CODES).sort()).toEqual(["ORDER_ABOVE_CEILING", "ORDER_ACCEPTED", "ORDER_AUTHORIZATION_REFUSED", "ORDER_AVAILABILITY_SHORT", "ORDER_CART_BUSY", "ORDER_DISABLED", "ORDER_DISABLED_BEFORE_SUBMISSION", "ORDER_HUMAN_ADMIN_REQUIRED", "ORDER_IN_FLIGHT", "ORDER_LIMIT_REACHED", "ORDER_PRICE_CHANGED", "ORDER_REJECTED", "ORDER_REQUOTE_FAILED", "ORDER_REQUOTE_MISMATCH", "ORDER_UNKNOWN_PENDING_RECONCILIATION"]);
  });

  it("6. webhooks: a verified event is recorded on the order it names and never creates, submits or changes an order; its replay, a forged event, an event for an unknown order and an unreadable event are refused or ignored", async () => {
    const { authorizations, contract, port, clock } = harness();
    const approved = await approve(authorizations, testBinding(clock.now()));
    const accepted = await submitAs(contract, approved);
    const providerOrderId = accepted.order!.providerOrderId!;
    const deliver = (id: string, body: string, secret = TEST_WEBHOOK_SECRET) => {
      const rawBody = new Uint8Array(Buffer.from(body, "utf8"));
      const timestamp = String(Math.floor(clock.now() / 1000));
      return contract.receiveWebhook({ rawBody, headers: { [WEBHOOK_HEADER_NAMES.id]: id, [WEBHOOK_HEADER_NAMES.timestamp]: timestamp, [WEBHOOK_HEADER_NAMES.signature]: signWebhook({ secret, id, timestamp, rawBody }) } });
    };
    const event = (status: string, orderId = providerOrderId, type = "order.status") => JSON.stringify({ type, providerOrderId: orderId, status });
    expect(deliver("evt-1", event("shipped"))).toMatchObject({ ok: true, code: "WEBHOOK_RECORDED", orderId: accepted.order!.orderId });
    expect(deliver("evt-1", event("shipped"))).toMatchObject({ ok: false, code: "WEBHOOK_REFUSED", refusal: "replayed" });
    expect(deliver("evt-2", event("cancelled"), `${TEST_WEBHOOK_SECRET}-forged`)).toMatchObject({ ok: false, code: "WEBHOOK_REFUSED", refusal: "signature_mismatch" });
    expect(deliver("evt-3", event("accepted", "provider-order-unknown"))).toMatchObject({ ok: false, code: "WEBHOOK_UNKNOWN_ORDER" });
    expect(deliver("evt-4", event("accepted", "provider-order-new", "order.created"))).toMatchObject({ ok: false, code: "WEBHOOK_UNREADABLE" });
    expect(deliver("evt-5", "not json")).toMatchObject({ ok: false, code: "WEBHOOK_UNREADABLE" });
    expect(deliver("evt-6", event("teleported"))).toMatchObject({ ok: false, code: "WEBHOOK_UNREADABLE" });
    const order = contract.order(SCOPE, approved.authorizationId)!;
    expect(order.state).toBe("accepted");
    expect(order.observations.map((observation) => [observation.eventId, observation.status])).toEqual([["evt-1", "shipped"]]);
    expect(contract.orders(SCOPE)).toHaveLength(1);
    expect(port.count("submit")).toBe(1);
    const unconfigured = harness({ webhook: false });
    expect(unconfigured.contract.receiveWebhook({ rawBody: new Uint8Array(0), headers: {} })).toMatchObject({ ok: false, code: "WEBHOOK_NOT_CONFIGURED" });
    // an event signed with one provider's secret never names another provider's order, even under the same order id
    const mouserHook = harness({ webhookProvider: "mouser" });
    const digikeyOrder = await submitAs(mouserHook.contract, await approve(mouserHook.authorizations, testBinding(mouserHook.clock.now())));
    const rawBody = new Uint8Array(Buffer.from(JSON.stringify({ type: "order.status", providerOrderId: digikeyOrder.order!.providerOrderId, status: "shipped" }), "utf8"));
    const timestamp = String(Math.floor(mouserHook.clock.now() / 1000));
    expect(mouserHook.contract.receiveWebhook({ rawBody, headers: { [WEBHOOK_HEADER_NAMES.id]: "evt-x", [WEBHOOK_HEADER_NAMES.timestamp]: timestamp, [WEBHOOK_HEADER_NAMES.signature]: signWebhook({ secret: TEST_WEBHOOK_SECRET, id: "evt-x", timestamp, rawBody }) } })).toMatchObject({ ok: false, code: "WEBHOOK_UNKNOWN_ORDER" });
    expect(mouserHook.contract.orders(SCOPE)[0]!.observations).toEqual([]);
  });

  it("7. no production composition root wires the submission port: order-contract.ts has no production importer (type-only included), no production module names OrderContract or OrderSubmissionPort, the wiring is none and no owner record exists; the module imports exactly its reviewed modules and no transport; each rule bites", { timeout: 120_000 }, async () => {
    const yieldNow = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve)); // between whole-tree walks (lead lesson 3)
    const map: FileMap = collectProductionFiles(process.cwd());
    const own = new Set([ORDER_CONTRACT]);
    expect(map.has(ORDER_CONTRACT)).toBe(true);
    await yieldNow();
    expect(moduleImportOffenders(map, ORDER_CONTRACT.replace(/\.ts$/, ""), own)).toEqual([]);
    for (const name of ["OrderContract", "OrderSubmissionPort"]) { await yieldNow(); expect(identifierReferences(map, name, own), name).toEqual([]); }
    expect(ORDER_SUBMISSION_PORT_WIRING).toBe("none");
    expect(ORDERING_OWNER_RECORD).toBe(null);
    const source = readFileSync(join(process.cwd(), ORDER_CONTRACT), "utf8");
    expect([...runtimeDeclarationSpecifiers(ORDER_CONTRACT, source)].sort()).toEqual(["../durable-workflow/stable", "./ordering-enablement", "./purchase-authorization", "./webhook-verification"]);
    expect(source).not.toMatch(/process\.env|\bfetch\(|outboundFetch|outboundUpload|provider-egress|net\/outbound-fetch|durable-workflow\/outbox|node:http|node:net/);
    const routed: FileMap = new Map(map).set("app/api/b23c-probe/route.ts", 'import { OrderContract } from "@/app/lib/manufacturing-providers/order-contract";\nexport const POST = () => new OrderContract({} as never);\n');
    await yieldNow();
    expect(moduleImportOffenders(routed, ORDER_CONTRACT.replace(/\.ts$/, ""), own)).toEqual(["app/api/b23c-probe/route.ts"]);
    await yieldNow();
    const rooted: FileMap = new Map(map).set("instrumentation.ts", `${map.get("instrumentation.ts") ?? ""}\nexport async function b23cProbe() { return import("@/app/lib/manufacturing-providers/order-contract"); }\n`);
    expect(moduleImportOffenders(rooted, ORDER_CONTRACT.replace(/\.ts$/, ""), own)).toEqual(["instrumentation.ts"]);
    await yieldNow();
    const named: FileMap = new Map(map).set("app/lib/bom/b23c-port.ts", "export interface Probe { port: OrderSubmissionPort }\ntype OrderSubmissionPort = unknown;\n");
    expect(identifierReferences(named, "OrderSubmissionPort", own)).toEqual(["app/lib/bom/b23c-port.ts"]);
  });

  // [B23-C fix, 2026-10-04] cases 8-13 close the adversarial review's findings (regressions-1, security-1, security-2, coverage-1..3,
  // tests-1..4, tests-8); each failed on the reviewed tree or was proven to catch a deliberate breakage of the source (ordering-boundary.md
  // section 8).
  it("8. the re-read keeps every line by id and part, in order, and is judged without a throw: a total past 12 integer digits, a substituted part, a relabelled line, swapped lines, unreadable charges or total and an answer that throws when read each end not_submitted with nothing sent, and the cart is free again; stock exactly at the quantity is enough", { timeout: 30_000 }, async () => {
    type Requote = Parameters<OrderSubmissionPort["requote"]>[0];
    const linesOf = (input: Requote) => quoteFor(input).lines as Array<Record<string, unknown>>;
    const cases: Array<[string, (input: Requote) => unknown, string]> = [
      ["a total past 12 integer digits", (input) => quoteFor(input, { prices: { L1: "999999999999" } }), "total"],
      ["that total, spelled out", (input) => quoteFor(input, { prices: { L1: "999999999999" }, total: "9999999999998.73" }), "unreadable"],
      ["a substituted part on L1", (input) => ({ ...quoteFor(input), lines: linesOf(input).map((line) => (line.lineId === "L1" ? { ...line, providerPartNumber: "296-1411-6-ND" } : line)) }), "lines"],
      ["a relabelled line", (input) => ({ ...quoteFor(input), lines: linesOf(input).map((line) => (line.lineId === "L1" ? { ...line, lineId: "L9" } : line)) }), "lines"],
      ["the lines swapped", (input) => ({ ...quoteFor(input), lines: [...linesOf(input)].reverse() }), "lines"],
      ["charges as a JavaScript number", (input) => ({ ...quoteFor(input), chargesDecimal: 7.5 }), "unreadable"],
      ["no total", (input) => Object.fromEntries(Object.entries(quoteFor(input)).filter(([key]) => key !== "totalDecimal")), "unreadable"],
      ["an answer that throws when read", () => ({ currency: "USD", get lines(): unknown { throw new Error("hostile answer"); } }), "unreadable"],
    ];
    for (const [label, hostile, failure] of cases) {
      let calls = 0;
      const port = fakeOrderPort({ requote: (input) => (calls++ === 0 ? hostile(input) : quoteFor(input)) });
      const { authorizations, contract, clock } = harness({ port });
      const approved = await approve(authorizations, testBinding(clock.now()));
      const answer = await submitAs(contract, approved);
      expect([answer.code, answer.order?.state, answer.order?.failure, port.count("submit")], label).toEqual(["ORDER_REQUOTE_MISMATCH", "not_submitted", failure, 0]);
      expect(authorizations.stateOf(SCOPE, approved.authorizationId), label).toBe("consumed");
      // the cart is not left in flight: a new, separately confirmed authorization for it is sent
      expect((await submitAs(contract, await approve(authorizations, testBinding(clock.now())))).code, label).toBe("ORDER_ACCEPTED");
      expect(port.count("submit"), label).toBe(1);
    }
    const exact = fakeOrderPort({ requote: (input) => quoteFor(input, { available: { L1: 10, L2: 100 } }) });
    const run = harness({ port: exact });
    expect((await submitAs(run.contract, await approve(run.authorizations, testBinding(run.clock.now())))).code).toBe("ORDER_ACCEPTED");
  });

  it("9. two authorizations for one cart, submitted at once, reach the port once: the first claims the cart before its burn, the second is refused ORDER_CART_BUSY while still issued and is usable once the first order is resolved; a store whose consume answers another cart's binding still reaches no port", async () => {
    const { authorizations, contract, port, clock } = harness();
    const x = await approve(authorizations, cart(clock.now(), "pair"));
    const y = await approve(authorizations, cart(clock.now(), "pair"));
    const [first, second] = await Promise.all([submitAs(contract, x), submitAs(contract, y, ADMIN_B)]);
    expect([first.code, first.idempotent]).toEqual(["ORDER_ACCEPTED", false]);
    expect([second.code, second.idempotent, second.order]).toEqual(["ORDER_CART_BUSY", false, null]); // [B23-C lead, 2026-10-04] pin moved in place from ORDER_IN_FLIGHT: no order exists while the first holds the claim (case 15)
    expect([port.count("requote"), port.count("submit")]).toEqual([1, 1]);
    expect([authorizations.stateOf(SCOPE, x.authorizationId), authorizations.stateOf(SCOPE, y.authorizationId)]).toEqual(["consumed", "issued"]);
    expect(contract.orders(SCOPE)).toHaveLength(1);
    // the first order is accepted (resolved): the unspent second authorization is a new, separately confirmed order (OD-186 (h))
    expect((await submitAs(contract, y)).code).toBe("ORDER_ACCEPTED");
    expect(port.count("submit")).toBe(2);
    // the guard after the burn: unreachable while the claim holds, it keeps a consume that answers another cart's binding from the port
    class OtherCartStore extends PurchaseAuthorizationStore {
      answerWith: PurchaseBinding | null = null;
      override async consume(input: Parameters<PurchaseAuthorizationStore["consume"]>[0]) {
        const consumed = await super.consume(input);
        return consumed.ok && this.answerWith ? { ...consumed, authorization: { ...consumed.authorization, binding: this.answerWith } } : consumed;
      }
    }
    const guardClock = testClock();
    const store = new OtherCartStore({ now: guardClock.now, nonce: testNonces("d"), enablement: enabledOrdering });
    const slow = fakeOrderPort({ submit: () => never() });
    const guarded = new OrderContract({ port: slow, authorizations: store, enablement: enabledOrdering, now: guardClock.now, deadlines: { submitMs: 20 } });
    const unresolved = await approve(store, cart(guardClock.now(), "p"));
    expect((await submitAs(guarded, unresolved)).code).toBe("ORDER_UNKNOWN_PENDING_RECONCILIATION");
    const other = await approve(store, cart(guardClock.now(), "q"));
    store.answerWith = unresolved.binding;
    const refused = await submitAs(guarded, other);
    expect([refused.code, refused.order?.state, refused.order?.failure]).toEqual(["ORDER_IN_FLIGHT", "not_submitted", "in_flight"]);
    expect([slow.count("requote"), slow.count("submit")]).toEqual([1, 1]);
  });

  it("10. the cart is what is ordered - the provider, the operation and each part's total quantity: while an order is unresolved, a new authorization with its lines reordered, relabelled or split is refused ORDER_IN_FLIGHT before it is burned; another quantity is another cart", async () => {
    // the provider's total follows the lines it is asked for (bound prices, 7.5 of charges)
    const consistent = (input: Parameters<OrderSubmissionPort["requote"]>[0]) => quoteFor(input, { total: addMoney(linesTotal(input.lines.map((line) => ({ quantity: line.quantity, unitPriceDecimal: line.lineId === "L1" ? "0.45" : "0.0123" }))), "7.5") });
    const slow = fakeOrderPort({ requote: consistent, submit: () => never() });
    const timed = harness({ port: slow, deadlines: { submitMs: 20 } });
    const base = cart(timed.clock.now(), "same-goods");
    expect((await submitAs(timed.contract, await approve(timed.authorizations, base))).code).toBe("ORDER_UNKNOWN_PENDING_RECONCILIATION");
    const [l1, l2] = base.lines as [PurchaseBinding["lines"][number], PurchaseBinding["lines"][number]];
    const variants: Array<[string, PurchaseBinding["lines"]]> = [
      ["reordered", [l2, l1]],
      ["relabelled", [{ ...l1, lineId: "A1" }, { ...l2, lineId: "A2" }]],
      ["reordered and relabelled", [{ ...l2, lineId: "B1" }, { ...l1, lineId: "B2" }]],
      ["one line split in two", [{ ...l1, quantity: 4 }, l2, { ...l1, lineId: "L1b", quantity: 6 }]],
    ];
    for (const [label, lines] of variants) {
      const again = await approve(timed.authorizations, { ...base, lines });
      const answer = await submitAs(timed.contract, again);
      expect([answer.code, answer.order], label).toEqual(["ORDER_IN_FLIGHT", null]);
      expect(timed.authorizations.stateOf(SCOPE, again.authorizationId), label).toBe("issued");
    }
    expect(slow.count("submit")).toBe(1);
    const more = await approve(timed.authorizations, { ...base, lines: [{ ...l1, quantity: 11 }, l2] });
    expect((await submitAs(timed.contract, more)).code).toBe("ORDER_UNKNOWN_PENDING_RECONCILIATION");
    expect(slow.count("submit")).toBe(2);
  });

  it("11. the order store is bounded and refuses when full before anything is consumed, read or sent - per project and overall; an order holding observationsPerOrder observations answers WEBHOOK_OBSERVATIONS_FULL to a verified event and records nothing more", async () => {
    expect(ORDER_LIMITS).toEqual({ ordersPerScope: 256, orders: 16_384, observationsPerOrder: 32 });
    const perProject = harness({ limits: { ordersPerScope: 2 } });
    for (const tag of ["l1", "l2"]) expect((await submitAs(perProject.contract, await approve(perProject.authorizations, cart(perProject.clock.now(), tag)))).code, tag).toBe("ORDER_ACCEPTED");
    const third = await approve(perProject.authorizations, cart(perProject.clock.now(), "l3"));
    expect([(await submitAs(perProject.contract, third)).code, perProject.authorizations.stateOf(SCOPE, third.authorizationId), perProject.port.calls.length]).toEqual(["ORDER_LIMIT_REACHED", "issued", 4]);
    expect((await submitAs(perProject.contract, await approve(perProject.authorizations, cart(perProject.clock.now(), "l4"), OTHER_SCOPE))).code).toBe("ORDER_ACCEPTED");
    const overall = harness({ limits: { ordersPerScope: 5, orders: 1 } });
    expect((await submitAs(overall.contract, await approve(overall.authorizations, cart(overall.clock.now(), "o1")))).code).toBe("ORDER_ACCEPTED");
    const elsewhere = await approve(overall.authorizations, cart(overall.clock.now(), "o2"), OTHER_SCOPE);
    expect([(await submitAs(overall.contract, elsewhere)).code, overall.authorizations.stateOf(OTHER_SCOPE, elsewhere.authorizationId), overall.port.calls.length]).toEqual(["ORDER_LIMIT_REACHED", "issued", 2]);
    const capped = harness({ limits: { observationsPerOrder: 2 } });
    const accepted = await submitAs(capped.contract, await approve(capped.authorizations, testBinding(capped.clock.now())));
    const deliver = (id: string, status: string) => {
      const rawBody = new Uint8Array(Buffer.from(JSON.stringify({ type: "order.status", providerOrderId: accepted.order!.providerOrderId, status }), "utf8"));
      const timestamp = String(Math.floor(capped.clock.now() / 1000));
      return capped.contract.receiveWebhook({ rawBody, headers: { [WEBHOOK_HEADER_NAMES.id]: id, [WEBHOOK_HEADER_NAMES.timestamp]: timestamp, [WEBHOOK_HEADER_NAMES.signature]: signWebhook({ secret: TEST_WEBHOOK_SECRET, id, timestamp, rawBody }) } });
    };
    expect(deliver("cap-1", "in_production")).toMatchObject({ ok: true, code: "WEBHOOK_RECORDED" });
    expect(deliver("cap-2", "shipped")).toMatchObject({ ok: true, code: "WEBHOOK_RECORDED" });
    expect(deliver("cap-3", "cancelled")).toEqual({ ok: false, code: "WEBHOOK_OBSERVATIONS_FULL", orderId: accepted.order!.orderId });
    expect(deliver("cap-3", "cancelled")).toEqual({ ok: false, code: "WEBHOOK_REFUSED", refusal: "replayed" }); // its id is spent
    expect(capped.contract.orders(SCOPE)[0]!.observations.map((observation) => observation.eventId)).toEqual(["cap-1", "cap-2"]);
  });

  it("12. a deadline aborts the port's signal: a re-read and a submission that never answer each find their signal aborted once the contract gives up; an answered re-read's signal is not", async () => {
    const reread: AbortSignal[] = [];
    const silent = fakeOrderPort({ requote: (_input, signal) => { reread.push(signal); return never(); } });
    const first = harness({ port: silent, deadlines: { requoteMs: 20 } });
    expect((await submitAs(first.contract, await approve(first.authorizations, testBinding(first.clock.now())))).code).toBe("ORDER_REQUOTE_FAILED");
    expect(reread.map((signal) => signal.aborted)).toEqual([true]);
    const signals: { requote?: AbortSignal; submit?: AbortSignal } = {};
    const slow = fakeOrderPort({ requote: (input, signal) => { signals.requote = signal; return quoteFor(input); }, submit: (_input, signal) => { signals.submit = signal; return never(); } });
    const second = harness({ port: slow, deadlines: { submitMs: 20 } });
    expect((await submitAs(second.contract, await approve(second.authorizations, testBinding(second.clock.now())))).code).toBe("ORDER_UNKNOWN_PENDING_RECONCILIATION");
    expect([signals.requote?.aborted, signals.submit?.aborted]).toEqual([false, true]);
  });

  it("13. enablement is checked again immediately before the hand-over: ordering turned off during the re-read sends nothing; the record ends not_submitted ORDER_DISABLED_BEFORE_SUBMISSION and the authorization is spent", async () => {
    let on = true;
    const port = fakeOrderPort({ requote: (input) => { on = false; return quoteFor(input); } });
    const clock = testClock();
    const authorizations = new PurchaseAuthorizationStore({ now: clock.now, nonce: testNonces("e"), enablement: enabledOrdering });
    const switchedOff = () => orderingEnablement({ ownerRecord: TEST_OWNER_RECORD, submissionPort: "wired", env: { SIRKIT_ORDERING_DISABLED: "1" } });
    const contract = new OrderContract({ port, authorizations, now: clock.now, enablement: () => (on ? enabledOrdering() : switchedOff()) });
    const approved = await approve(authorizations, testBinding(clock.now()));
    const answer = await submitAs(contract, approved);
    expect([answer.code, answer.ok, answer.order?.state, answer.order?.failure]).toEqual(["ORDER_DISABLED_BEFORE_SUBMISSION", false, "not_submitted", "disabled"]);
    expect([port.count("requote"), port.count("submit"), authorizations.stateOf(SCOPE, approved.authorizationId)]).toEqual([1, 0, "consumed"]);
    expect((await submitAs(contract, approved)).code).toBe("ORDER_DISABLED");
    expect(port.count("submit")).toBe(0);
  });

  // [B23-C lead, 2026-10-04] cases 14-16 close the independent check's two low findings on the review round (ordering-boundary.md
  // section 8): the cart was read from other strings than consume compares (case 14), and a claim conflict answered as an unresolved
  // order (case 15); case 16 is a second way past the claim to the guard after the burn, found while correcting that guard's comment.
  it("14. the cart is read from the binding consume compares (NFC): while an order is unresolved, a new authorization for the same goods presented with a part spelled with U+212A KELVIN SIGN, with one part split across two lines one of them so spelled, or with a provider id so spelled, is refused ORDER_IN_FLIGHT before it is burned; with nothing in flight such a spelling is the confirmed binding and the held spelling is sent", async () => {
    const KELVIN = String.fromCharCode(0x212a);
    const goods = (now: number, providerId: string): PurchaseBinding => ({ ...testBinding(now), providerId, lines: [{ lineId: "L1", providerPartNumber: "K1", quantity: 10, unitPriceDecimal: "0.45" }, { lineId: "L2", providerPartNumber: "L1", quantity: 100, unitPriceDecimal: "0.0123" }] });
    // a test-only provider whose id holds a K (no registered id does), given to the store as part of its registry
    const fakeProvider = { ...PROVIDER_ROWS.find((row) => row.id === "digikey")!, id: "Kfake-b23c" } as unknown as ProviderRow;
    const registry = [...PROVIDER_ROWS, fakeProvider];
    const observed: Array<[string, string, string | null, string | null]> = [];
    const premises: Array<[string, PurchaseBinding, PurchaseBinding, PurchaseBinding]> = [];
    for (const providerId of ["digikey", fakeProvider.id]) {
      const clock = testClock();
      const authorizations = new PurchaseAuthorizationStore({ now: clock.now, nonce: testNonces("b"), enablement: enabledOrdering, registry });
      const slow = fakeOrderPort({ submit: () => never() });
      const contract = new OrderContract({ port: slow, authorizations, enablement: enabledOrdering, now: clock.now, deadlines: { submitMs: 20 } });
      const base = goods(clock.now(), providerId);
      expect((await submitAs(contract, await approve(authorizations, base))).code, providerId).toBe("ORDER_UNKNOWN_PENDING_RECONCILIATION");
      const [k1, l1] = base.lines as [PurchaseBinding["lines"][number], PurchaseBinding["lines"][number]];
      const [k1a, k1b] = [{ ...k1, quantity: 4 }, { ...k1, lineId: "L1b", quantity: 6 }];
      const variants: Array<[string, PurchaseBinding, PurchaseBinding]> = [
        ["K1 spelled with U+212A", base, { ...base, lines: [{ ...k1, providerPartNumber: `${KELVIN}1` }, l1] }],
        ["K1 split across two lines, one spelled with U+212A", { ...base, lines: [k1a, l1, k1b] }, { ...base, lines: [k1a, l1, { ...k1b, providerPartNumber: `${KELVIN}1` }] }],
      ];
      if (providerId !== "digikey") variants.push(["the provider id spelled with U+212A", base, { ...base, providerId: providerId.replace("K", KELVIN) }]);
      for (const [label, confirmed, presented] of variants) {
        const again = await approve(authorizations, confirmed);
        const answer = await submitAs(contract, { ...again, binding: presented });
        observed.push([`${providerId}: ${label}`, answer.code, answer.order?.state ?? null, authorizations.stateOf(SCOPE, again.authorizationId)]);
        premises.push([`${providerId}: ${label}`, confirmed, presented, base]);
      }
      expect([slow.count("requote"), slow.count("submit")], providerId).toEqual([1, 1]);
    }
    // refused before the burn: no record, the authorization still issued (it was burned, then refused by the guard after the burn)
    expect(observed).toEqual(observed.map(([label]) => [label, "ORDER_IN_FLIGHT", null, "issued"]));
    // the premise: consume compares each presented binding as the confirmed one, and each is the unresolved cart
    for (const [label, confirmed, presented, base] of premises) {
      expect(durableWorkflowJson(presented), label).toBe(durableWorkflowJson(confirmed));
      expect(cartDigestOf(presented), label).toBe(cartDigestOf(base));
    }
    // with nothing in flight the spelling is the confirmed binding: consumed, and the held spelling is what is sent
    const fresh = harness();
    const plain = goods(fresh.clock.now(), "digikey");
    const [p1, p2] = plain.lines as [PurchaseBinding["lines"][number], PurchaseBinding["lines"][number]];
    const sent = await submitAs(fresh.contract, { ...(await approve(fresh.authorizations, plain)), binding: { ...plain, lines: [{ ...p1, providerPartNumber: `${KELVIN}1` }, p2] } });
    const submitted = fresh.port.calls.find((call) => call.kind === "submit");
    expect([sent.code, submitted?.input.lines.map((line) => line.providerPartNumber)]).toEqual(["ORDER_ACCEPTED", ["K1", "L1"]]);
  });

  it("15. a claim conflict is its own answer: while a forged, spent, expired or otherwise bound authorization holds the cart's claim for its consume, a genuine authorization for that cart is refused ORDER_CART_BUSY - no order exists; nothing is consumed, read or sent; never the unresolved-order message - and its retry is accepted", async () => {
    type Handle = { readonly authorizationId: string; readonly authorizationDigest: string };
    const holders: Array<[string, (run: ReturnType<typeof harness>, goods: PurchaseBinding) => Promise<Handle>, string]> = [
      ["a forged authorization", async () => ({ authorizationId: "purchase-authorization:forged-b23c", authorizationDigest: `dw1-${"0".repeat(64)}` }), "PA_NOT_FOUND"],
      ["a spent authorization", async (run, goods) => {
        const spent = await approve(run.authorizations, goods);
        expect((await submitAs(run.contract, { ...spent, binding: { ...goods, shippingDestinationRef: "destination:elsewhere" } })).authorization).toBe("PA_BINDING_CHANGED");
        return spent;
      }, "PA_ALREADY_USED"],
      ["an expired authorization", async (run, goods) => {
        const stale = await approve(run.authorizations, goods);
        run.clock.advance(10 * 60_000);
        return stale;
      }, "PA_EXPIRED"],
      ["an authorization confirmed for another binding", async (run, goods) => approve(run.authorizations, { ...goods, priceCeilingDecimal: "30" }), "PA_BINDING_CHANGED"],
    ];
    const observed: unknown[][] = [];
    const expected: unknown[][] = [];
    for (const [label, holder, refusal] of holders) {
      const run = harness();
      const x = await holder(run, cart(run.clock.now(), "busy"));
      const y = await approve(run.authorizations, cart(run.clock.now(), "busy"));
      // x presents y's goods and takes the cart's claim first; y is submitted while x's consume is still answering
      const [held, genuine] = await Promise.all([submitAs(run.contract, { ...x, binding: y.binding, scope: SCOPE }), submitAs(run.contract, y, ADMIN_B)]);
      const unspent = run.authorizations.stateOf(SCOPE, y.authorizationId);
      const calls = run.port.calls.length;
      const retried = await submitAs(run.contract, y);
      observed.push([label, held.code, held.authorization, genuine.code, genuine.message, genuine.idempotent, genuine.order, unspent, calls, retried.code, run.port.count("submit")]);
      expected.push([label, "ORDER_AUTHORIZATION_REFUSED", refusal, "ORDER_CART_BUSY", ORDER_CONTRACT_CODES.ORDER_CART_BUSY, false, null, "issued", 0, "ORDER_ACCEPTED", 1]);
    }
    expect(observed).toEqual(expected);
    expect(ORDER_CONTRACT_CODES.ORDER_CART_BUSY).not.toMatch(/unresolved|reconcil/i);
    expect(ORDER_CONTRACT_CODES.ORDER_CART_BUSY).toMatch(/This request consumed, read and sent nothing/); expect(ORDER_CONTRACT_CODES.ORDER_CART_BUSY).not.toMatch(/unspent/); // [B23-C lead, 2026-10-05] the message claims nothing about an authorization it never read (was: "Nothing was consumed, read or sent: this authorization is unspent")
  });

  it("16. every submit of the claiming authorization holds the claim until its consume ends: when a twin submit of it fails first (a wrong digest) while the other's consume is still answering, a new authorization for the cart is refused ORDER_CART_BUSY before it is burned, and the twin's order is the cart's one order", async () => {
    let release: () => void = () => undefined;
    const late = new Promise<void>((resolve) => { release = resolve; });
    // the real store, answering late (a durable store's round trip): the authorization is burned, the answer not yet given
    class LateStore extends PurchaseAuthorizationStore {
      lateFor: string | null = null;
      override async consume(input: Parameters<PurchaseAuthorizationStore["consume"]>[0]) {
        const consumed = await super.consume(input);
        if (input.authorizationDigest === this.lateFor) await late;
        return consumed;
      }
    }
    const clock = testClock();
    const store = new LateStore({ now: clock.now, nonce: testNonces("f"), enablement: enabledOrdering });
    const slow = fakeOrderPort({ submit: () => never() });
    const contract = new OrderContract({ port: slow, authorizations: store, enablement: enabledOrdering, now: clock.now, deadlines: { submitMs: 50 } });
    const x = await approve(store, cart(clock.now(), "twin"));
    const y = await approve(store, cart(clock.now(), "twin"));
    store.lateFor = x.authorizationDigest;
    const wrong = submitAs(contract, { ...x, authorizationDigest: `dw1-${"0".repeat(64)}` }); // claims the cart first
    const twin = submitAs(contract, x, ADMIN_B); // the same authorization goes on; its consume answers late
    const failed = await wrong; // the claimant's consume refused first
    const genuine = submitAs(contract, y);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    const [twinAnswer, genuineAnswer] = await Promise.all([twin, genuine]);
    expect([failed.code, failed.authorization]).toEqual(["ORDER_AUTHORIZATION_REFUSED", "PA_NOT_FOUND"]);
    expect([[twinAnswer.code, twinAnswer.order?.state ?? null], [genuineAnswer.code, genuineAnswer.order?.state ?? null]]).toEqual([["ORDER_UNKNOWN_PENDING_RECONCILIATION", "UNKNOWN_PENDING_RECONCILIATION"], ["ORDER_CART_BUSY", null]]);
    expect([store.stateOf(SCOPE, x.authorizationId), store.stateOf(SCOPE, y.authorizationId)]).toEqual(["consumed", "issued"]);
    expect([slow.count("requote"), slow.count("submit"), contract.orders(SCOPE).length]).toEqual([1, 1, 1]);
    // the twin's order is unresolved: the unspent authorization is now refused ORDER_IN_FLIGHT, still unspent
    expect((await submitAs(contract, y)).code).toBe("ORDER_IN_FLIGHT");
    expect(store.stateOf(SCOPE, y.authorizationId)).toBe("issued");
  });
});
