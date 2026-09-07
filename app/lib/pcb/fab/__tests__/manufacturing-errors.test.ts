/**
 * B16.1C §E — bounded public manufacturing errors with redacted traces.
 * Pre-edit probe P12 reproduced raw exception text (with a secret sentinel)
 * echoed through the qualify 500 and release 422 envelopes.
 */
import { afterEach, describe, expect, it } from "vitest";
import { boundedManufacturingFailure, MANUFACTURING_PUBLIC_ERRORS, manufacturingRefusal, redactInternalDetail, setManufacturingTraceSinkForTests } from "../manufacturing-errors";
import { ManufacturingReleaseGateError } from "../release-gate";

const SECRET = "postgres://svc:hunter2@db.internal.example:5432/sirkit?sslmode=require";

afterEach(() => setManufacturingTraceSinkForTests(null));

describe("manufacturing public error table", () => {
  it("is a closed table with an HTTP status and a public message for every code", () => {
    for (const [code, entry] of Object.entries(MANUFACTURING_PUBLIC_ERRORS)) {
      expect(code).toMatch(/^MFG_[A-Z0-9_]+$/);
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.status).toBeLessThanOrEqual(599);
      expect(entry.message.length).toBeGreaterThan(8);
      expect(entry.message).not.toMatch(/\{|\}|stack trace|Error:/);
    }
    expect(MANUFACTURING_PUBLIC_ERRORS.MFG_QUALIFICATION_IN_PROGRESS.status).toBe(409);
    expect(MANUFACTURING_PUBLIC_ERRORS.MFG_AUTHORITY_STALE.status).toBe(409);
    expect(MANUFACTURING_PUBLIC_ERRORS.MFG_RELEASE_HUMAN_REQUIRED.status).toBe(403);
    expect(MANUFACTURING_PUBLIC_ERRORS.MFG_COMPONENT_AUTHORITY_INCOMPLETE.status).toBe(422);
    expect(MANUFACTURING_PUBLIC_ERRORS.MFG_DURABLE_STORE_UNAVAILABLE.status).toBe(503);
  });

  it("manufacturingRefusal emits the table entry, no-store, and the correlation id — never caller-supplied prose", async () => {
    const response = manufacturingRefusal("MFG_AUTHORITY_NOT_FOUND", { correlationId: "corr-1", extra: { authorityBoardRevision: "pcb2-a", currentBoardRevision: "pcb2-b" } });
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Sirkit-Correlation-Id")).toBe("corr-1");
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ ok: false, code: "MFG_AUTHORITY_NOT_FOUND", correlationId: "corr-1", authorityBoardRevision: "pcb2-a", currentBoardRevision: "pcb2-b" });
    expect(body.error).toBe(MANUFACTURING_PUBLIC_ERRORS.MFG_AUTHORITY_NOT_FOUND.message);
  });
});

describe("redactInternalDetail", () => {
  it("removes connection strings, addresses, paths, and bearer tokens and bounds the length", () => {
    const detail = redactInternalDetail(`connect ECONNREFUSED 10.0.0.7:5432 ${SECRET} C:\\Users\\svc\\.env Bearer abcdefghijklmnopqrstuvwxyz0123456789 ${"x".repeat(400)}`);
    expect(detail).not.toContain("hunter2");
    expect(detail).not.toContain("10.0.0.7");
    expect(detail).not.toContain("C:\\Users");
    expect(detail).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(detail.length).toBeLessThanOrEqual(200);
  });
});

describe("boundedManufacturingFailure", () => {
  it("maps known gate codes to the table, hides raw text, and records a redacted trace with the correlation id", async () => {
    const traces: Array<Record<string, unknown>> = [];
    setManufacturingTraceSinkForTests((trace) => { traces.push(trace as unknown as Record<string, unknown>); });
    const gate = new ManufacturingReleaseGateError("MFG_RC03_RECOMPUTATION_MISMATCH", `Fresh RC02 differs ${SECRET}`);
    const response = boundedManufacturingFailure(gate, "release", "corr-2");
    expect(response.status).toBe(422);
    const body = JSON.stringify(await response.json());
    expect(body).toContain("MFG_RC03_RECOMPUTATION_MISMATCH");
    expect(body).not.toContain("hunter2");
    expect(body).not.toContain("db.internal");
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ correlationId: "corr-2", operation: "release", code: "MFG_RC03_RECOMPUTATION_MISMATCH" });
    expect(JSON.stringify(traces[0])).not.toContain("hunter2");
  });

  it("classifies transport conflicts and unreachable durable stores; everything else is the generic phase failure", async () => {
    setManufacturingTraceSinkForTests(() => undefined);
    const conflict = boundedManufacturingFailure(new Error("PS_DURABLE_PUBLICATION_REVISION_CONFLICT"), "qualify", "c");
    expect(conflict.status).toBe(409);
    expect((await conflict.json() as { code: string }).code).toBe("MFG_BOARD_REVISION_CONFLICT");
    const dw = boundedManufacturingFailure(new Error("DW_OPTIMISTIC_REVISION_CONFLICT"), "qualify", "c");
    expect((await dw.json() as { code: string }).code).toBe("MFG_BOARD_REVISION_CONFLICT");
    const down = boundedManufacturingFailure(new Error(`connect ECONNREFUSED ${SECRET}`), "qualify", "c");
    expect(down.status).toBe(503);
    expect((await down.json() as { code: string }).code).toBe("MFG_DURABLE_STORE_UNAVAILABLE");
    const unknownQualify = boundedManufacturingFailure(new Error(`BOOM ${SECRET}`), "qualify", "c");
    expect(unknownQualify.status).toBe(500);
    const unknownBody = JSON.stringify(await unknownQualify.json());
    expect(unknownBody).toContain("MFG_QUALIFY_FAILED");
    expect(unknownBody).not.toContain("BOOM");
    expect(unknownBody).not.toContain("hunter2");
    const unknownRelease = boundedManufacturingFailure("string failure", "release", "c");
    expect((await unknownRelease.json() as { code: string }).code).toBe("MFG_RELEASE_FAILED");
  });
});
