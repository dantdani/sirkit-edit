/**
 * KiCad footprint ingestion CLI (PCB Stage 2).
 * Run with: `pnpm tsx scripts/ingest-footprints.ts [--limit N] [--force] [--dry-run]`
 *
 * Pipeline:
 *   1. Ensure the kicad-footprints repo is cloned into data/kicad-footprints;
 *      record its HEAD SHA as `source_commit`.
 *   2. Walk every *.pretty/*.kicad_mod and parse with Stage 1's parseKicadMod.
 *   3. Skip rows whose stored source_commit already matches (unless --force).
 *   4. Embed pending rows (batches of 100, ≤4 concurrent, backoff on 429/5xx)
 *      and upsert. Embed failures leave `embedding` NULL — the row still lands.
 *   5. Repair pass: re-embed any `embedding IS NULL` rows; exit non-zero if
 *      more than 0.5% remain null.
 *   6. Write a machine-readable report to scripts/output/ingest-footprints-report.json.
 *
 * Design goals (mirrors scripts/ingest-kicad.ts): idempotent — re-running with
 * no upstream changes embeds nothing and writes nothing — and resilient — one
 * bad file is logged, counted, and skipped, never fatal.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

import { loadEnvLocal } from "../app/lib/load-env-local";

import { and, eq, isNull, sql, count } from "drizzle-orm";
import { getDb, getSqlClient } from "../app/lib/db/client";
import { pcbFootprints, type NewPcbFootprint } from "../app/lib/db/schema";
import { parseKicadMod } from "../app/lib/pcb/kicad-mod";
import type { FootprintDef } from "../app/lib/pcb/types";
import { embedBatch, MAX_EMBED_BATCH_SIZE } from "../app/lib/embeddings";

const execFileAsync = promisify(execFile);

// NOTE: github.com/KiCad/kicad-footprints is a mirror frozen in 2020 (~12k
// footprints) — KiCad moved library development to GitLab. This is the live
// upstream, same host the symbol ingestion (scripts/ingest-kicad.ts) uses.
const KICAD_FOOTPRINTS_REPO = "https://gitlab.com/kicad/libraries/kicad-footprints.git";
const DATA_DIR = join(process.cwd(), "data", "kicad-footprints");
const REPORT_PATH = join(process.cwd(), "scripts", "output", "ingest-footprints-report.json");
const SOURCE = "kicad-footprints";
const MAX_CONCURRENT_EMBED_REQUESTS = 4;
const UPSERT_CHUNK_SIZE = 50;
/** Abort with exit 1 if more than this fraction of rows still lack embeddings. */
const MAX_NULL_EMBEDDING_RATIO = 0.005;

// ─── CLI flags ───────────────────────────────────────────────────────────────

interface CliFlags {
  limit: number | null;
  force: boolean;
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { limit: null, force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") flags.force = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--limit expects a positive integer, got "${argv[i]}"`);
      }
      flags.limit = n;
    } else {
      throw new Error(`Unknown flag "${arg}" (expected --limit N, --force, --dry-run)`);
    }
  }
  return flags;
}

// ─── Report (written to scripts/output/, gitignored) ────────────────────────

const report = {
  scanned: 0,
  parsed: 0,
  failed: 0,
  fallbackPads: 0,
  inserted: 0,
  updated: 0,
  skipped: 0,
  embedded: 0,
  embeddingNulls: 0,
  commit: "",
};

// ─── Step 1: source checkout ────────────────────────────────────────────────

async function ensureFootprintsCloned(): Promise<string> {
  if (existsSync(join(DATA_DIR, ".git"))) {
    console.log("[ingest] kicad-footprints already cloned — pulling latest…");
    try {
      await execFileAsync("git", ["-C", DATA_DIR, "pull", "--ff-only"]);
    } catch (err) {
      console.warn("[ingest] git pull failed (continuing with local copy):", messageOf(err));
    }
  } else {
    console.log(`[ingest] cloning ${KICAD_FOOTPRINTS_REPO} → ${DATA_DIR} …`);
    await execFileAsync("git", ["clone", "--depth", "1", KICAD_FOOTPRINTS_REPO, DATA_DIR]);
  }
  const { stdout } = await execFileAsync("git", ["-C", DATA_DIR, "rev-parse", "HEAD"]);
  return stdout.trim();
}

// ─── Step 2: discovery + parse ──────────────────────────────────────────────

interface ModFile {
  libName: string;
  path: string;
}

