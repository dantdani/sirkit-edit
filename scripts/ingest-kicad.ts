/**
 * KiCad symbol ingestion CLI.  Run with: `pnpm ingest:kicad`
 *
 * Pipeline:
 *   1. Ensure the kicad-symbols repo is cloned into data/kicad-symbols.
 *   2. Ensure the pgvector extension exists.
 *   3. For every *.kicad_sym file:
 *        - hash it; skip the whole library if unchanged since last run.
 *        - parse → extract symbols → embed (batched) → upsert.
 *   4. Print a summary.
 *
 * Design goals: idempotent (re-running with no changes is a no-op) and
 * resilient (one bad file or symbol is logged and skipped, never fatal).
 */

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

import { loadEnvLocal } from "../app/lib/load-env-local";

import { eq, sql } from "drizzle-orm";
import { getDb, getSqlClient } from "../app/lib/db/client";
import { libraries, parts, type NewPart } from "../app/lib/db/schema";
import { extractLibrary, symbolsSafeToIngest, type ExtractedSymbol } from "../app/lib/kicad/extract";
import { categorizeLib } from "../app/lib/kicad/categories";
import { embedBatch, MAX_EMBED_BATCH_SIZE } from "../app/lib/embeddings";

const execFileAsync = promisify(execFile);

const KICAD_SYMBOLS_REPO = "https://gitlab.com/kicad/libraries/kicad-symbols.git";
const DATA_DIR = join(process.cwd(), "data", "kicad-symbols");

// Bump when the parsing/extraction logic changes — it is folded into each
// library's hash so a re-run reprocesses everything even if the source files
// are byte-identical. v2: resolve `extends` inheritance instead of skipping it.
const INGEST_VERSION = "2";

// ─── Running totals for the final summary ───────────────────────────────────

const summary = {
  librariesIngested: 0,
  librariesSkipped: 0,
  partsUpserted: 0,
  symbolsFailed: 0,
  fileErrors: 0,
};

// ─── Step 1: source checkout ────────────────────────────────────────────────

async function ensureKicadSymbolsCloned(): Promise<void> {
  if (existsSync(join(DATA_DIR, ".git"))) {
    console.log("[ingest] kicad-symbols already cloned — pulling latest…");
    try {
      await execFileAsync("git", ["-C", DATA_DIR, "pull", "--ff-only"]);
    } catch (err) {
      console.warn("[ingest] git pull failed (continuing with local copy):", messageOf(err));
    }
    return;
  }
  console.log(`[ingest] cloning ${KICAD_SYMBOLS_REPO} → ${DATA_DIR} …`);
  await execFileAsync("git", ["clone", "--depth", "1", KICAD_SYMBOLS_REPO, DATA_DIR]);
}

// ─── Step 2: extension ──────────────────────────────────────────────────────

async function enablePgVectorExtension(): Promise<void> {
  console.log("[ingest] ensuring pgvector extension…");
  await getSqlClient().unsafe("CREATE EXTENSION IF NOT EXISTS vector;");
}

// ─── Step 3: per-library ingestion ──────────────────────────────────────────

/**
 * One logical library to ingest. KiCad's current "split" format stores each
 * library as a `<Name>.kicad_symdir/` directory of single-part `.kicad_sym`
 * files; older exports use a single flat `<Name>.kicad_sym` file. We support
 * both by representing each as a unit with a name and a list of source files.
 */
type LibraryUnit = { name: string; files: string[] };

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/** Discover every library unit under DATA_DIR (split dirs + any flat files). */
async function discoverLibraryUnits(): Promise<LibraryUnit[]> {
  const entries = await readdir(DATA_DIR, { withFileTypes: true });
  const units: LibraryUnit[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith(".kicad_symdir")) {
      const dir = join(DATA_DIR, entry.name);
      const files = (await readdir(dir))
        .filter((f) => f.endsWith(".kicad_sym"))
        .sort()
        .map((f) => join(dir, f));
      if (files.length > 0) {
        units.push({ name: entry.name.replace(/\.kicad_symdir$/, ""), files });
      }
    } else if (entry.isFile() && entry.name.endsWith(".kicad_sym")) {
      units.push({
        name: entry.name.replace(/\.kicad_sym$/, ""),
        files: [join(DATA_DIR, entry.name)],
      });
    }
  }
  return units.sort((a, b) => a.name.localeCompare(b.name));
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The text we embed for each part — name + the most search-relevant metadata. */
function buildEmbeddingInput(symbol: ExtractedSymbol): string {
  return (
    `${symbol.name}. ${symbol.description ?? ""}. ` +
    `Keywords: ${symbol.keywords ?? ""}. ` +
    `Manufacturer: ${symbol.manufacturer ?? ""}. ` +
    `MPN: ${symbol.mpn ?? ""}.`
  );
}

