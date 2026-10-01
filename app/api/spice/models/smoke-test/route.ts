import { diagnoseNgspiceLog } from "@/app/lib/spice/diagnostics";
import { createId, nowIso } from "@/app/lib/spice/identity";
import { assertModelSafeForExecution } from "@/app/lib/spice/models";
import { assertCompiledDeckSafe, assertDeckText, emittedModelText } from "@/app/lib/spice/netlist";
import type { ModelAsset } from "@/app/lib/spice/types";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { boundDiagnosticText } from "@/app/lib/computation/output-bounds"; // [B22-A1] D22-4: the returned ngspice output is bounded
import { diagnosticProvenance, runDiagnosticNgspice, seedDiagnosticDeck } from "@/app/lib/computation/diagnostic-runner"; // [B22-A3] OD-136: the only ngspice spawner
export const runtime = "nodejs";

/** [B16.0.2 §A/§D] a single model asset travels in the body. */
const MAX_BODY_BYTES = 2_000_000;
const BODY_DEADLINE_MS = 15_000;
/** [B22-A3] The smoke run's wall clock (10 s, as before), within the diagnostic runner's profile bound. */
const SMOKE_TIMEOUT_MS = 10_000;

function fixture(model: ModelAsset): string {
  const content = emittedModelText(model); // [B22-A1] D22-4: the run deck's model text, the text the model screen reads
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

// [B16.0.2 §A] ngspice is an external process: authenticated membership +
// engineering role + CSRF BEFORE the body is read or any process spawns.
// [B16.0.23] canonical wrapper — that ordering now lives in
// `authenticatedJsonRoute` (2 MB / 15 s bounded read); every refusal returns
// before `spawn`. The executable, args, cwd, timeout, and output ceilings
// stay server-owned; a smoke-test PASS is evidence only ("smoke-tested"),
// never model approval or certification. [B22-A3] The process belongs to the
// diagnostic runner (OD-136); this route starts none. [B22-A3 review]
// security-2: the request's abort reaches the runner only through the declared
// `exposeAbortSignal` input (a client that leaves withdraws its queued run or
// stops its process).
export const POST = authenticatedJsonRoute<{ model?: ModelAsset }>(
  { maxBytes: MAX_BODY_BYTES, deadlineMs: BODY_DEADLINE_MS, exposeAbortSignal: true },
  async ({ context, body, signal }) => {
  if (!body.model || typeof body.model !== "object") return Response.json({ ok: false, error: "model is required" }, { status: 400 });
  const model = structuredClone(body.model);
  try {
    assertModelSafeForExecution(model);
    const deck = screenedSmokeDeck(model); // [SEC-1] before any file or process
    // [B22-A3] OD-136: the diagnostic runner writes the deck into its own per-run directory (removed on every path) and runs the
    // pinned ngspice with the profile's argv and exact environment; a refusal (an unpinned install, the runner's cap or an expired
    // wait, a run directory that could not be prepared) is a closed 422. [B22-A3 review] security-2, regressions-1: the request
    // shares the cap as its tenant, waits for a slot at most its 10 s wall clock (the runner's default) and is withdrawn on abort.
    const run = await runDiagnosticNgspice({ operation: "run", deck, readRaw: false, wallClockMs: SMOKE_TIMEOUT_MS, signal, holder: context.tenantId, interactive: true });
    if (run.outcome === "spawn_failed") throw new Error("ngspice could not be started from the pinned install");
    const result = { code: run.exitCode, stdout: run.stdout, stderr: run.stderr, timedOut: run.outcome !== "exited" };
    const log = `${result.stderr}\n${result.stdout}`;
    const passed = result.code === 0 && !result.timedOut && !/error|fatal|unknown subckt|singular matrix/i.test(log);
    // [B22-A3 review] coverage-1: a stopped run says why - the wall clock, a cancel, or a kill whose exit was not observed
    const stopped = run.outcome === "cancelled" ? "Smoke test cancelled." : run.outcome === "kill_unconfirmed" ? "Smoke test stopped (kill_unconfirmed): the ngspice process exit was not observed within the bounded wait." : "Smoke test timed out.";
    const check = {
      id: createId("modelcheck"),
      kind: "smoke" as const,
      status: passed ? "pass" as const : "fail" as const,
      message: passed ? "Minimal isolated ngspice fixture completed." : result.timedOut ? stopped : `Smoke test exited with code ${String(result.code)}.`,
      checkedAt: nowIso(),
    };
    model.validationChecks = [...model.validationChecks.filter((candidate) => candidate.kind !== "smoke"), check];
    if (passed && ["unverified", "syntax-checked"].includes(model.validationStatus)) model.validationStatus = "smoke-tested";
    model.updatedAt = nowIso();
    return Response.json({ ok: passed, model, check, stdout: boundDiagnosticText(result.stdout), stderr: boundDiagnosticText(result.stderr), diagnostics: passed ? [] : diagnoseNgspiceLog(log), runner: diagnosticProvenance(run) }, { status: passed ? 200 : 422 }); // [B22-A1] D22-4: bounded, the tail kept, the marker first; [B22-A3] the runner's labels and provenance
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
  });

/**
 * [SEC-1] The smoke deck carries the caller's subcircuit name and model text: the name is one line (the shared screen) and
 * the whole deck passes the final deck screen with no control block at all. A Windows model file's CRLF is written as LF
 * (ngspice reads both as one break), so it still passes and [SEC-1 review] the deck written is the deck screened, byte for
 * byte; a lone CR is still refused.
 */
function screenedSmokeDeck(model: ModelAsset): string {
  if (model.subcircuitName !== undefined) assertDeckText(model.subcircuitName, "the subcircuit name");
  return assertCompiledDeckSafe(seedDiagnosticDeck(fixture(model).replace(/\r\n/g, "\n")), { controlBlock: false, executed: true }); // [B22-A3] the profile's seed option, screened with the deck
}
