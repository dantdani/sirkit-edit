"use client";

/**
 * Module-level cache of KiCad part static data, keyed by partId.
 *
 * Placed KiCad components store only a `partId`; their geometry/metadata lives
 * here and is fetched once from `/api/parts/[id]` on first use. The canvas
 * subscribes per-part so it re-renders when an async-loaded part arrives.
 *
 * The cache persists for the session. Tests or a hard refresh clear it.
 */

import type { KicadPin } from "@/app/lib/kicad/types";

export type CachedPart = {
  id: string;
  name: string;
  description: string | null;
  mpn: string | null;
  manufacturer: string | null;
  datasheet: string | null;
  footprintHint: string | null;
  mainCategory: string;
  libraryName: string;
  pins: KicadPin[];
  symbolRaw: string;
  properties: Record<string, string>;
};

const cache = new Map<string, CachedPart>();
const inflight = new Map<string, Promise<CachedPart>>();
const subscribers = new Map<string, Set<() => void>>();

/** Synchronously returns the cached part if loaded, else triggers a fetch and returns null. */
export function getCachedPart(partId: string): CachedPart | null {
  const hit = cache.get(partId);
  if (hit) return hit;
  // Fire-and-forget load; subscribers are notified when it lands.
  void ensurePartLoaded(partId).catch(() => {
    /* errors surface to awaiters of ensurePartLoaded; ignore here */
  });
  return null;
}

/** Loads (or returns the in-flight/cached) part. Resolves with the part data. */
export function ensurePartLoaded(partId: string): Promise<CachedPart> {
  const hit = cache.get(partId);
  if (hit) return Promise.resolve(hit);

  const existing = inflight.get(partId);
  if (existing) return existing;

  const promise = (async () => {
    const res = await fetch(`/api/parts/${partId}`);
    const data = (await res.json()) as { ok?: boolean; part?: CachedPart | null };
    if (!data.ok || !data.part) {
      throw new Error(`Part ${partId} not found`);
    }
    cache.set(partId, data.part);
    notify(partId);
    return data.part;
  })();

  inflight.set(partId, promise);
  // Clear the in-flight marker once settled, regardless of outcome.
  void promise.finally(() => inflight.delete(partId));
  return promise;
}

/** Subscribe to a part becoming available (or updating). Returns an unsubscribe fn. */
export function subscribeToPart(partId: string, handler: () => void): () => void {
  let set = subscribers.get(partId);
  if (!set) {
    set = new Set();
    subscribers.set(partId, set);
  }
  set.add(handler);
  return () => {
    const s = subscribers.get(partId);
    if (!s) return;
    s.delete(handler);
    if (s.size === 0) subscribers.delete(partId);
  };
}

function notify(partId: string): void {
  const set = subscribers.get(partId);
  if (!set) return;
  for (const handler of set) handler();
}