/** Every *.pretty/*.kicad_mod under DATA_DIR, sorted for deterministic runs. */
async function discoverModFiles(): Promise<ModFile[]> {
  const out: ModFile[] = [];
  const entries = await readdir(DATA_DIR, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !entry.name.endsWith(".pretty")) continue;
    const libName = entry.name.replace(/\.pretty$/, "");
    const dir = join(DATA_DIR, entry.name);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".kicad_mod")).sort();
    for (const f of files) out.push({ libName, path: join(dir, f) });
  }
  return out;
}

/** One parsed footprint, ready to embed + upsert. */
interface PendingRow {
  libName: string;
  name: string;
  description: string | null;
  tags: string | null;
  attrSmd: boolean;
  attrTht: boolean;
  padCount: number;
  smdPadCount: number;
  thtPadCount: number;
  def: FootprintDef;
}

function toPending(def: FootprintDef): PendingRow {
  // Electrical pads only — NPTH pads have an empty number and never carry nets.
  const electrical = def.pads.filter((p) => p.number !== "");
  return {
    libName: def.libName,
    name: def.name,
    description: def.description ?? null,
    tags: def.tags ?? null,
    attrSmd: def.attributes.smd,
    attrTht: def.attributes.throughHole,
    padCount: electrical.length,
    smdPadCount: electrical.filter((p) => p.type === "smd").length,
    thtPadCount: electrical.filter((p) => p.type === "thru_hole").length,
    def,
  };
}

// ─── Step 3: embedding ──────────────────────────────────────────────────────

/**
 * The pinned embedding-input template — retrieval quality depends on every
 * ingest run (and the repair pass) producing byte-identical text per row.
 */
function buildEmbeddingInput(row: {
  libName: string;
  name: string;
  description: string | null;
  tags: string | null;
  attrSmd: boolean;
  attrTht: boolean;
  padCount: number;
  smdPadCount: number;
  thtPadCount: number;
}): string {
  const mount =
    row.attrSmd && row.attrTht
      ? "smd+tht"
      : row.attrSmd
        ? "smd"
        : row.attrTht
          ? "tht"
          : row.smdPadCount > 0 && row.thtPadCount > 0
            ? "smd+tht"
            : row.thtPadCount > 0
              ? "tht"
              : "smd";
  return (
    `${row.libName}:${row.name}. ${row.description ?? ""}. ` +
    `Tags: ${row.tags ?? ""}. ${row.padCount} pads, ${mount}.`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Embed one batch with exponential backoff on 429/5xx (1s → 2 → 4 → 8 → 16,
 * max 5 attempts). On final failure returns all-null so callers upsert the
 * rows anyway — the repair pass picks them up.
 */
async function embedBatchWithRetry(texts: string[]): Promise<(number[] | null)[]> {
  const delaysMs = [1000, 2000, 4000, 8000, 16000];
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await embedBatch(texts);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const retryable = status === undefined || status === 429 || status >= 500;
      if (!retryable || attempt === 5) {
        console.error(`[ingest] embed batch failed permanently: ${messageOf(err)}`);
        return texts.map(() => null);
      }
      const delay = delaysMs[attempt - 1];
      console.warn(
        `[ingest] embed batch failed (attempt ${attempt}/5, ${messageOf(err)}) — retrying in ${delay / 1000}s`,
      );
      await sleep(delay);
    }
  }
  return texts.map(() => null);
}

/** Run async tasks with a fixed concurrency cap; results keep input order. */
async function runPool<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

/** Embed all pending rows: batches of MAX_EMBED_BATCH_SIZE, ≤4 in flight. */
async function embedAll(rows: PendingRow[]): Promise<(number[] | null)[]> {
  const texts = rows.map(buildEmbeddingInput);
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += MAX_EMBED_BATCH_SIZE) {
    batches.push(texts.slice(i, i + MAX_EMBED_BATCH_SIZE));
  }
  let done = 0;
  const perBatch = await runPool(
    batches.map((batch) => async () => {
      const vectors = await embedBatchWithRetry(batch);
      done += batch.length;
      if (done % 2000 < batch.length) console.log(`[ingest] embedded ${done}/${texts.length}…`);
      return vectors;
    }),
    MAX_CONCURRENT_EMBED_REQUESTS,
  );
  return perBatch.flat();
}

// ─── Step 4: upsert ─────────────────────────────────────────────────────────

