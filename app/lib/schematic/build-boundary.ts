/** One finite wall clock and cancellation signal for a generation, including
 * outstanding provider awaits. Late answers are observed but never accepted. */
export class BuildBoundaryError extends Error {
  constructor(readonly kind: "deadline" | "cancelled") {
    super(kind === "deadline" ? "Build deadline reached." : "Build was cancelled.");
  }
}

export async function withinBuildBoundary<T>(
  deadlineAt: number | undefined,
  external: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fail = (kind: "deadline" | "cancelled") => controller.abort(new BuildBoundaryError(kind));
  const onExternalAbort = () => fail("cancelled");
  let rejectBoundary: (error: BuildBoundaryError) => void = () => undefined;
  const onAbort = () => rejectBoundary(controller.signal.reason as BuildBoundaryError);
  const boundary = new Promise<never>((_resolve, reject) => { rejectBoundary = reject; });
  // A pre-aborted signal can reject before Promise.race subscribes.
  void boundary.catch(() => undefined);
  controller.signal.addEventListener("abort", onAbort, { once: true });
  external?.addEventListener("abort", onExternalAbort, { once: true });
  try {
    if (external?.aborted) fail("cancelled");
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) fail("deadline");
    if (controller.signal.aborted) throw controller.signal.reason;
    if (deadlineAt !== undefined) timer = setTimeout(() => fail("deadline"), Math.max(1, deadlineAt - Date.now()));
    const result = await Promise.race([Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return operation(controller.signal);
    }), boundary]);
    if (controller.signal.aborted) throw controller.signal.reason;
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
      fail("deadline");
      throw controller.signal.reason;
    }
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    external?.removeEventListener("abort", onExternalAbort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
