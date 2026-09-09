/**
 * [B16-C] The blinker acceptance catalog now lives in app/lib/fixture-runtime/blinker/catalog.ts
 * (shared with the env-gated fixture runtime that backs the page-level browser proof).
 * This shim keeps every test import path unchanged; the recorded identities are
 * functions of the KiCad file CONTENT, which did not move.
 */
export * from "@/app/lib/fixture-runtime/blinker/catalog";