function toDbRow(row: PendingRow, embedding: number[] | null, commit: string): NewPcbFootprint {
  return {
    libName: row.libName,
    name: row.name,
    description: row.description,
    tags: row.tags,
    attrSmd: row.attrSmd,
    attrTht: row.attrTht,
    padCount: row.padCount,
    smdPadCount: row.smdPadCount,
    thtPadCount: row.thtPadCount,
    pads: row.def.pads,
    courtyardBbox: row.def.courtyardBBox ?? null,
    bodyBbox: row.def.bodyBBox,
    models: row.def.models,
    rawSexpr: row.def.rawSexpr, // VERBATIM file content — never reformatted
    source: SOURCE,
    sourceCommit: commit,
    embedding,
  };
}

async function upsertChunk(rows: NewPcbFootprint[]): Promise<void> {
  await getDb()
    .insert(pcbFootprints)
    .values(rows)
    .onConflictDoUpdate({
      target: [pcbFootprints.source, pcbFootprints.libName, pcbFootprints.name],
      set: {
        description: sql`excluded.description`,
        tags: sql`excluded.tags`,
        attrSmd: sql`excluded.attr_smd`,
        attrTht: sql`excluded.attr_tht`,
        padCount: sql`excluded.pad_count`,
        smdPadCount: sql`excluded.smd_pad_count`,
        thtPadCount: sql`excluded.tht_pad_count`,
        pads: sql`excluded.pads`,
        courtyardBbox: sql`excluded.courtyard_bbox`,
        bodyBbox: sql`excluded.body_bbox`,
        models: sql`excluded.models`,
        rawSexpr: sql`excluded.raw_sexpr`,
        sourceCommit: sql`excluded.source_commit`,
        embedding: sql`excluded.embedding`,
      },
    });
}

// ─── Step 5: repair pass ────────────────────────────────────────────────────

/** Re-embed every `embedding IS NULL` row (from this run or any earlier one). */
async function repairNullEmbeddings(): Promise<void> {
  const db = getDb();
  const nullRows = await db
    .select({
      id: pcbFootprints.id,
      libName: pcbFootprints.libName,
      name: pcbFootprints.name,
      description: pcbFootprints.description,
      tags: pcbFootprints.tags,
      attrSmd: pcbFootprints.attrSmd,
      attrTht: pcbFootprints.attrTht,
      padCount: pcbFootprints.padCount,
      smdPadCount: pcbFootprints.smdPadCount,
      thtPadCount: pcbFootprints.thtPadCount,
    })
    .from(pcbFootprints)
    .where(and(eq(pcbFootprints.source, SOURCE), isNull(pcbFootprints.embedding)));

  if (nullRows.length === 0) {
    console.log("[ingest] repair pass: no null embeddings");
    return;
  }
  console.log(`[ingest] repair pass: re-embedding ${nullRows.length} rows…`);

  for (let i = 0; i < nullRows.length; i += MAX_EMBED_BATCH_SIZE) {
    const chunk = nullRows.slice(i, i + MAX_EMBED_BATCH_SIZE);
    const vectors = await embedBatchWithRetry(chunk.map(buildEmbeddingInput));
    for (let j = 0; j < chunk.length; j++) {
      const vec = vectors[j];
      if (!vec) continue;
      await db
        .update(pcbFootprints)
        .set({ embedding: vec })
        .where(eq(pcbFootprints.id, chunk[j].id));
      report.embedded++;
    }
  }
}

