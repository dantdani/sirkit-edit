// kicad-cli runner (Stage 14): mocked child_process.spawn — success, missing
// binary (ENOENT → cli-missing), nonzero exit with stderr, and timeout kill.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();
vi.mock("child_process", () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

import { runKicadCli } from "../fab/kicad-cli-runner";

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

beforeEach(() => {
  spawnMock.mockReset();
});

describe("runKicadCli", () => {
  it("(a) successful run → ok with captured stdio", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const promise = runKicadCli({ cliPath: "kicad-cli", args: ["pcb", "export", "gerbers"] });
    child.stdout.emit("data", Buffer.from("Plotted 7 layers\n"));
    child.emit("close", 0);
    const result = await promise;
    expect(result).toMatchObject({ ok: true, stdout: "Plotted 7 layers\n" });
    expect(spawnMock).toHaveBeenCalledWith("kicad-cli", ["pcb", "export", "gerbers"], expect.any(Object));
  });

  it("(b) missing binary (spawn ENOENT) → cli-missing, no throw", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const promise = runKicadCli({ cliPath: "kicad-cli", args: ["pcb"] });
    const err = Object.assign(new Error("spawn kicad-cli ENOENT"), { code: "ENOENT" });
    child.emit("error", err);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("cli-missing");
      expect(result.stderr).toContain("ENOENT");
    }
  });

  it("(c) exit code 1 → exit-nonzero with stderr preserved", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const promise = runKicadCli({ cliPath: "kicad-cli", args: ["pcb"] });
    child.stderr.emit("data", Buffer.from("Error: no such layer F.Bogus"));
    child.emit("close", 1);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("exit-nonzero");
      expect(result.stderr).toContain("F.Bogus");
    }
  });

  it("(d) timeout kills the process and reports 'timeout'", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const promise = runKicadCli({ cliPath: "kicad-cli", args: ["pcb"], timeoutMs: 30 });
    // never emit close — the kill timer must settle the promise
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("timeout");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("late close after timeout does not flip the result", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const promise = runKicadCli({ cliPath: "kicad-cli", args: ["pcb"], timeoutMs: 30 });
    const result = await promise;
    child.emit("close", 0); // straggler event
    expect(result.ok).toBe(false);
  });
});
