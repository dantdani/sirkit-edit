import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnoseNgspiceLog } from "@/app/lib/spice/diagnostics";
import { createId, nowIso } from "@/app/lib/spice/identity";
import { assertModelSafeForExecution } from "@/app/lib/spice/models";
import { NGSPICE_EXECUTABLE } from "@/app/lib/spice/server/worker";
import type { ModelAsset } from "@/app/lib/spice/types";

export const runtime = "nodejs";

function fixture(model: ModelAsset): string {
  const content = model.transformedContent ?? model.originalContent;
  if (model.modelType === "subckt") {
    if (!model.subcircuitName || model.externalPins.length === 0) throw new Error("Subcircuit smoke test requires a name and external pins");
    const nodes = model.externalPins.sort((a, b) => a.position - b.position).map((_, index) => `n${index + 1}`);
    return [
      "Sirkit model smoke test",
      content,
      `VBIAS ${nodes[0]} 0 1`,
      ...nodes.slice(1).map((node, index) => `RBIAS${index + 1} ${node} 0 1Meg`),
      `XUUT ${nodes.join(" ")} ${model.subcircuitName}`,
      ".op",
      ".end",
    ].join("\n");
  }
  const declaration = content.match(/^\s*\.model\s+(\S+)\s+(\S+)/im);
  if (!declaration) throw new Error("Primitive model smoke test requires a .model declaration");
  const [, name, typeRaw] = declaration;
  const type = typeRaw.toLowerCase();
  const device = type === "d"
    ? `DUUT out 0 ${name}`
    : type === "npn" || type === "pnp"
      ? `QUUT out bias 0 ${name}`
      : type.includes("mos") || type === "vdmos"
        ? `MUUT out bias 0 0 ${name}`
        : `DUUT out 0 ${name}`;
  return [
    "Sirkit model smoke test",
    content,
    "VBIAS bias 0 1",
    "VSUPPLY supply 0 5",
    "RLOAD supply out 10k",
    device,
    ".op",
    ".end",
  ].join("\n");
}

async function execute(path: string, cwd: string): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(NGSPICE_EXECUTABLE, ["-b", path], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout?.on("data", (data: Buffer) => { stdout = (stdout + data.toString()).slice(-100_000); });
    child.stderr?.on("data", (data: Buffer) => { stderr = (stderr + data.toString()).slice(-100_000); });
    child.on("error", reject);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 10_000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}

export async function POST(req: Request): Promise<Response> {
  let body: { model?: ModelAsset };
  try { body = await req.json() as typeof body; } catch { return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }
  if (!body.model) return Response.json({ ok: false, error: "model is required" }, { status: 400 });
  const model = structuredClone(body.model);
  let directory: string | null = null;
  try {
    assertModelSafeForExecution(model);
    const deck = fixture(model);
    directory = await mkdtemp(join(tmpdir(), "sirkit-model-smoke-"));
    const path = join(directory, "smoke.cir");
    await writeFile(path, deck, "utf8");
    const result = await execute(path, directory);
    const log = `${result.stderr}\n${result.stdout}`;
    const passed = result.code === 0 && !result.timedOut && !/error|fatal|unknown subckt|singular matrix/i.test(log);
    const check = {
      id: createId("modelcheck"),
      kind: "smoke" as const,
      status: passed ? "pass" as const : "fail" as const,
      message: passed ? "Minimal isolated ngspice fixture completed." : result.timedOut ? "Smoke test timed out." : `Smoke test exited with code ${String(result.code)}.`,
      checkedAt: nowIso(),
    };
    model.validationChecks = [...model.validationChecks.filter((candidate) => candidate.kind !== "smoke"), check];
    if (passed && ["unverified", "syntax-checked"].includes(model.validationStatus)) model.validationStatus = "smoke-tested";
    model.updatedAt = nowIso();
    return Response.json({ ok: passed, model, check, stdout: result.stdout, stderr: result.stderr, diagnostics: passed ? [] : diagnoseNgspiceLog(log) }, { status: passed ? 200 : 422 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