// ─── Orchestration ──────────────────────────────────────────────────────────

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function writeReport(): void {
  mkdirSync(join(process.cwd(), "scripts", "output"), { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  console.log(`[ingest] report → ${REPORT_PATH}`);
  console.log(JSON.stringify(report, null, 2));
}

async function main(): Promise<number> {
  loadEnvLocal();
  const flags = parseFlags(process.argv.slice(2));
  const startedAt = Date.now();

  const commit = await ensureFootprintsCloned();
  report.commit = commit;
  console.log(`[ingest] source commit: ${commit}`);

  let files = await discoverModFiles();
  console.log(`[ingest] found ${files.length} .kicad_mod files`);
  if (flags.limit !== null) files = files.slice(0, flags.limit);
  report.scanned = files.length;

  // Change detection: rows already at this commit are skipped unless --force.
  const upToDate = new Set<string>();
  const existingKeys = new Set<string>();
  if (!flags.dryRun) {
    await getSqlClient().unsafe("CREATE EXTENSION IF NOT EXISTS vector;");
    await getSqlClient().unsafe("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
    const existing = await getDb()
      .select({
        libName: pcbFootprints.libName,
        name: pcbFootprints.name,
        sourceCommit: pcbFootprints.sourceCommit,
        hasEmbedding: sql<boolean>`(${pcbFootprints.embedding} is not null)`,
      })
      .from(pcbFootprints)
      .where(eq(pcbFootprints.source, SOURCE));
    for (const row of existing) {
      const key = `${row.libName}:${row.name}`;
      existingKeys.add(key);
      if (row.sourceCommit === commit && row.hasEmbedding) upToDate.add(key);
    }
    console.log(`[ingest] ${existingKeys.size} rows already in DB, ${upToDate.size} up-to-date`);
  }

  // Parse every file; per-file failures are logged, counted, skipped.
  const pending: PendingRow[] = [];
  const pendingKeys = new Set<string>();
  const failureExamples: string[] = [];
  for (const file of files) {
    let warnings: string[] = [];
    try {
      warnings = [];
      const source = await readFile(file.path, "utf8");
      const def = parseKicadMod(source, file.libName, warnings);
      report.parsed++;
      report.fallbackPads += warnings.filter((w) => /pad/i.test(w)).length;
      const key = `${def.libName}:${def.name}`;
      if (pendingKeys.has(key)) {
        console.warn(`[ingest] duplicate footprint name ${key} (${file.path}) — skipping`);
        report.skipped++;
        continue;
      }
      if (!flags.force && upToDate.has(key)) {
        report.skipped++;
        continue;
      }
      pendingKeys.add(key);
      pending.push(toPending(def));
    } catch (err) {
      report.failed++;
      const msg = `${file.libName}/${file.path.split(/[\\/]/).pop()}: ${messageOf(err)}`;
      if (failureExamples.length < 5) failureExamples.push(msg);
      console.error(`[ingest] parse failed — ${msg}`);
    }
  }
  console.log(
    `[ingest] parsed ${report.parsed}/${report.scanned} ` +
      `(${report.failed} failed, ${report.skipped} skipped, ${pending.length} to write)`,
  );
  if (failureExamples.length > 0) {
    console.log("[ingest] first parse failures:");
    for (const ex of failureExamples) console.log(`  - ${ex}`);
  }

  if (flags.dryRun) {
    console.log("[ingest] dry run — no DB writes");
    writeReport();
    return 0;
  }

  // Embed + upsert.
  if (pending.length > 0) {
    const embeddings = await embedAll(pending);
    for (let i = 0; i < pending.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = pending.slice(i, i + UPSERT_CHUNK_SIZE);
      const rows = chunk.map((row, j) => toDbRow(row, embeddings[i + j], commit));
      await upsertChunk(rows);
      for (let j = 0; j < chunk.length; j++) {
        const key = `${chunk[j].libName}:${chunk[j].name}`;
        if (existingKeys.has(key)) report.updated++;
        else report.inserted++;
        if (embeddings[i + j]) report.embedded++;
      }
      const written = Math.min(i + UPSERT_CHUNK_SIZE, pending.length);
      if (written % 2000 < UPSERT_CHUNK_SIZE || written === pending.length) {
        console.log(`[ingest] upserted ${written}/${pending.length}…`);
      }
    }
  }

  // Repair pass — re-embed whatever is still null, then gate on the ratio.
  await repairNullEmbeddings();
  const db = getDb();
  const [nulls] = await db
    .select({ value: count() })
    .from(pcbFootprints)
    .where(and(eq(pcbFootprints.source, SOURCE), isNull(pcbFootprints.embedding)));
  const [total] = await db
    .select({ value: count() })
    .from(pcbFootprints)
    .where(eq(pcbFootprints.source, SOURCE));
  report.embeddingNulls = Number(nulls.value);
  const totalRows = Number(total.value);

  writeReport();
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[ingest] done in ${seconds}s — ${totalRows} rows, ${report.embeddingNulls} null embeddings`);

  if (totalRows > 0 && report.embeddingNulls / totalRows > MAX_NULL_EMBEDDING_RATIO) {
    console.error(
      `[ingest] FAIL: ${report.embeddingNulls}/${totalRows} rows still lack embeddings (>0.5%)`,
    );
    return 1;
  }
  return 0;
}

main()
  .then(async (code) => {
    try {
      await getSqlClient().end();
    } catch {
      /* dry-run never opened a connection */
    }
    process.exit(code);
  })
  .catch(async (err) => {
    console.error("[ingest] fatal:", messageOf(err));
    try {
      await getSqlClient().end();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
