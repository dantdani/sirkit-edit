import { feasibilityClass } from "./metrics";
import { quantile } from "./statistics";
import type { BenchmarkPackage, BenchmarkResult, BenchmarkRun, BenchmarkRunStatus, MetricValue } from "./types";

export interface BenchmarkBundleView { run: BenchmarkRun; result: BenchmarkResult; package?: BenchmarkPackage }

export interface BenchmarkSummary {
  runs: number;
  statusDenominators: Record<BenchmarkRunStatus, number>;
  feasibility: Record<string, number>;
  packageRows: Array<{ packageId: string; partition: string; tier?: string; status: BenchmarkRunStatus; feasibility: string; failureSignature?: string; metricCount: number; artifactCount: number; resultDigest: string }>;
  metricSummaries: Array<{ metricId: string; unit: string; measured: number; missing: number; unsupported: number; median?: number; p05?: number; p95?: number }>;
  failureClusters: Array<{ signature: string; count: number; packageIds: string[]; statuses: BenchmarkRunStatus[] }>;
}

export function summarizeBenchmarkRuns(bundles: readonly BenchmarkBundleView[]): BenchmarkSummary {
  const statuses = {} as Record<BenchmarkRunStatus, number>; const feasibility: Record<string, number> = {};
  const metricIds = [...new Set(bundles.flatMap((bundle) => bundle.result.metricValues.map((metric) => metric.metricId)))].sort();
  const packageRows = bundles.map((bundle) => {
    statuses[bundle.run.status] = (statuses[bundle.run.status] ?? 0) + 1;
    const feasible = feasibilityClass(bundle.result); feasibility[feasible] = (feasibility[feasible] ?? 0) + 1;
    return { packageId: bundle.run.packageId, partition: bundle.run.partition, tier: bundle.package?.tier, status: bundle.run.status, feasibility: feasible, failureSignature: bundle.result.failureSignature, metricCount: bundle.result.metricValues.length, artifactCount: bundle.run.artifactRefs.length, resultDigest: bundle.result.resultDigest };
  }).sort((a, b) => a.packageId.localeCompare(b.packageId));
  const metricSummaries = metricIds.map((metricId) => {
    const values = bundles.map((bundle) => bundle.result.metricValues.find((metric) => metric.metricId === metricId)).filter((metric): metric is MetricValue => metric !== undefined);
    const numbers = values.filter((metric) => metric.state === "measured" && typeof metric.value === "number").map((metric) => metric.value as number);
    return { metricId, unit: values[0]?.unit ?? "categorical", measured: values.filter((metric) => metric.state === "measured").length, missing: values.filter((metric) => metric.state === "missing" || metric.state === "censored").length, unsupported: values.filter((metric) => metric.state === "unsupported" || metric.state === "not_comparable").length, ...(numbers.length ? { median: quantile(numbers, 0.5)!, p05: quantile(numbers, 0.05)!, p95: quantile(numbers, 0.95)! } : {}) };
  });
  const clusters = new Map<string, { signature: string; count: number; packageIds: string[]; statuses: BenchmarkRunStatus[] }>();
  for (const bundle of bundles) if (bundle.result.failureSignature) {
    const cluster = clusters.get(bundle.result.failureSignature) ?? { signature: bundle.result.failureSignature, count: 0, packageIds: [], statuses: [] };
    cluster.count += 1; cluster.packageIds.push(bundle.run.packageId); cluster.statuses.push(bundle.run.status); clusters.set(cluster.signature, cluster);
  }
  return { runs: bundles.length, statusDenominators: statuses, feasibility, packageRows, metricSummaries, failureClusters: [...clusters.values()].map((cluster) => ({ ...cluster, packageIds: [...new Set(cluster.packageIds)].sort(), statuses: [...new Set(cluster.statuses)].sort() })).sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature)) };
}

export function resultQuery(summary: BenchmarkSummary, query: { status?: BenchmarkRunStatus; packageId?: string; metricId?: string }): unknown {
  if (query.metricId) return summary.metricSummaries.find((metric) => metric.metricId === query.metricId);
  return summary.packageRows.filter((row) => (!query.status || row.status === query.status) && (!query.packageId || row.packageId === query.packageId));
}

function escapeHtml(value: unknown): string { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }

export function renderBenchmarkReport(summary: BenchmarkSummary, metadata: { title: string; corpusVersion: number; codeRevision: string; generatedAt: string }): string {
  const statusRows = Object.entries(summary.statusDenominators).sort(([a], [b]) => a.localeCompare(b)).map(([status, count]) => `<tr><td>${escapeHtml(status)}</td><td>${count}</td></tr>`).join("");
  const packageRows = summary.packageRows.map((row) => `<tr><td>${escapeHtml(row.packageId)}</td><td>${escapeHtml(row.partition)}</td><td>${escapeHtml(row.tier ?? "unknown")}</td><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.feasibility)}</td><td>${row.metricCount}</td><td>${row.artifactCount}</td><td><code>${escapeHtml(row.resultDigest)}</code></td></tr>`).join("");
  const metricRows = summary.metricSummaries.map((metric) => `<tr><td>${escapeHtml(metric.metricId)}</td><td>${escapeHtml(metric.unit)}</td><td>${metric.measured}</td><td>${metric.missing}</td><td>${metric.unsupported}</td><td>${metric.median ?? "—"}</td><td>${metric.p05 ?? "—"}</td><td>${metric.p95 ?? "—"}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(metadata.title)}</title><style>body{font:14px system-ui;margin:2rem;background:#111;color:#eee}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #444;padding:.45rem;text-align:left}th{background:#222}code{font-size:11px}p{color:#bbb}</style></head><body><h1>${escapeHtml(metadata.title)}</h1><p>Corpus v${metadata.corpusVersion} · code ${escapeHtml(metadata.codeRevision)} · generated ${escapeHtml(metadata.generatedAt)} · ${summary.runs} retained runs. Failures, unsupported, blocked, unlicensed, and missing values remain in denominators.</p><h2>Status denominators</h2><table><thead><tr><th>Status</th><th>Count</th></tr></thead><tbody>${statusRows}</tbody></table><h2>Packages</h2><table><thead><tr><th>Package</th><th>Partition</th><th>Tier</th><th>Status</th><th>Feasibility</th><th>Metrics</th><th>Artifacts</th><th>Result digest</th></tr></thead><tbody>${packageRows}</tbody></table><h2>Metrics</h2><p>Numeric columns show retained sample counts and unweighted package-level quantiles. Units are never normalized away.</p><table><thead><tr><th>Metric</th><th>Unit</th><th>Measured n</th><th>Missing n</th><th>Unsupported n</th><th>Median</th><th>P05</th><th>P95</th></tr></thead><tbody>${metricRows}</tbody></table></body></html>`;
}