async function ingestLibraryUnit(unit: LibraryUnit): Promise<void> {
  const db = getDb();
  const { name } = unit;

  // Read every source file once; reuse the contents for hashing and parsing.
  const contents = await Promise.all(unit.files.map((f) => readFile(f, "utf8")));

  // Library-level hash over the ingest version plus (filename + content) of
  // every file, in sorted order — any change busts the idempotency gate.
  const hasher = createHash("sha256");
  hasher.update(`v${INGEST_VERSION}\0`);
  for (let i = 0; i < unit.files.length; i++) {
    hasher.update(baseName(unit.files[i]));
    hasher.update("\0");
    hasher.update(contents[i]);
    hasher.update("\0");
  }
  const fileHash = hasher.digest("hex");

  // Idempotency gate: same hash → already ingested, skip entirely (no embeds).
  const existing = await db
    .select({ id: libraries.id, fileHash: libraries.fileHash })
    .from(libraries)
    .where(eq(libraries.name, name))
    .limit(1);

  if (existing[0]?.fileHash === fileHash) {
    console.log(`[ingest] skipping ${name} (unchanged)`);
    summary.librariesSkipped++;
    return;
  }

  // Extract every part in the library, resolving `extends` inheritance. Returns
  // one symbol per unique name (already the upsert key).
  // [B19-D I5d review] a symbol with an extraction issue (duplicate name, cyclic/dangling/cut extends chain, missing block)
  // is skipped and reported, never upserted silently
  const extraction = symbolsSafeToIngest(extractLibrary(contents));
  const symbols: ExtractedSymbol[] = extraction.accepted;
  for (const skipped of extraction.skipped) console.warn(`[ingest] ${name}: skipped symbol ${JSON.stringify(skipped.name).slice(0, 120)} (${skipped.codes.join(", ")})`);

  // Upsert the library row and get its id — but DO NOT stamp the new fileHash
  // yet. The hash is the "fully ingested" marker; writing it before the parts
  // succeed would let a mid-failure leave an incomplete library that re-runs
  // then skip. We stamp it last, only after every part is upserted.
  const [lib] = await db
    .insert(libraries)
    .values({ name, mainCategory: categorizeLib(name), fileHash: null })
    .onConflictDoUpdate({
      target: libraries.name,
      set: { mainCategory: categorizeLib(name), fileHash: null },
    })
    .returning({ id: libraries.id });

  if (symbols.length === 0) {
    await markLibraryIngested(lib.id, fileHash);
    console.log(`[ingest] ${name}: no symbols found`);
    summary.librariesIngested++;
    return;
  }

  let upsertedForLib = 0;
  for (let i = 0; i < symbols.length; i += MAX_EMBED_BATCH_SIZE) {
    const chunk = symbols.slice(i, i + MAX_EMBED_BATCH_SIZE);
    const embeddings = await embedChunkResilient(chunk, name);

    const rows: NewPart[] = [];
    for (let j = 0; j < chunk.length; j++) {
      const embedding = embeddings[j];
      if (!embedding) continue; // this symbol failed to embed — already logged
      rows.push(toPartRow(lib.id, chunk[j], embedding));
    }
    if (rows.length > 0) {
      await upsertParts(rows);
      upsertedForLib += rows.length;
    }
  }

  // All parts are in — now it is safe to stamp the hash as "fully ingested".
  await markLibraryIngested(lib.id, fileHash);

  console.log(`[ingest] ${name}: upserted ${upsertedForLib}/${symbols.length} parts`);
  summary.librariesIngested++;
  summary.partsUpserted += upsertedForLib;
}

