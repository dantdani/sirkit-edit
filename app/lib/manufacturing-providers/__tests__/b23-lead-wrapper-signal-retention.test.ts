/**
 * [B23 lead, 2026-10-03] A route handler's exposed abort signal keeps its Request alive.
 *
 * Before this fix, the route wrappers handed a handler `request.signal` and kept nothing else. Once a wrapper had read the body and
 * returned the handler's promise, nothing held the Request. A garbage collection during a long run could take it, and the caller's
 * abort with it.
 *
 * CI hit this on 9cb675d (`b22-a3-diagnostic-runner` case 13: "timed out waiting for the abort's tree kill"). The lead's probes on
 * that case:
 * - one forced collection between the spawn and the abort failed it, 3 of 3;
 * - the same probe without the collection passed;
 * - the collection with the test's Request held strongly passed.
 *
 * Case 13 now forces that collection on every run: it is the behavioural regression test, red on the old wrappers and green with
 * `retainedSignal`. A bare wrapper and handler did not reproduce the hazard (plain Node also kept the link for an isolated Request,
 * 20 of 20), so this suite pins the source instead: every wrapper hands out `retainedSignal(request)`, which ties the Request's life
 * to its signal's. It lives in the B23 folder because CI admits that folder by one directory filter, and it writes nothing and
 * starts nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { retainedSignal } from "@/app/lib/auth/route-handlers";

describe("[B23 lead] an exposed request signal keeps its Request alive", () => {
  it("1. every route wrapper hands out retainedSignal(request), never request.signal: the one bare read in code is inside retainedSignal itself, and it returns the Request's own signal", () => {
    const source = readFileSync(join(process.cwd(), "app", "lib", "auth", "route-handlers.ts"), "utf8");
    const code = source.split("\n").filter((line) => !/^\s*(?:\*|\/\/|\/\*\*)/.test(line));
    expect(code.filter((line) => /\brequest\.signal\b/.test(line)).map((line) => line.trim())).toEqual(["const signal = request.signal;"]);
    expect((source.match(/\bretainedSignal\(request\)/g) ?? []).length).toBe(9);
    const request = new Request("http://localhost/x");
    expect(retainedSignal(request)).toBe(request.signal);
  });
});
