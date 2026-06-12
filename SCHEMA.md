# Sirkit Database Setup Guide

This document explains how to create your **own** database for Sirkit that is
identical in structure to the reference one. You will use your own Supabase
project and your own credentials — no shared secrets are required.

## Overview

Sirkit stores KiCad symbol-library data in **Postgres** (hosted on
**Supabase**) and accesses it through **Drizzle ORM** (`drizzle-orm/postgres-js`).
There are two tables:

- `libraries` — one row per KiCad symbol library file (e.g. `Device`, `MCU_ST_STM32F4`)
- `parts` — one row per symbol/part within a library, including a 1536-dimension
  embedding vector for semantic search (requires the **pgvector** extension)

The data itself is not hand-entered — it is populated automatically by an
ingestion script that clones the official KiCad symbols repo, parses it,
embeds part descriptions with OpenAI, and upserts everything. So you only need
to create the *empty schema*, then run the ingest script to fill it.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project (free tier is fine).
2. In **Project Settings → Database → Connection string**, copy the **Session
   Pooler** URI (the one on port `5432` via `*.pooler.supabase.com`).
   - ⚠️ Do **not** use the direct `db.<ref>.supabase.co` host — it is
     IPv6-only and fails on IPv4-only networks. The app is written for the
     pooler (`prepare: false` is set for pooler compatibility).
3. In **Project Settings → API**, copy the project URL and the publishable
   (anon) key.

## 2. Set your environment variables

Copy `.env.example` to `.env.local` and fill in **your own** values:

```bash
# Anthropic — chat + schematic generation
ANTHROPIC_API_KEY=<your own key from console.anthropic.com>

# OpenAI — embeddings (text-embedding-3-small) used by ingestion + parts search
OPENAI_API_KEY=<your own key from platform.openai.com>

# Postgres connection (Supabase Session Pooler URI)
DATABASE_URL=postgresql://postgres.<project-ref>:<your-db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres

# Supabase client
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your publishable/anon key>
```

`.env*` files are gitignored — never commit them.

## 3. Enable the pgvector extension

The `parts.embedding` column uses the `vector` type. Enable the extension once
(in the Supabase SQL Editor, or it also happens automatically when you run the
ingest script):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## 4. Create the schema

You have two equivalent options.

### Option A — Drizzle push (recommended)

The schema source of truth is `app/lib/db/schema.ts`. With `DATABASE_URL` set
in `.env.local`, just run:

```bash
pnpm db:push
```

### Option B — Raw SQL

Run this in the Supabase SQL Editor (it is the generated migration from
`drizzle/0000_military_squadron_sinister.sql`):

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "libraries" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "main_category" text NOT NULL,
    "file_hash" text,
    "ingested_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "libraries_name_unique" UNIQUE("name")
);

CREATE TABLE "parts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "library_id" uuid NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "keywords" text,
    "mpn" text,
    "manufacturer" text,
    "datasheet" text,
    "footprint_hint" text,
    "properties" jsonb NOT NULL,
    "pins" jsonb NOT NULL,
    "symbol_raw" text NOT NULL,
    "embedding" vector(1536),
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE "parts"
    ADD CONSTRAINT "parts_library_id_libraries_id_fk"
    FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id")
    ON DELETE cascade ON UPDATE no action;