/** Stamp a library as fully ingested (called only after all parts succeed). */
async function markLibraryIngested(libraryId: string, fileHash: string): Promise<void> {
  await getDb()
    .update(libraries)
    .set({ fileHash, ingestedAt: new Date() })
    .where(eq(libraries.id, libraryId));
}

function toPartRow(libraryId: string, symbol: ExtractedSymbol, embedding: number[]): NewPart {
  return {
    libraryId,
    name: symbol.name,
    description: symbol.description,
    keywords: symbol.keywords,
    mpn: symbol.mpn,
    manufacturer: symbol.manufacturer,
    datasheet: symbol.datasheet,
    footprintHint: symbol.footprintHint,
    properties: symbol.properties,
    pins: symbol.pins,
    symbolRaw: symbol.symbolRaw,
    embedding,
    updatedAt: new Date(),
  };
}

async function upsertParts(rows: NewPart[]): Promise<void> {
  await getDb()
    .insert(parts)
    .values(rows)
    .onConflictDoUpdate({
      target: [parts.libraryId, parts.name],
      set: {
        description: sql`excluded.description`,
        keywords: sql`excluded.keywords`,
        mpn: sql`excluded.mpn`,
        manufacturer: sql`excluded.manufacturer`,
        datasheet: sql`excluded.datasheet`,
        footprintHint: sql`excluded.footprint_hint`,
        properties: sql`excluded.properties`,
        pins: sql`excluded.pins`,
        symbolRaw: sql`excluded.symbol_raw`,
        embedding: sql`excluded.embedding`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Embed a chunk. On a batch failure, fall back to embedding each symbol singly
 * so one bad part doesn't lose the whole batch. Returns an array aligned with
 * `chunk`; failed entries are `null`.
 */
async function embedChunkResilient(
  chunk: ExtractedSymbol[],
  libName: string,
): Promise<(number[] | null)[]> {
  const inputs = chunk.map(buildEmbeddingInput);
  try {
    return await embedBatch(inputs);
  } catch (batchErr) {
    console.warn(
      `[ingest] ${libName}: batch embed failed (${messageOf(batchErr)}); retrying per-symbol…`,
    );
    const out: (number[] | null)[] = [];
    for (let i = 0; i < chunk.length; i++) {
      try {
        const [vec] = await embedBatch([inputs[i]]);
        out.push(vec);
      } catch (oneErr) {
        console.error(`[ingest]   skip "${chunk[i].name}" — embed failed: ${messageOf(oneErr)}`);
        summary.symbolsFailed++;
        out.push(null);
      }
    }
    return out;
  }
}

// ─── Orchestration ──────────────────────────────────────────────────────────

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  // Populate process.env from .env.local before any DB/OpenAI client is built.
  loadEnvLocal();
  const startedAt = Date.now();

  await ensureKicadSymbolsCloned();
  await enablePgVectorExtension();

  const units = await discoverLibraryUnits();
  const fileCount = units.reduce((n, u) => n + u.files.length, 0);
  console.log(`[ingest] found ${units.length} libraries (${fileCount} .kicad_sym files)`);

  for (const unit of units) {
    try {
      await ingestLibraryUnit(unit);
    } catch (err) {
      console.error(`[ingest] ERROR in ${unit.name}: ${messageOf(err)}`);
      summary.fileErrors++;
    }
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("\n──────── ingestion summary ────────");
  console.log(`  libraries ingested: ${summary.librariesIngested}`);
  console.log(`  libraries skipped:  ${summary.librariesSkipped}`);
  console.log(`  parts upserted:     ${summary.partsUpserted}`);
  console.log(`  symbols failed:     ${summary.symbolsFailed}`);
  console.log(`  file errors:        ${summary.fileErrors}`);
  console.log(`  elapsed:            ${seconds}s`);
  console.log("───────────────────────────────────");
}

main()
  .then(async () => {
    await getSqlClient().end();
    process.exit(0);
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
