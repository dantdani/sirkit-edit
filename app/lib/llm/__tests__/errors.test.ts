import { afterEach, describe, expect, it, vi } from "vitest";
import { providerErrorResponse, toProviderError } from "../errors";

afterEach(() => vi.restoreAllMocks());

describe("LLM provider failures", () => {
  it("classifies a provider rate limit with a friendly retryable message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const upstream = Object.assign(new Error("sensitive upstream detail"), {
      status: 429,
      code: "rate_limit_exceeded",
    });

    const response = providerErrorResponse(upstream, "openai");
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.reason).toBe("rate_limit");
    expect(body.retryable).toBe(true);
    expect(body.error).toContain("rate limit reached");
    expect(body.error).not.toContain("sensitive upstream detail");
    expect(body.detail).toBe("sensitive upstream detail");
  });

  it("distinguishes rejected credentials from a generic outage", () => {
    const upstream = Object.assign(new Error("unauthorized"), { status: 401 });
    const error = toProviderError("openai", upstream);

    expect(error.reason).toBe("authentication");
    expect(error.message).toContain("API key");
  });
});
