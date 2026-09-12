/**
 * [B18-E E2] Refusal causes the chat and the model can trust (scenario 7b, 7c, 7f, 7h):
 *  - the server's refusal of a tender names its cause: a retirement reason in words, a lost authorization (401/403), a change
 *    the server does not know (404), or another attempt that already started it (409 REPLAYED); anything else keeps the
 *    generic sentence — and "the board MAY have changed" still wins over every code;
 *  - the cancel vocabulary names what happened, sits inside the closed retirement vocabulary, and holds no reason the store
 *    would refuse for an issued grant.
 */
import { describe, expect, it } from "vitest";
import { CANCEL_RETIREMENT_REASONS, CONSUMED_RETIREMENT_REASONS, RETIREMENT_REASONS, type PublicExecutionGrant } from "../../engineering/execution-grant";
import { entryEditorOutcome, entryExecuting, entryFromGrant } from "../chat-run-view";
import { retirementSentence, serverRefusalSentence } from "../execution-display";

const grant = {
  grantId: `xg-${"9".repeat(32)}`,
  binding: {
    operation: { family: "pcb.move-footprint", tier: 1, decision: "execute_explicit", autonomy: { mode: "execute_explicit_tier1", revision: 1 } },
    targets: { resolvedFrom: "named", objectIds: ["fp-r3"], netIds: [], kinds: ["footprint"] },
    proposal: { operations: [{ kind: "move_footprint", footprintId: "fp-r3", at: { x: 52_000_000, y: 47_480_000 } }], preview: { before: "R3 at (50.000, 47.480) mm", after: "R3 at (52.000, 47.480) mm", warnings: [] } },
    instruction: { excerpt: "Move R3 2 mm to the right.", explicit: { proven: true, grammarId: "pcb.move-footprint", grammarVersion: "1.4.0", coverage: "whole-message", derivedOperationsDigest: null } },
  },
} as unknown as PublicExecutionGrant;
const executing = () => entryExecuting(entryFromGrant({ grant, decision: "execute_explicit" }, (id) => (id === "fp-r3" ? "R3" : null)));

describe("B18-E E2 — the server's refusal of a tender names its cause", () => {
  it("a retirement reason is said in words", () => {
    for (const reason of ["membership_changed", "role_changed", "run_cancelled", "revision_drift", "history_drift", "session_changed"]) {
      expect(serverRefusalSentence(reason, 409), reason).toEqual({ headline: retirementSentence(reason), next: "Ask again." });
    }
    expect(serverRefusalSentence("revision_drift", 409).headline).toBe("Not made — the board changed. Nothing was changed.");
  });

  it("a lost authorization, an unknown change and another attempt each have their own sentence; anything else is the generic one", () => {
    expect(serverRefusalSentence("http-401", 401).headline).toBe("Not made — the server no longer authorizes you for this project. Nothing was changed.");
    expect(serverRefusalSentence("EXECUTION_GRANT_HUMAN_REQUIRED", 403).headline).toBe("Not made — the server no longer authorizes you for this project. Nothing was changed.");
    expect(serverRefusalSentence("EXECUTION_GRANT_UNKNOWN", 404).headline).toBe("Not made — the server does not know this change. Nothing was changed.");
    const replayed = serverRefusalSentence("EXECUTION_GRANT_REPLAYED", 409);
    expect(replayed.headline).toBe("Not made here — another attempt had already started this change.");
    expect(replayed.headline).not.toMatch(/Nothing was changed/); // the other attempt may have changed it
    expect(serverRefusalSentence("EXECUTION_GRANT_UNAVAILABLE", 503).headline).toBe("Not made — the server refused the change (it was cancelled, expired or altered). Nothing was changed.");
  });

  it("the entry carries it; a landed commit still says the board MAY have changed", () => {
    expect(entryEditorOutcome(executing(), { ok: false, code: "consume-refused", changed: false, serverCode: "revision_drift", serverStatus: 409 }).failure?.headline).toBe("Not made — the board changed. Nothing was changed.");
    expect(entryEditorOutcome(executing(), { ok: false, code: "consume-refused", changed: false, serverCode: "http-403", serverStatus: 403 }).failure?.headline).toMatch(/no longer authorizes you/);
    expect(entryEditorOutcome(executing(), { ok: false, code: "consume-refused", changed: true, serverCode: "revision_drift", serverStatus: 409 })).toMatchObject({ state: "landed_unverified", failure: { headline: "The change LANDED but could not be verified — the board MAY have changed." } });
  });
});

describe("B18-E E2 — the cancel vocabulary", () => {
  it("names what happened, inside the closed retirement vocabulary; only session_superseded is also a consumed grant's reason", () => {
    expect([...CANCEL_RETIREMENT_REASONS]).toEqual(["cancelled_by_user", "session_superseded", "superseded_by_new_grant", "refused_before_execution", "revision_drift", "history_drift", "lineage_drift"]);
    for (const reason of CANCEL_RETIREMENT_REASONS) {
      expect(RETIREMENT_REASONS as readonly string[], reason).toContain(reason);
      expect(retirementSentence(reason), reason).not.toMatch(/the server retired it/);
    }
    expect(CANCEL_RETIREMENT_REASONS.filter((reason) => (CONSUMED_RETIREMENT_REASONS as readonly string[]).includes(reason))).toEqual(["session_superseded"]);
  });
});
