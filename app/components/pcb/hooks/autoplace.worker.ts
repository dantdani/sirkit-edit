/// <reference lib="webworker" />

import { autoPlace, type AutoPlaceProgress } from "@/app/lib/pcb/autoplace/auto-place";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import type { PcbBoard } from "@/app/lib/pcb/types";

export interface AutoPlaceWorkerRequest {
  board: PcbBoard;
  netlist: PcbNetlist | null;
}

export type AutoPlaceWorkerResponse =
  | { type: "progress"; progress: AutoPlaceProgress }
  | { type: "complete"; result: ReturnType<typeof autoPlace> }
  | { type: "error"; error: string };

const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<AutoPlaceWorkerRequest>): void => {
  try {
    const result = autoPlace(event.data.board, event.data.netlist, undefined, {
      onProgress: (progress) => worker.postMessage({ type: "progress", progress } satisfies AutoPlaceWorkerResponse),
    });
    worker.postMessage({ type: "complete", result } satisfies AutoPlaceWorkerResponse);
  } catch (error) {
    worker.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    } satisfies AutoPlaceWorkerResponse);
  }
};

export {};