CREATE INDEX "parts_library_idx" ON "parts" USING btree ("library_id");
CREATE INDEX "parts_embedding_idx" ON "parts" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "parts_name_idx" ON "parts" USING btree ("name");
CREATE UNIQUE INDEX "parts_library_name_uniq" ON "parts" USING btree ("library_id","name");
```

## 5. Populate the database

Run the ingestion script (needs `DATABASE_URL` and `OPENAI_API_KEY` set):

```bash
pnpm ingest:kicad
```

What it does:

1. Clones (or pulls) the official KiCad symbols repo into `data/kicad-symbols/`.
2. Ensures the pgvector extension exists.
3. Parses every `.kicad_sym` library, extracts each symbol, generates
   embeddings via OpenAI `text-embedding-3-small` (batched), and upserts rows.
4. It is **idempotent** — each library's file hash is stored in
   `libraries.file_hash`, so re-running skips anything unchanged. Safe to
   re-run after interruptions.

Note: the full ingest embeds tens of thousands of parts, so it takes a while
and uses a small amount of OpenAI credit (text-embedding-3-small is cheap).

## Schema reference

### `libraries`

| Column          | Type          | Constraints                  | Meaning                                                        |
| --------------- | ------------- | ---------------------------- | -------------------------------------------------------------- |
| `id`            | `uuid`        | PK, default `gen_random_uuid()` | Row id                                                       |
| `name`          | `text`        | NOT NULL, UNIQUE             | KiCad library basename, e.g. `Device`, `MCU_ST_STM32F4`        |
| `main_category` | `text`        | NOT NULL                     | User-facing top-level category, e.g. `Microcontrollers`        |
| `file_hash`     | `text`        |                              | SHA-256 of the source `.kicad_sym` at ingest time (change detection) |
| `ingested_at`   | `timestamptz` | default `now()`              | Last ingest time                                               |

### `parts`

| Column           | Type           | Constraints                          | Meaning                                                  |
| ---------------- | -------------- | ------------------------------------ | -------------------------------------------------------- |
| `id`             | `uuid`         | PK, default `gen_random_uuid()`      | Row id                                                   |
| `library_id`     | `uuid`         | NOT NULL, FK → `libraries.id`, ON DELETE CASCADE | Owning library                               |
| `name`           | `text`         | NOT NULL                             | KiCad symbol name, e.g. `ATmega328P-AU`                  |
| `description`    | `text`         |                                      | Part description                                         |
| `keywords`       | `text`         |                                      | From `ki_keywords`, space-separated                      |
| `mpn`            | `text`         |                                      | Manufacturer part number, if present                     |
| `manufacturer`   | `text`         |                                      | Manufacturer name, if present                            |
| `datasheet`      | `text`         |                                      | Datasheet URL, if present                                |
| `footprint_hint` | `text`         |                                      | Suggested footprint reference, if present                |
| `properties`     | `jsonb`        | NOT NULL                             | All KiCad properties verbatim (`Record<string, string>`) |
| `pins`           | `jsonb`        | NOT NULL                             | Structured pin list (`KicadPin[]`, see `app/lib/kicad/types.ts`) |
| `symbol_raw`     | `text`         | NOT NULL                             | Full S-expression source of the symbol, for re-rendering |
| `embedding`      | `vector(1536)` |                                      | OpenAI `text-embedding-3-small` embedding                |
| `created_at`     | `timestamptz`  | default `now()`                      |                                                          |
| `updated_at`     | `timestamptz`  | default `now()`                      |                                                          |

### Indexes on `parts`

| Index                     | Type                          | Columns               | Purpose                              |
| ------------------------- | ----------------------------- | --------------------- | ------------------------------------ |
| `parts_library_idx`       | btree                         | `library_id`          | Join/filter by library               |
| `parts_embedding_idx`     | HNSW (`vector_cosine_ops`)    | `embedding`           | Fast cosine-similarity vector search |
| `parts_name_idx`          | btree                         | `name`                | Name lookups                         |
| `parts_library_name_uniq` | btree, UNIQUE                 | `library_id`, `name`  | Upsert key — one row per (library, symbol) |

## Verifying it worked

After ingestion, in the Supabase SQL Editor:

```sql
SELECT count(*) FROM libraries;
SELECT count(*) FROM parts;
SELECT count(*) FROM parts WHERE embedding IS NOT NULL;
```

Then start the app (`pnpm dev`) and try the parts search — it queries
`/api/parts/search` which embeds your query and runs a vector similarity
search against `parts.embedding`.

## Key source files

- `app/lib/db/schema.ts` — Drizzle schema (source of truth)
- `app/lib/db/client.ts` — lazy Drizzle/postgres client (`DATABASE_URL`)
- `drizzle/0000_military_squadron_sinister.sql` — generated migration
- `scripts/ingest-kicad.ts` — ingestion pipeline (`pnpm ingest:kicad`)
- `app/lib/embeddings.ts` — embedding helper (1536 dims, `text-embedding-3-small`)
