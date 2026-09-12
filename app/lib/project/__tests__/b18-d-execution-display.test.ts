/**
 * [B18-D I3] The SAFE display text for AI executions (chat-execution-ux.md §1, §5): operations, targets, tiers, the
 * confirmation reason and the failure / retirement / recovery sentences. Every function accepts hostile input without
 * throwing, and no sentence makes a prohibited claim (the confirmation card's copy gate, extended to these files).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RETIREMENT_REASONS, type PublicExecutionGrant } from "../../engineering/execution-grant";
import { checksLine, confirmationReason, describeOperation, describeReplay, formatMm, operationLines, recoverySentence, refusalSentence, retirementSentence, targetLines, tierLabel } from "../execution-display";

const PROHIBITED = [/production[- ]ready/i, /ready for (manufactur|production|fabrication)/i, /\bmanufacturable\b/i, /\bis safe\b|\bsafe to\b/i];
const refOf = (id: string) => (id === "fp-r3" ? "R3" : null);

function grant(over: { decision?: "preview_then_confirm" | "execute_explicit"; mode?: string; operations?: unknown[]; replay?: unknown; targets?: Record<string, unknown> } = {}): PublicExecutionGrant {
  return {
    grantId: `xg-${"1".repeat(32)}`,
    binding: {
      operation: { family: "pcb.move-footprint", tier: 1, decision: over.decision ?? "preview_then_confirm", autonomy: { mode: over.mode ?? "proposal_only", revision: 3 } },
      targets: over.targets ?? { resolvedFrom: "named", objectIds: ["fp-r3"], netIds: [], kinds: ["footprint"] },
      proposal: { operations: over.operations ?? [{ kind: "move_footprint", footprintId: "fp-r3", at: { x: 52_000_000, y: 47_480_000 } }], ...(over.replay ? { replay: over.replay } : {}), preview: { before: "R3 at (50.000, 47.480) mm", after: "R3 at (52.000, 47.480) mm", warnings: [] } },
      instruction: { excerpt: "Move R3 2 mm to the right.", explicit: { proven: over.decision === "execute_explicit", grammarId: "pcb.move-footprint", grammarVersion: "1.4.0", coverage: over.decision === "execute_explicit" ? "whole-message" : "unproven", derivedOperationsDigest: null } },
    },
  } as unknown as PublicExecutionGrant;
}

describe("B18-D I3 — the SAFE display text for AI executions", () => {
  it("operations read as sentences with references and millimetres; a replay names its transaction", () => {
    expect(formatMm(52_000_000)).toBe("52.000");
    expect(describeOperation({ kind: "move_footprint", footprintId: "fp-r3", at: { x: 52_000_000, y: 47_480_000 }, rotationDeg: 180, side: "bottom" }, refOf)).toBe("Place R3 at (52.000, 47.480) mm, rotation 180°, on the bottom side");
    expect(describeOperation({ kind: "add_silk", item: { kind: "text", text: "REV B", layer: "silkTop", position: { x: 50_100_000, y: 40_000_000 }, heightNm: 1_000_000 } })).toBe("Add silkscreen text \"REV B\" at (50.100, 40.000) mm on the top, 1.000 mm high");
    expect(describeOperation({ kind: "add_dimension", dimension: { kind: "horizontal", a: { x: 0, y: 0 }, b: { x: 100_000_000, y: 0 } } })).toBe("Add a horizontal dimension from (0.000, 0.000) mm to (100.000, 0.000) mm");
    expect(describeOperation({ kind: "remove_silk", silkId: "silk-123456789abcdef" })).toBe("Remove silkscreen item silk-1234567");
    expect(describeReplay({ direction: "undo", referencedTransactionId: "tx:move-1" })).toMatch(/^Undo of transaction tx:move-1 — the server selects its operations from the durable record$/);
    expect(operationLines(grant(), refOf)).toEqual(["Place R3 at (52.000, 47.480) mm"]);
    expect(operationLines(grant({ operations: [], replay: { direction: "redo", referencedTransactionId: "tx:9", referencedGrantId: "xg-2" } }))).toEqual([expect.stringMatching(/^Redo of transaction tx:9/)]);
  });

  it("hostile or unknown shapes never throw and render as not displayable", () => {
    for (const hostile of [null, undefined, 42, "move", [], { kind: 42 }, { kind: "delete_everything" }, { kind: "move_footprint", at: null }, { kind: "add_silk", item: null }]) {
      expect(() => describeOperation(hostile), JSON.stringify(hostile)).not.toThrow();
    }
    expect(describeOperation({ kind: 42 })).toBe("operation ? (not displayable)");
    expect(describeOperation({ kind: "delete_everything" })).toBe("operation delete_everything (not displayable)");
    expect(describeOperation({ kind: "move_footprint", at: null })).toBe("Place ? at (?)");
    expect(() => operationLines({ binding: null } as unknown as PublicExecutionGrant)).not.toThrow();
    expect(() => targetLines({ binding: {} } as unknown as PublicExecutionGrant)).not.toThrow();
    expect(() => confirmationReason({} as unknown as PublicExecutionGrant)).not.toThrow();
    expect(describeOperation({ kind: "move_footprint", footprintId: "fp-x", at: { x: 0, y: 0 } }, () => { throw new Error("boom"); })).toBe("Place footprint fp-x at (0.000, 0.000) mm");
  });

  it("targets are references where the board knows them, and nets are named, never 'none affected'", () => {
    expect(targetLines(grant(), refOf)).toEqual({ objects: ["R3"], nets: "Nets named: none" });
    expect(targetLines(grant({ targets: { objectIds: ["fp-zzzzzzzzzzzzzzzz"], netIds: [3, 5], kinds: ["footprint"] } }))).toEqual({ objects: ["footprint fp-zzzzzzzzz"], nets: "Nets named: 3, 5" });
    expect(targetLines(grant({ targets: { objectIds: ["tx:move-1"], netIds: [], kinds: ["transaction"] } })).objects).toEqual(["the change tx:move-1"]);
  });

  it("tiers use the B18-A vocabulary; anything else is not a tier", () => {
    expect(tierLabel(0)).toMatchObject({ short: "Tier 0 · read / view" });
    expect(tierLabel(1)).toMatchObject({ short: "Tier 1 · reversible edit" });
    expect(tierLabel(2)).toMatchObject({ short: "Tier 2 · proposal for your review" });
    expect(tierLabel(3)).toMatchObject({ short: "Tier 3 · never done by the assistant" });
    for (const other of [null, 4, "1", -1]) expect(tierLabel(other)).toBeNull();
  });

  it("the confirmation reason follows the decision, the retry note and the autonomy mode", () => {
    expect(confirmationReason(grant())).toBe("Required — this project asks before every AI change (proposal_only, setting revision 3).");
    expect(confirmationReason(grant({ mode: "execute_explicit_tier1" }))).toBe("Required — your message was not provably exactly this change, so the assistant asks first.");
    expect(confirmationReason(grant({ mode: "execute_explicit_tier1" }), "An identical instruction was executed recently.")).toBe("Required — An identical instruction was executed recently.");
    expect(confirmationReason(grant({ decision: "execute_explicit", mode: "execute_explicit_tier1" }))).toMatch(/^Not required — your whole message was exactly this request \(the pcb\.move-footprint grammar, version 1\.4\.0\)/);
  });

  it("failure, retirement, recovery and checks sentences: a landed change says the board MAY have changed; every reason has a sentence", () => {
    expect(refusalSentence("stale-revision", false).headline).toMatch(/Nothing was changed\.$/);
    expect(refusalSentence("stale-revision", true).headline).toMatch(/MAY have changed/);
    expect(refusalSentence("no-such-code", false)).toEqual({ headline: "Not made. Nothing was changed.", next: "Ask again." });
    for (const reason of RETIREMENT_REASONS) expect(retirementSentence(reason), reason).not.toMatch(/the server retired it/);
    expect(retirementSentence("unknown")).toBe("Not made — the server retired it. Nothing was changed.");
    for (const action of ["adopted-and-settled", "settled-from-receipt", "abandoned-not-committed", "left-in-flight", "left-issued", "refused-poisoned", "unavailable"]) expect(recoverySentence(action), action).not.toMatch(/unknown result/);
    expect(checksLine({ ran: true, violations: 7 }, "jlcpcb-2l")).toBe("Checks: design rule check (jlcpcb-2l): 7 errors (run by your editor; errors only).");
    expect(checksLine({ ran: false, violations: 0 })).toMatch(/did not run — no design-rule claim/);
    expect(checksLine(null)).toMatch(/none reported/);
  });

  it("no sentence and no source line makes a prohibited claim (safe, ready, manufacturable)", () => {
    const sentences = [
      ...["stale-revision", "policy-mismatch", "recovery-required", "already-in-flight", "x"].flatMap((code) => [refusalSentence(code, false), refusalSentence(code, true)]).flatMap((s) => [s.headline, s.next]),
      ...RETIREMENT_REASONS.map(retirementSentence),
      ...["adopted-and-settled", "refused-poisoned", "x"].map(recoverySentence),
      confirmationReason(grant()), confirmationReason(grant({ decision: "execute_explicit" })), checksLine({ ran: true, violations: 0 }),
      tierLabel(3)!.title, tierLabel(1)!.short,
    ];
    for (const sentence of sentences) for (const pattern of PROHIBITED) expect(sentence, sentence).not.toMatch(pattern);
    for (const file of ["app/lib/project/execution-display.ts", "app/lib/project/chat-run-view.ts"]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const pattern of PROHIBITED) expect(source, `${file} ${pattern}`).not.toMatch(pattern);
    }
  });
});
