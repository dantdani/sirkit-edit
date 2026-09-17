import { createId, nowIso } from "./identity";
import type { RunRecord, SimulationProject, SpiceReport, SpecificationState } from "./types";

export function buildSpiceReport(project: SimulationProject, runs: RunRecord[], title = `${project.name} verification report`): SpiceReport {
  const activeDesign = project.designRevisions.find((revision) => revision.id === project.activeDesignRevisionId);
  const runIds = new Set(runs.map((run) => run.id));
  const specs = project.tests.flatMap((test) => test.specifications.map((specification) => ({ test, specification })));
  return {
    id: createId("report"),
    title,
    generatedAt: nowIso(),
    projectId: project.id,
    projectRevision: project.revision,
    designRevisionId: activeDesign?.id ?? project.activeDesignRevisionId,
    runIds: [...runIds],
    modelInventory: project.modelAssets.map((model) => ({
      id: model.id,
      name: model.name,
      version: model.version,
      checksum: model.checksum,
      status: model.validationStatus,
      provenance: model.provenance,
    })),
    testSummary: project.tests.map((test) => ({
      testId: test.id,
      name: test.name,
      analyses: test.analyses.filter((analysis) => analysis.enabled).map((analysis) => analysis.type),
      runCount: runs.filter((run) => run.testId === test.id).length,
    })),
    specificationMatrix: specs.map(({ specification }) => ({
      specification: specification.name,
      unit: specification.unit,
      cells: runs.map((run) => {
        const scalar = run.scalars.find((candidate) => candidate.specificationId === specification.id);
        return { runId: run.id, status: scalar?.status ?? "not-evaluated", value: scalar?.value };
      }),
    })),
    warnings: [
      ...project.modelAssets.filter((model) => model.validationStatus === "unverified" || model.provenance === "ai-approximation").map((model) => `${model.name}: ${model.validationStatus}, provenance ${model.provenance}`),
      ...runs.flatMap((run) => run.diagnostics.filter((diagnostic) => diagnostic.severity !== "info").map((diagnostic) => `${run.label}: ${diagnostic.title}`)),
    ],
    reproducibility: {
      simulatorVersions: [...new Set(runs.map((run) => run.manifest?.simulator.version).filter((value): value is string => Boolean(value)))],
      seeds: [...new Set(runs.map((run) => run.manifest?.randomSeed).filter((value): value is number => value !== undefined))],
      manifestIds: runs.map((run) => run.manifest?.id).filter((value): value is string => Boolean(value)),
    },
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function statusClass(status: SpecificationState): string {
  return status.replace(/[^a-z-]/g, "");
}

export function reportToHtml(report: SpiceReport): string {
  const matrixHeader = report.runIds.map((runId) => `<th>${escapeHtml(runId.slice(0, 12))}</th>`).join("");
  const matrixRows = report.specificationMatrix.map((row) => `
    <tr><th>${escapeHtml(row.specification)} <small>${escapeHtml(row.unit)}</small></th>${row.cells.map((cell) => `<td class="${statusClass(cell.status)}"><strong>${escapeHtml(cell.status.toUpperCase())}</strong>${cell.value === undefined ? "" : `<br>${escapeHtml(Number(cell.value.toPrecision(7)))}`}</td>`).join("")}</tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(report.title)}</title>
<style>
body{font:14px/1.45 Inter,system-ui,sans-serif;color:#172033;background:#f5f7fb;margin:0;padding:32px}main{max-width:1200px;margin:auto;background:white;padding:32px;border:1px solid #dce2ec;border-radius:12px}h1{margin:0 0 8px}h2{margin-top:32px;border-bottom:1px solid #e5eaf1;padding-bottom:8px}.meta{color:#5f6b7c}table{border-collapse:collapse;width:100%;overflow:auto}th,td{border:1px solid #dce2ec;padding:8px;text-align:left;vertical-align:top}thead th{background:#f0f3f8}.pass{background:#e9f8ef;color:#146c3b}.fail,.error{background:#fff0f0;color:#9f1d1d}.warning{background:#fff8df;color:#7a5400}.not-evaluated{background:#f2f4f7;color:#667085}code{font-family:ui-monospace,monospace}.warning-list{border-left:4px solid #e0a800;padding-left:16px}small{font-weight:normal;color:#667085}@media print{body{background:white;padding:0}main{border:0}}</style></head>
<body><main><h1>${escapeHtml(report.title)}</h1><p class="meta">Generated ${escapeHtml(report.generatedAt)} · Project ${escapeHtml(report.projectId)} r${escapeHtml(report.projectRevision)} · Design ${escapeHtml(report.designRevisionId)}</p>
<h2>Qualification summary</h2><table><thead><tr><th>Specification</th>${matrixHeader}</tr></thead><tbody>${matrixRows || "<tr><td colspan=2>No specifications were evaluated.</td></tr>"}</tbody></table>
<h2>Tests</h2><table><thead><tr><th>Test</th><th>Analyses</th><th>Runs</th></tr></thead><tbody>${report.testSummary.map((test) => `<tr><td>${escapeHtml(test.name)}</td><td>${escapeHtml(test.analyses.join(", "))}</td><td>${test.runCount}</td></tr>`).join("")}</tbody></table>
<h2>Model inventory</h2><table><thead><tr><th>Model</th><th>Version</th><th>Status</th><th>Provenance</th><th>Checksum</th></tr></thead><tbody>${report.modelInventory.map((model) => `<tr><td>${escapeHtml(model.name)}</td><td>${escapeHtml(model.version)}</td><td>${escapeHtml(model.status)}</td><td>${escapeHtml(model.provenance)}</td><td><code>${escapeHtml(model.checksum)}</code></td></tr>`).join("")}</tbody></table>
<h2>Warnings and disclosure</h2><div class="warning-list">${report.warnings.length ? `<ul>${report.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : "<p>No report-level warnings.</p>"}</div>
<h2>Reproducibility</h2><p>Simulator versions: ${escapeHtml(report.reproducibility.simulatorVersions.join(", ") || "not recorded")}</p><p>Seeds: ${escapeHtml(report.reproducibility.seeds.join(", ") || "none")}</p><p>Manifest IDs: <code>${escapeHtml(report.reproducibility.manifestIds.join(", ") || "none")}</code></p>
</main></body></html>`;
}

export function reportToJson(report: SpiceReport): string {
  return JSON.stringify(report, null, 2);
}

export interface RunComparison {
  runA: string;
  runB: string;
  status: "improved" | "regressed" | "unchanged" | "incomparable";
  scalarChanges: Array<{ name: string; before?: number; after?: number; delta?: number; percent?: number; statusBefore: SpecificationState; statusAfter: SpecificationState }>;
  modelChanges: string[];
  analysisChanged: boolean;
}

export function compareRunRecords(a: RunRecord, b: RunRecord): RunComparison {
  const names = new Set([...a.scalars.map((scalar) => scalar.name), ...b.scalars.map((scalar) => scalar.name)]);
  const scalarChanges = [...names].map((name) => {
    const before = a.scalars.find((scalar) => scalar.name === name);
    const after = b.scalars.find((scalar) => scalar.name === name);
    const delta = before?.value !== undefined && after?.value !== undefined ? after.value - before.value : undefined;
    return {
      name,
      before: before?.value,
      after: after?.value,
      delta,
      percent: delta !== undefined && before?.value ? delta / Math.abs(before.value) * 100 : undefined,
      statusBefore: before?.status ?? "not-evaluated" as SpecificationState,
      statusAfter: after?.status ?? "not-evaluated" as SpecificationState,
    };
  });
  const failures = (run: RunRecord) => run.scalars.filter((scalar) => scalar.status === "fail" || scalar.status === "error").length;
  const beforeFailures = failures(a);
  const afterFailures = failures(b);
  const modelA = a.manifest?.modelChecksums ?? {};
  const modelB = b.manifest?.modelChecksums ?? {};
  const modelChanges = [...new Set([...Object.keys(modelA), ...Object.keys(modelB)])].filter((key) => modelA[key] !== modelB[key]);
  return {
    runA: a.id,
    runB: b.id,
    status: beforeFailures > afterFailures ? "improved" : beforeFailures < afterFailures ? "regressed" : scalarChanges.some((change) => change.delta !== 0) ? "unchanged" : "unchanged",
    scalarChanges,
    modelChanges,
    analysisChanged: JSON.stringify(a.manifest?.analysis) !== JSON.stringify(b.manifest?.analysis),
  };
}
