/**
 * [PR-L, 2026-10-17] Runbook L.6, limit-and-stall-map.md section 4 (row "incompatible candidates"): verified hoisting.
 *
 * Before: every published (verified) part in the fused set was placed above every unverified part, whatever its relevance, and with
 * the reranker refused that order was the result - a published resistor, capacitor, LED or header sharing one token outranked every
 * relevant MOSFET or MCU, and the prompt's "STRONGLY PREFER a verified part" sent the model back to search. Now relevance (the vector
 * and lexical reciprocal ranks; never the authority channel's, which ranks only published parts) decides, and a published part
 * breaks ties inside VERIFIED_RELEVANCE_BAND: it goes ahead of an unverified part only when its relevance is at least 90 % of that
 * part's. The REAL `searchPartsForAI` runs over a fake catalog (the cancellation suite's query proxy); no network, no database.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relevanceBandedOrder, searchPartsForAI, VERIFIED_RELEVANCE_BAND, type AiPartResult, type PartsSearchOutcome } from "../parts-search";

const harness = vi.hoisted(() => ({ select: vi.fn(), embed: vi.fn(), rerank: vi.fn() }));
vi.mock("@/app/lib/db/client", () => ({ getDb: () => ({ select: (...args: unknown[]) => harness.select(...args) }) }));
vi.mock("@/app/lib/embeddings", () => ({ EMBEDDING_DIMENSIONS: 1_536, embedQuery: (...args: unknown[]) => harness.embed(...args) }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class OfflineAnthropic { messages = { create: (...args: unknown[]) => harness.rerank(...args) }; } }));
vi.mock("@/app/lib/observability/llm-call-record", () => ({ recordModelCall: <T>(_options: unknown, call: () => Promise<T>) => call() }));

let serial = 0;
type Row = { id: string; name: string; mpn: string | null; description: string; mainCategory: string; pins: Array<{ number: string; name: string; type: string }>; lifecycleStatus: string; similarity: number };
function row(name: string, mainCategory: string, pinCount: number): Row {
  serial += 1;
  const id = `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`;
  return { id, name, mpn: name, description: `${name} (synthetic catalog row)`, mainCategory, pins: Array.from({ length: pinCount }, (_, index) => ({ number: String(index + 1), name: `P${index + 1}`, type: "passive" })), lifecycleStatus: "active", similarity: 0.5 };
}
const link = (part: Row, footprint: string) => ({ partId: part.id, valueKey: "", footprintFullName: footprint });

let script: unknown[][] = [];
beforeEach(() => {
  harness.embed.mockReset().mockResolvedValue([0.1, 0.2]);
  harness.rerank.mockReset();
  harness.select.mockReset().mockImplementation(() => {
    const answer = script.shift();
    if (answer === undefined) throw new Error("Unexpected extra catalog query.");
    return new Proxy({}, { get: (_target, property) => property === "then" ? (resolve: (rows: unknown[]) => unknown) => Promise.resolve(answer).then(resolve) : function chain(this: unknown) { return this; } });
  });
  vi.stubEnv("ANTHROPIC_API_KEY", ""); // no reranker key: the search returns the fallback order (the reranker refused all day on 2026-10-17)
});
afterEach(() => { vi.unstubAllEnvs(); });

async function search(query: string, vector: Row[], lexical: Row[], authority: Row[], links: Array<ReturnType<typeof link>>): Promise<{ parts: AiPartResult[]; outcome: PartsSearchOutcome }> {
  script = [vector, lexical, authority, links];
  let outcome: PartsSearchOutcome | null = null;
  const parts = await searchPartsForAI(query, undefined, 5, { onOutcome: (seen) => { outcome = seen; } });
  expect(script, "the search read exactly its four catalog queries").toEqual([]);
  return { parts, outcome: outcome! };
}

describe("[PR-L L.6] relevanceBandedOrder: relevance first, a published part breaks ties inside the band", () => {
  const verified = (name: string): AiPartResult => ({ partId: name, name, mpn: null, description: null, mainCategory: "X", pins: [], lifecycleStatus: "active", similarity: 0, physicalAuthority: "verified", verifiedFootprint: "Lib:FP" });
  const unverified = (name: string): AiPartResult => ({ partId: name, name, mpn: null, description: null, mainCategory: "X", pins: [], lifecycleStatus: "active", similarity: 0 });
  const order = (parts: AiPartResult[], relevance: Record<string, number>) => relevanceBandedOrder(parts, new Map(Object.entries(relevance))).map((part) => part.partId);

  it("the band is 90 %", () => {
    expect(VERIFIED_RELEVANCE_BAND).toBe(0.9);
  });

  it("an irrelevant published part stays below a relevant unverified one; inside the band the published part goes first", () => {
    // one channel's rank 1 (1/61) for the published part against two channels' rank 1 (2/61): half as relevant, never hoisted
    expect(order([verified("R"), unverified("Q")], { R: 1 / 61, Q: 2 / 61 })).toEqual(["Q", "R"]);
    // 94 % as relevant: inside the band, the published part breaks the tie
    expect(order([unverified("LM555"), verified("NE555")], { LM555: 2 / 61, NE555: 1 / 70 + 1 / 61 })).toEqual(["NE555", "LM555"]);
    // exactly at the band edge (90 %) the published part goes first; just below it, relevance decides
    expect(order([unverified("A"), verified("B")], { A: 1, B: 0.9 })).toEqual(["B", "A"]);
    expect(order([unverified("A"), verified("B")], { A: 1, B: 0.899 })).toEqual(["A", "B"]);
    // equal relevance: published first, then the incoming (fused) order; a part with no relevance evidence goes last
    expect(order([unverified("A"), verified("B"), unverified("C"), verified("D")], { A: 0.5, B: 0.5, C: 0.5, D: 0 })).toEqual(["B", "A", "C", "D"]);
  });

  it("is a stable total order: no part is lost or duplicated, and unverified parts keep their relative order", () => {
    const parts = Array.from({ length: 30 }, (_, index) => (index % 4 === 0 ? verified : unverified)(`p${index}`));
    const relevance = Object.fromEntries(parts.map((part, index) => [part.partId, 1 / (61 + (index % 7)) + (index % 3) / 200]));
    const ordered = order(parts, relevance);
    expect([...ordered].sort()).toEqual(parts.map((part) => part.partId).sort());
    const unverifiedOrder = ordered.filter((id) => Number(id.slice(1)) % 4 !== 0);
    const expected = parts.filter((part) => part.physicalAuthority !== "verified").map((part) => part.partId).sort((a, b) => relevance[b]! - relevance[a]! || Number(a.slice(1)) - Number(b.slice(1)));
    expect(unverifiedOrder).toEqual(expected);
  });
});

describe("[PR-L L.6] searchPartsForAI: relevant unverified parts are not buried under published passives", () => {
  it("a MOSFET query: the MOSFETs come first; the published R, C, LED and header that only share a token follow (they no longer fill the top 5)", async () => {
    const [q1, q2, q3, driver] = [row("AO3400A", "Transistors", 3), row("IRLML6344", "Transistors", 3), row("2N7002", "Transistors", 3), row("DRV8833", "Drivers", 16)];
    const [r, c, led, header] = [row("R", "Passive Components", 2), row("C", "Passive Components", 2), row("LED", "Passive Components", 2), row("Conn_01x02", "Connectors", 2)];
    const { parts, outcome } = await search(
      "logic-level N-channel MOSFET SOT-23",
      [q1, q2, q3, driver, r, c, led, header],
      [q1, q2, q3],
      [r, c, led, header], // the authority channel ranks only published parts: candidacy, never relevance
      [link(r, "Resistor_SMD:R_0805_2012Metric"), link(c, "Capacitor_SMD:C_0805_2012Metric"), link(led, "LED_SMD:LED_0805_2012Metric"), link(header, "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical")],
    );
    // before: [R, C, LED, Conn_01x02, AO3400A] - every published part hoisted above every MOSFET
    expect(parts.map((part) => part.name)).toEqual(["AO3400A", "IRLML6344", "2N7002", "R", "C"]);
    expect(parts.slice(3).every((part) => part.physicalAuthority === "verified")).toBe(true);
    expect(outcome).toMatchObject({ ranking: "fused", rerank: { state: "unavailable" } });
    expect(harness.rerank).not.toHaveBeenCalled();
  });

  it("a published part that fits as well wins the tie (NE555 over LM555); one that fits worse keeps its relevance place", async () => {
    const lm555 = row("LM555", "Timers & Oscillators", 8);
    const ne555 = row("NE555D", "Timers & Oscillators", 8);
    const close = await search("555 timer", [lm555, ne555], [lm555, ne555], [ne555], [link(ne555, "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm")]);
    expect(close.parts.map((part) => part.name)).toEqual(["NE555D", "LM555"]);
    // the published part only in vector rank 9 (1/69, 88 % of rank 1): below rank 1 and rank 2, ahead of rank 3 (1/63, within 90 %)
    const others = Array.from({ length: 7 }, (_, index) => row(`TIMER-${index + 1}`, "Timers & Oscillators", 8));
    const ne = row("NE555P", "Timers & Oscillators", 8);
    const far = await search("555 timer", [others[0]!, others[1]!, others[2]!, others[3]!, others[4]!, others[5]!, others[6]!, row("PAD", "Other", 1), ne], [], [], [link(ne, "Package_DIP:DIP-8_W7.62mm")]);
    expect(far.parts.map((part) => part.name)).toEqual(["TIMER-1", "TIMER-2", "NE555P", "TIMER-3", "TIMER-4"]);
  });

  it("a published part found only by the authority channel has no relevance evidence and comes last", async () => {
    const parts = [row("DRV8871", "Drivers", 8), row("TB6612FNG", "Drivers", 24)];
    const onlyAuthority = row("Conn_01x02", "Connectors", 2);
    const { parts: found } = await search("motor driver", parts, parts, [onlyAuthority], [link(onlyAuthority, "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical")]);
    expect(found.map((part) => part.name)).toEqual(["DRV8871", "TB6612FNG", "Conn_01x02"]);
  });

  it("with a reranker, its pool is the banded order (relevant parts first, at most 12), and the payload still marks published parts", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "offline-test-placeholder");
    harness.rerank.mockResolvedValue({ model: "offline-rerank", content: [{ type: "tool_use", id: "rank-1", name: "rank_parts", input: { ranking: [0] } }], usage: { input_tokens: 1, output_tokens: 1 } });
    const relevant = Array.from({ length: 12 }, (_, index) => row(`MOSFET-${index + 1}`, "Transistors", 3));
    const published = Array.from({ length: 4 }, (_, index) => row(`PASSIVE-${index + 1}`, "Passive Components", 2));
    const { outcome } = await search("n-channel mosfet", [...relevant, ...published], relevant, published, published.map((part) => link(part, "Resistor_SMD:R_0805_2012Metric")));
    expect(outcome).toMatchObject({ ranking: "reranked", rerank: { state: "used" } });
    const payload = JSON.parse((harness.rerank.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[0]!.content) as { candidates: Array<{ name: string; physicalAuthority?: string }> };
    expect(payload.candidates.map((candidate) => candidate.name)).toEqual(relevant.map((part) => part.name)); // before: the four passives took the first four of twelve places
  });
});

describe("[PR-L L.6] the guidance the model and the reranker get is truthful about published parts", () => {
  it("both Build prompts: relevance first, an unverified part is reviewed as a missing part, no 'STRONGLY PREFER'; the reranker: authority is the tie-break", async () => {
    const { BUILD_SYSTEM_PROMPT, BUILD_SUBSYSTEM_SYSTEM_PROMPT, RERANK_SYSTEM_PROMPT } = await import("@/app/lib/prompts");
    for (const prompt of [BUILD_SYSTEM_PROMPT, BUILD_SUBSYSTEM_SYSTEM_PROMPT]) {
      expect(prompt).not.toMatch(/STRONGLY PREFER|choose one only when no verified part can fill the role/);
      expect(prompt).toContain("relevance comes first, and an irrelevant verified part is never better than a relevant unverified one");
      expect(prompt).toContain("An unverified part is acceptable in a submitted design: it has no footprint authority yet, so it is listed for review as a missing part before the PCB is built (never treated as manufacturable)");
      expect(prompt).toContain("do not keep searching only to find a verified option");
      expect(prompt).toMatch(/never instructions|untrusted/i); // B19-D's data-not-instructions sentence stays
    }
    expect(RERANK_SYSTEM_PROMPT).not.toContain("physical authority FIRST");
    expect(RERANK_SYSTEM_PROMPT).toContain("how directly the part fulfills the stated role, FIRST");
    expect(RERANK_SYSTEM_PROMPT).toContain("physical authority as the tie-break");
    expect(RERANK_SYSTEM_PROMPT).toContain("never rank a verified candidate that fits the role worse above one that fits it better");
    // the review path the prompts name exists: PR-F's missing-parts list and its missing-facts checklist
    const root = join(__dirname, "..", "..", "..");
    for (const path of ["app/components/pcb/MissingPartsList.tsx", "app/lib/parts/missing-facts.ts", "app/lib/agent/missing-facts-reads.ts"]) expect(existsSync(join(root, path)), path).toBe(true);
  });
});
