/**
 * Sirkit SPICE Studio batch/CI entry point.
 *
 * Usage:
 *   pnpm spice:ci simulation-project.json [--plan run-plan-id] [--out results.json]
 *
 * Exit 0: every run completed and no specification failed.
 * Exit 1: invalid configuration, failed/cancelled run, or failed specification.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertProjectShape } from "@/app/lib/spice/project";
import { getBatch, getRuns, startRunPlan } from "@/app/lib/spice/server/job-store";
import type { RunRecord, SimulationProject } from "@/app/lib/spice/types";

interface CiResult {
  schemaVersion: 1;
  generatedAt: string;
  projectId: string;
  projectRevision: number;
  runPlanId: string;
  batchId: string;
  status: "pass" | "fail";
  runs: Array<{
    id: string;
    label: string;
    status: RunRecord["status"];
    manifestId?: string;
    durationMs?: number;
    specifications: Array<{ id?: string; name: string; value?: number; unit?: string; status: string }>;
    diagnostics: Array<{ code: string; title: string; summary: string }>;
    error?: string;
  }>;
}

interface CliArguments {
  projectPath?: string;
  runPlanId?: string;
  outputPath?: string;
  help: boolean;
}

export function parseCliArguments(args: string[]): CliArguments {
  const positional: string[] = [];
  let runPlanId: string | undefined;
  let outputPath: string | undefined;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      help = true;
    } else if (argument === "--plan") {
      runPlanId = args[++index];
      if (!runPlanId) throw new Error("--plan requires a run plan ID");
    } else if (argument === "--out") {
      outputPath = args[++index];
      if (!outputPath) throw new Error("--out requires a file path");
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }
  if (positional.length > 3) throw new Error("Too many positional arguments");
  return {
    projectPath: positional[0],
    runPlanId: runPlanId ?? positional[1],
    outputPath: outputPath ?? positional[2],
    help,
  };
}

const USAGE = "Usage: pnpm spice:ci simulation-project.json [--plan run-plan-id] [--out results.json]";

async function main(): Promise<void> {
  const cli = parseCliArguments(process.argv.slice(2));
  if (cli.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (!cli.projectPath) throw new Error(USAGE);
  const projectPath = resolve(cli.projectPath);
  const parsed = JSON.parse(await readFile(projectPath, "utf8")) as unknown;
  assertProjectShape(parsed);
  const project: SimulationProject = parsed;
  const runPlanId = cli.runPlanId || project.runPlans[0]?.id;
  if (!runPlanId) throw new Error("The project contains no run plan");
  // [B16.0.2 B] the job store binds every run to a trusted scope; this CLI
  // runs out-of-process against its own in-memory store under a fixed scope.
  const CI_SCOPE = { tenantId: "local", projectId: `spice-ci:${project.id}`, branchId: "main" };
  const batch = startRunPlan({ scope: CI_SCOPE, project, runPlanId, maxRuns: 1000 });
  const deadline = Date.now() + 24 * 60 * 60 * 1000;
  let current = getBatch(batch.id, CI_SCOPE);
  while (current && !["completed", "failed", "cancelled"].includes(current.status) && Date.now() < deadline) {
    process.stderr.write(`\rSirkit SPICE: ${current.completed + current.failed + current.cancelled}/${current.total} finished`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    current = getBatch(batch.id, CI_SCOPE);
  }
  process.stderr.write("\n");
  const runs = getRuns(CI_SCOPE, batch.runIds);
  const failed = runs.some((run) => run.status !== "completed" || run.scalars.some((scalar) => scalar.status === "fail" || scalar.status === "error"));
  const result: CiResult = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectId: project.id,
    projectRevision: project.revision,
    runPlanId,
    batchId: batch.id,
    status: failed ? "fail" : "pass",
    runs: runs.map((run) => ({
      id: run.id,
      label: run.label,
      status: run.status,
      manifestId: run.manifest?.id,
      durationMs: run.startedAt && run.finishedAt ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime() : undefined,
      specifications: run.scalars.filter((scalar) => scalar.specificationId).map((scalar) => ({ id: scalar.specificationId, name: scalar.name, value: scalar.value, unit: scalar.unit, status: scalar.status })),
      diagnostics: run.diagnostics.map((diagnostic) => ({ code: diagnostic.code, title: diagnostic.title, summary: diagnostic.summary })),
      error: run.error,
    })),
  };
  const json = JSON.stringify(result, null, 2);
  if (cli.outputPath) await writeFile(resolve(cli.outputPath), json, "utf8");
  else process.stdout.write(`${json}\n`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  process.stderr.write(`Sirkit SPICE CI failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
