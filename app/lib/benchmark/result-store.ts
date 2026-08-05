import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { benchmarkDigest, canonicalBenchmarkJson } from "./stable";
import { resolveInside } from "./security";
import type { BenchmarkResult, BenchmarkRun } from "./types";

export interface StoredRunBundle { run: BenchmarkRun; result: BenchmarkResult; runDirectory: string }

export class ImmutableBenchmarkStore {
  constructor(readonly root: string) {}

  runDirectory(runId: string): string {
    if (!/^[A-Za-z0-9:._-]+$/.test(runId)) throw new Error("RUN_ID_PATH_INVALID");
    return resolveInside(this.root, path.join("runs", runId.replaceAll(":", "_")));
  }

  async initializeRun(runId: string): Promise<string> {
    const directory = this.runDirectory(runId);
    try { await stat(directory); throw new Error(`IMMUTABLE_RUN_EXISTS:${runId}`); } catch (error) {
      if (error instanceof Error && error.message.startsWith("IMMUTABLE_RUN_EXISTS")) throw error;
    }
    await mkdir(path.join(directory, "artifacts"), { recursive: true });
    return directory;
  }

  async writeArtifact(runId: string, relativePath: string, content: string | Uint8Array): Promise<{ digest: string; bytes: number; absolutePath: string }> {
    const directory = this.runDirectory(runId);
    const absolutePath = resolveInside(path.join(directory, "artifacts"), relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    await writeFile(absolutePath, bytes, { flag: "wx" });
    return { digest: benchmarkDigest({ bytes: bytes.toString("base64") }), bytes: bytes.byteLength, absolutePath };
  }

  async publish(run: BenchmarkRun, result: BenchmarkResult): Promise<StoredRunBundle> {
    const directory = this.runDirectory(run.runId);
    await writeFile(path.join(directory, "result.json"), `${canonicalBenchmarkJson(result)}\n`, { flag: "wx" });
    await writeFile(path.join(directory, "run.json"), `${canonicalBenchmarkJson(run)}\n`, { flag: "wx" });
    return { run: structuredClone(run), result: structuredClone(result), runDirectory: directory };
  }

  async read(runId: string): Promise<StoredRunBundle> {
    const directory = this.runDirectory(runId);
    const [run, result] = await Promise.all([readFile(path.join(directory, "run.json"), "utf8"), readFile(path.join(directory, "result.json"), "utf8")]);
    return { run: JSON.parse(run) as BenchmarkRun, result: JSON.parse(result) as BenchmarkResult, runDirectory: directory };
  }
}
