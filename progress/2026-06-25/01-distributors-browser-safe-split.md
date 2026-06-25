# Distributors: browser-safe surface split (client/server bundle fix)

**Date**: 2026-06-25
**Status**: Shipped

## Why
`pnpm run dev` appeared "broken": the new dev server refused to start because one
was already running on :3000 — but that running server was returning **HTTP 500**
on every request. Root cause was a bundling error introduced by the BOM upgrades:

```
Can't resolve 'fs'
app/page.tsx → BomView.tsx ["use client"]
  → app/lib/distributors/index.ts   (barrel)
    → app/lib/db/client.ts → postgres   (Node-only, needs 'fs')
```

`BomView.tsx` is a Client Component. Its single **value** import
`import { LIFECYCLE_SEVERITY } from "@/app/lib/distributors"` pulled the barrel
(`index.ts`), whose orchestrator imports `getDb` → `postgres`. That server-only
graph got bundled for the browser and crashed the page. (The other distributor
imports in BomView were `import type`, which are erased at build, so they were
harmless — only the value import mattered.)

## The fix (two parts)

### 1. Immediate unblock
Repointed BomView's value import off the barrel. (Superseded by the split below.)

### 2. Structural split — a dedicated browser-safe module
The barrel co-located the DB-touching orchestrator with type/constant re-exports,
so any value import from a Client Component re-broke the bundle. Introduced a
browser-safe surface so client code can never reach the DB graph:

- **New `app/lib/distributors/shared.ts`** — the browser-safe public surface:
  re-exports the types (`PartPricing`, `PriceBreak`, `DistributorClient`,
  `DistributorName`, `LifecycleStatus`), the pure lifecycle helpers
  (`LIFECYCLE_SEVERITY`, `consolidateLifecycle`, `mapLifecycleString`), and now
  owns the `DistributorChoice` + `AggregatedPricing` type definitions (moved out
  of `index.ts`). No DB / `postgres` / credential imports — safe to bundle for
  the browser.
- **`index.ts` (barrel)** now imports `DistributorChoice`/`AggregatedPricing`
  from `./shared` and re-exports the whole browser-safe surface from `./shared`,
  so existing **server-side** callers keep importing from
  `@/app/lib/distributors` unchanged. The barrel remains the server-only entry
  point (still owns `getPricingFor`, `missingCredentials`, clients, DB writes).

Rule going forward: **Client Components import from `@/app/lib/distributors/shared`;
server code may import from the barrel `@/app/lib/distributors`.**

## Files touched
- **`app/lib/distributors/shared.ts`** (new) — browser-safe types/constants surface;
  now the home of `DistributorChoice` and `AggregatedPricing`.
- **`app/lib/distributors/index.ts`** — removed the local `DistributorChoice` /
  `AggregatedPricing` definitions and the per-module re-exports; now re-exports the
  browser-safe surface from `./shared`. Server orchestrator logic unchanged.
- **`app/components/bom/BomView.tsx`** — value + type imports now come from
  `@/app/lib/distributors/shared` (was the barrel). This is what was causing the 500.
- **`app/lib/snapshots.ts`** — `LifecycleStatus` type import repointed to
  `./shared` (it sits in the client import chain; keeps the boundary consistent).

Server-only callers left on the barrel intentionally (they import values like
`getPricingFor`, or only `import type` from non-client modules):
`app/lib/bom/build.ts`, `app/lib/bom-builder.ts`, `app/lib/cart-formats.ts`,
`app/api/bom/export-csv/route.ts`.

## Verification
- `pnpm tsc --noEmit` → **0 errors**
- Running dev server (Turbopack hot-reload) → **HTTP 200** on http://localhost:3000
  (was 500 before the fix)
- Grep confirms no remaining Client Component imports a **value** from the
  `@/app/lib/distributors` barrel.
