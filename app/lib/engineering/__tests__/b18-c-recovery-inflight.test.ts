/**
 * [B18-C I10b] Found by the browser proof: the editor's hydration sweep (which finishes CRASHED granted executions from the
 * durable journal) ran while the page's own ritual was between the one-shot consume and its commit record — it read the
 * entry as `grant-consumed`, found the landed transaction and ADOPTED and settled the in-flight execution itself. The
 * outcome stayed right (every step is idempotent), but two writers raced on one journal entry, the server got a second
 * settle, and the user saw "AI execution recovery: … adopted-and-settled" replace the success notice.
 *
 * The sweep now shares the ritual's in-memory claim registry: an entry THIS page holds in flight is left to its ritual
 * (`left-in-flight`, never a notice), and while the sweep works on an entry it holds the claim itself.
 */
import { describe, expect, it } from "vitest";
import { recoverGrantedExecutionsForEditor } from "../../project/granted-execution-controller.internal";
import { SCOPE, call, composition, movesBy, runScenario, type Composed } from "./b18c-harness";

type Swept = Awaited<ReturnType<typeof recoverGrantedExecutionsForEditor>>;
const moveScript = (c: Composed) => (move: string) => [() => ({ toolCalls: [call("c1", move, movesBy(c, 2))] }), () => ({ text: "done" })];

describe("B18-C I10b — the hydration sweep never adopts an execution in flight in the same page", () => {
  it("a sweep between the consume and the ritual's commit record leaves the grant to its ritual: no adoption, one settle, the ritual commits", async () => {
    const c = await composition("execute_explicit_tier1");
    const settles: string[] = [];
    const realSettle = c.transport.settle.bind(c.transport);
    c.transport.settle = async (scope, body, signal) => { settles.push(body.grantId); return realSettle(scope, body, signal); };
    const realMark = c.journal.markCommitted.bind(c.journal);
    let swept: Swept | null = null;
    c.journal.markCommitted = (async (...args: Parameters<typeof realMark>) => {
      if (swept === null) {
        swept = []; // the sweep's own journal writes (pre-fix) pass straight through
        swept = await recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport: c.transport, scope: SCOPE, now: c.now, registry: c.registry });
      }
      return realMark(...args);
    }) as typeof c.journal.markCommitted;

    const run = await runScenario(c, moveScript(c));
    const grantId = run.grants[0]!.grantId;
    expect(run.rituals[0], JSON.stringify(run.rituals[0])).toMatchObject({ ok: true, status: "committed" });
    expect(swept).toEqual([expect.objectContaining({ grantId, action: "left-in-flight" })]);
    expect(settles).toEqual([grantId]); // ONE settle — the ritual's own
    expect((await c.store.load(SCOPE, grantId, c.now()))!.record.state.settlement).toMatchObject({ outcome: "committed" });
    // The claim was the ritual's: once it finished, a later sweep finds nothing pending and holds no claim.
    expect(await recoverGrantedExecutionsForEditor({ journal: c.journal, history: c.history, transport: c.transport, scope: SCOPE, now: c.now, registry: c.registry })).toEqual([]);
  }, 30_000);
});
