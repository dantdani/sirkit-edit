import type { ConstraintCompilationInput, ConstraintCompilationResult } from "./types";
import { compileConstraintProgram } from "./compiler";
import { constraintSemanticHash, deepFreezeConstraint } from "./stable";

export class ConstraintCompilerCache {
  private readonly entries = new Map<string, ConstraintCompilationResult>();
  private hitCount = 0;
  private missCount = 0;

  constructor(private readonly maxEntries = 32) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 256) throw new Error("Constraint compiler cache size must be 1..256.");
  }

  compile(input: ConstraintCompilationInput): ConstraintCompilationResult {
    const key = constraintSemanticHash(input);
    const cached = this.entries.get(key);
    if (cached) {
      this.hitCount += 1;
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    this.missCount += 1;
    const result = deepFreezeConstraint(compileConstraintProgram(input)) as ConstraintCompilationResult;
    this.entries.set(key, result);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    return result;
  }

  clear(): void {
    this.entries.clear();
  }

  stats(): { entries: number; hits: number; misses: number } {
    return { entries: this.entries.size, hits: this.hitCount, misses: this.missCount };
  }
}

