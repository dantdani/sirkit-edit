import { mkdir, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { join } from "node:path";
import { createNumberEqualityCandidate } from "../app/lib/mapping-verification/adapters";
import { DEFAULT_MAPPING_POLICY } from "../app/lib/mapping-verification/policy";
import { DeterministicMappingVerifier } from "../app/lib/mapping-verification/verifier";
import { contextFixture, exactCandidate, request } from "../app/lib/mapping-verification/__tests__/fixtures";

function stats(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const percentile = (ratio: number) => ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)] ?? 0;
  return { samples: values.length, meanMs: Number((values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)).toFixed(3)), p50Ms: Number(percentile(0.5).toFixed(3)), p95Ms: Number(percentile(0.95).toFixed(3)), maxMs: Number((ordered.at(-1) ?? 0).toFixed(3)) };
}

async function main(): Promise<void> {
  const verifier = new DeterministicMappingVerifier();
  const exactContext = contextFixture(), exact = exactCandidate(exactContext, { equivalence: true });
  const exactResult = verifier.verify(request(exactContext, exact), exactContext, exact, structuredClone(DEFAULT_MAPPING_POLICY));
  const connectorContext = contextFixture({ risk: "simple_connector" }), connector = createNumberEqualityCandidate(connectorContext);
  const connectorResult = verifier.verify(request(connectorContext, connector), connectorContext, connector, structuredClone(DEFAULT_MAPPING_POLICY));
  const polarizedContext = contextFixture({ functions: ["positive", "negative"], risk: "polarized_two_terminal" }), polarized = exactCandidate(polarizedContext, { pinToTerminal: [[0, 1], [1, 0]] });
  const polarizedResult = verifier.verify(request(polarizedContext, polarized), polarizedContext, polarized, structuredClone(DEFAULT_MAPPING_POLICY));
  const qfnContext = contextFixture({ numbers: ["1", "2", "EP"], functions: ["input", "ground", "thermal"], thermalPads: ["EP"], risk: "thermal_exposed_pad" }), qfn = exactCandidate(qfnContext, { pinToTerminal: [[0, 0], [1, 1]], terminalToPad: [[0, 0], [1, 1]] });
  const qfnResult = verifier.verify(request(qfnContext, qfn), qfnContext, qfn, structuredClone(DEFAULT_MAPPING_POLICY));

  const smallMs: number[] = [];
  for (let index = 0; index < 100; index++) {
    const started = performance.now();
    verifier.verify(request(exactContext, exact, { requestId: `evidence-small-${index}` }), exactContext, exact, structuredClone(DEFAULT_MAPPING_POLICY));
    smallMs.push(performance.now() - started);
  }
  const numbers = Array.from({ length: 512 }, (_, index) => String(index + 1));
  const largeContext = contextFixture({ numbers, functions: numbers.map(() => "bidirectional"), risk: "complex_ic" }), large = exactCandidate(largeContext);
  const largeStarted = performance.now(), largeResult = verifier.verify(request(largeContext, large, { requestId: "evidence-large" }), largeContext, large, structuredClone(DEFAULT_MAPPING_POLICY)), largeMs = performance.now() - largeStarted;
  if (exactResult.status !== "verified" || connectorResult.status !== "ambiguous" || polarizedResult.status !== "electrically_inconsistent" || qfnResult.status !== "incomplete" || largeResult.status !== "verified") throw new Error("MV_EVIDENCE_REPRESENTATIVE_ASSERTION_FAILED");

  const evidence = {
    schemaVersion: "sirkit.mapping-stage4-qualification-evidence.v1",
    generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: platform(), release: release(), arch: arch() },
    versions: { verifier: exactResult.verifierVersion, policy: exactResult.policyVersion, result: exactResult.resultSchemaVersion, parserVersions: exactResult.parserVersions },
    budgets: { singleSmallP95Ms: 100, exact512Ms: 5_000, maxPins: DEFAULT_MAPPING_POLICY.maxPins, maxTerminals: DEFAULT_MAPPING_POLICY.maxTerminals, maxPads: DEFAULT_MAPPING_POLICY.maxPads, maxEdges: DEFAULT_MAPPING_POLICY.maxEdges, maxBatchSize: DEFAULT_MAPPING_POLICY.maxBatchSize, timeoutMs: DEFAULT_MAPPING_POLICY.timeoutMs },
    measurements: { exactTwoTerminal100: stats(smallMs), exact512: { elapsedMs: Number(largeMs.toFixed(3)), pins: largeResult.symbolCoverage.required, terminals: largeResult.packageTerminalCoverage.required, pads: largeResult.footprintPadCoverage.required, findings: largeResult.findings.length } },
    representative: {
      exactPassive: { status: exactResult.status, tier: exactResult.tier, resultDigest: exactResult.resultDigest, claims: exactResult.claims },
      numericConnector: { status: connectorResult.status, tier: connectorResult.tier ?? null, findings: connectorResult.findings.map((item) => item.code), ambiguities: connectorResult.ambiguities.map((item) => item.code) },
      reversedPolarized: { status: polarizedResult.status, findings: polarizedResult.findings.map((item) => item.code) },
      omittedExposedPad: { status: qfnResult.status, findings: qfnResult.findings.map((item) => item.code) },
    },
    assertions: { pureVerificationDoesNotApprove: !exactResult.claims.approvesMapping, schematicUnchanged: !exactResult.claims.mutatesSchematic, pcbUnchanged: !exactResult.claims.mutatesPcb, exact512Complete: largeResult.symbolCoverage.missing === 0 && largeResult.packageTerminalCoverage.missing === 0 && largeResult.footprintPadCoverage.missing === 0 },
  };
  const directory = join(process.cwd(), "artifacts", "footprint-binding-stage-04");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "qualification-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
