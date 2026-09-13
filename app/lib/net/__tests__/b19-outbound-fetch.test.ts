/**
 * [B19-B I1] The bounded, validated egress path — and the holes it closes in the guard that already existed.
 *
 * Every case runs against a fake transport and a fake resolver: no network, no DNS, no vendor. What is pinned is the
 * BOUNDARY — what may be reached, how long it may take, how much may come back, where a redirect may go and what an error
 * may say — not any vendor's behaviour.
 */
import { describe, expect, it } from "vitest";
import { blockedAddressReason, blockedHostnameReason } from "../ip-policy";
import { outboundFetch, parseOutboundJson, type OutboundPolicy } from "../outbound-fetch";
import { assertPermittedUrl } from "../../atomic/security";

const POLICY: OutboundPolicy = {
  source: "test-source",
  allowedHosts: ["api.example.com", "cdn.example.com"],
  deadlineMs: 500,
  maxResponseBytes: 64,
  maxRedirects: 2,
  acceptContentTypes: ["application/json"],
};
const PUBLIC = async (): Promise<string[]> => ["93.184.216.34"];
const json = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("[B19-B I1] the address policy", () => {
  it("refuses loopback, link-local (cloud metadata), private, CGNAT, unspecified and multicast IPv4", () => {
    expect(blockedAddressReason("127.0.0.1")).toBe("loopback");
    expect(blockedAddressReason("169.254.169.254"), "the cloud metadata service").toBe("link-local");
    for (const address of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1"]) expect(blockedAddressReason(address), address).toBe("private");
    expect(blockedAddressReason("100.64.0.1")).toBe("carrier-grade-nat");
    expect(blockedAddressReason("0.0.0.0")).toBe("unspecified");
    expect(blockedAddressReason("224.0.0.1")).toBe("multicast");
    for (const address of ["93.184.216.34", "172.32.0.1", "100.128.0.1", "8.8.8.8"]) expect(blockedAddressReason(address), address).toBeNull();
  });

  it("refuses the IPv6 ranges the existing guard never knew about, and judges an IPv4-mapped address by the IPv4 it reaches", () => {
    expect(blockedAddressReason("::1")).toBe("loopback");
    expect(blockedAddressReason("[::1]")).toBe("loopback");
    expect(blockedAddressReason("fd00::1")).toBe("unique-local");
    expect(blockedAddressReason("fe80::1")).toBe("link-local");
    expect(blockedAddressReason("ff02::1")).toBe("multicast");
    expect(blockedAddressReason("::ffff:127.0.0.1"), "an IPv4-mapped loopback is still loopback").toBe("loopback");
    expect(blockedAddressReason("::ffff:169.254.169.254")).toBe("link-local");
    expect(blockedAddressReason("2606:4700:4700::1111"), "an ordinary public IPv6").toBeNull();
  });

  it("reads IPv6 as NUMBERS: the URL parser rewrites a mapped address into hex before any check sees it", () => {
    // Found while fixing the guard: `new URL("https://[::ffff:127.0.0.1]/")` hands back hostname `[::ffff:7f00:1]`. A rule
    // that matched the dotted form never saw that. Every spelling of the same address must be judged the same.
    expect(new URL("https://[::ffff:127.0.0.1]/").hostname).toBe("[::ffff:7f00:1]");
    for (const spelling of ["::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:0001", "::FFFF:7F00:1"]) {
      expect(blockedAddressReason(spelling), spelling).toBe("loopback");
    }
    expect(blockedAddressReason("::ffff:a9fe:a9fe"), "169.254.169.254, mapped, in hex").toBe("link-local");
    expect(blockedAddressReason("0:0:0:0:0:0:0:1"), "loopback, fully expanded").toBe("loopback");
    expect(blockedAddressReason("fe80::1%eth0"), "a zone id does not hide link-local").toBe("link-local");
    expect(blockedAddressReason("::ffff:5db8:d822"), "a mapped PUBLIC address is still public").toBeNull();
    // Text that is not an address is not judged as one; it cannot become a URL to reach anything in the first place.
    expect(blockedAddressReason("1::2::3")).toBeNull();
    expect(() => new URL("https://[1::2::3]/"), "the URL parser refuses it outright").toThrow();
  });

  it("refuses names that never reach a public host, whatever they resolve to", () => {
    for (const host of ["localhost", "api.localhost", "printer.local", "metadata.google.internal", "service.internal"]) expect(blockedHostnameReason(host), host).not.toBeNull();
    expect(blockedHostnameReason("api.example.com")).toBeNull();
  });

  it("closes the holes in the guard that already existed: an allowlisted private LITERAL is refused by the address, not only by the list", () => {
    // Reproduction: before B19 this guard's private-range table was IPv4-only, so with the literal on the allowlist these
    // passed. The allowlist was doing all the work.
    for (const [literal, host] of [["https://[::1]/x", "::1"], ["https://[fd00::1]/x", "fd00::1"], ["https://[::ffff:127.0.0.1]/x", "::ffff:127.0.0.1"], ["https://100.64.0.1/x", "100.64.0.1"]] as const) {
      expect(() => assertPermittedUrl(literal, [host, `[${host}]`]), literal).toThrow(/Private-network/);
    }
    expect(assertPermittedUrl("https://api.example.com/x", ["api.example.com"]).hostname).toBe("api.example.com");
  });
});

describe("[B19-B I1] what may be reached", () => {
  it("only HTTPS, only allowlisted exact hosts, never URL credentials", async () => {
    expect(await outboundFetch({ url: "http://api.example.com/x" }, POLICY, { fetch: async () => json("{}"), resolve: PUBLIC })).toMatchObject({ ok: false, code: "scheme_not_https" });
    expect(await outboundFetch({ url: "https://evil.example.org/x" }, POLICY, { fetch: async () => json("{}"), resolve: PUBLIC })).toMatchObject({ ok: false, code: "host_not_allowed" });
    expect(await outboundFetch({ url: "https://sub.api.example.com/x" }, POLICY, { fetch: async () => json("{}"), resolve: PUBLIC }), "no implicit subdomain").toMatchObject({ ok: false, code: "host_not_allowed" });
    expect(await outboundFetch({ url: "https://user:pw@api.example.com/x" }, POLICY, { fetch: async () => json("{}"), resolve: PUBLIC })).toMatchObject({ ok: false, code: "url_credentials" });
    expect(await outboundFetch({ url: "not a url" }, POLICY, { fetch: async () => json("{}"), resolve: PUBLIC })).toMatchObject({ ok: false, code: "url_invalid" });
  });

  it("an ALLOWED name that resolves to a private or metadata address is refused — every address must be public", async () => {
    let called = false;
    const transport = async () => { called = true; return json("{}"); };
    expect(await outboundFetch({ url: "https://api.example.com/x" }, POLICY, { fetch: transport, resolve: async () => ["169.254.169.254"] })).toMatchObject({ ok: false, code: "address_blocked" });
    expect(await outboundFetch({ url: "https://api.example.com/x" }, POLICY, { fetch: transport, resolve: async () => ["93.184.216.34", "10.0.0.5"] }), "one private answer among public ones is enough to refuse").toMatchObject({ ok: false, code: "address_blocked" });
    expect(await outboundFetch({ url: "https://api.example.com/x" }, POLICY, { fetch: transport, resolve: async () => ["::1"] })).toMatchObject({ ok: false, code: "address_blocked" });
    expect(called, "the transport is never reached for a refused address").toBe(false);
  });

  it("a name that does not resolve is a closed failure, never a thrown error", async () => {
    expect(await outboundFetch({ url: "https://api.example.com/x" }, POLICY, { fetch: async () => json("{}"), resolve: async () => { throw new Error("ENOTFOUND api.example.com"); } })).toMatchObject({ ok: false, code: "dns_failed" });
    expect(await outboundFetch({ url: "https://api.example.com/x" }, POLICY, { fetch: async () => json("{}"), resolve: async () => [] })).toMatchObject({ ok: false, code: "dns_failed" });
  });
});

describe("[B19-B I1] how long, and how much", () => {
  it("a transport that never answers settles at the deadline", async () => {
    const started = Date.now();
    const hang: typeof fetch = (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const result = await outboundFetch({ url: "https://api.example.com/x" }, { ...POLICY, deadlineMs: 80 }, { fetch: hang, resolve: PUBLIC });
    expect(result).toMatchObject({ ok: false, code: "timeout" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("a resolver that never answers is bounded by the same deadline", async () => {
    const started = Date.now();
    const result = await outboundFetch({ url: "https://api.example.com/x" }, { ...POLICY, deadlineMs: 80 }, { fetch: async () => json("{}"), resolve: () => new Promise(() => undefined) });
    expect(result).toMatchObject({ ok: false, code: "timeout" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("the caller's abort ends the exchange, and a pre-aborted request never starts", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    expect(await outboundFetch({ url: "https://api.example.com/x", signal: controller.signal }, POLICY, { fetch: async () => { called = true; return json("{}"); }, resolve: PUBLIC })).toMatchObject({ ok: false, code: "aborted" });
    expect(called).toBe(false);
  });

  it("an oversized body is refused, not buffered; a body within the ceiling is returned byte-exact", async () => {
    expect(await outboundFetch({ url: "https://api.example.com/x" }, POLICY, { fetch: async () => json("x".repeat(500)), resolve: PUBLIC })).toMatchObject({ ok: false, code: "response_too_large" });
    const ok = await outboundFetch({ url: "https://api.example.com/x" }, POLICY, { fetch: async () => json('{"a":1}'), resolve: PUBLIC });
    if (!ok.ok) throw new Error(ok.message);
    expect(parseOutboundJson(ok, "test-source")).toEqual({ ok: true, value: { a: 1 } });
  });

  it("a body of the wrong type is refused before it is read; a malformed JSON body is a closed failure", async () => {
    expect(await outboundFetch({ url: "https://api.example.com/x" }, POLICY, { fetch: async () => new Response("<html>", { headers: { "content-type": "text/html" } }), resolve: PUBLIC })).toMatchObject({ ok: false, code: "unexpected_content_type" });
    const bad = await outboundFetch({ url: "https://api.example.com/x" }, POLICY, { fetch: async () => json("{not json"), resolve: PUBLIC });
    if (!bad.ok) throw new Error(bad.message);
    expect(parseOutboundJson(bad, "test-source")).toEqual({ ok: false, message: "test-source: the response was not valid JSON." });
  });
});

describe("[B19-B I1] where a redirect may go", () => {
  const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

  it("a redirect is never followed implicitly: the transport is asked for manual redirects", async () => {
    let mode: RequestRedirect | undefined;
    await outboundFetch({ url: "https://api.example.com/x" }, POLICY, { fetch: async (_input, init) => { mode = init?.redirect; return json("{}"); }, resolve: PUBLIC });
    expect(mode).toBe("manual");
  });

  it("each hop is revalidated: a redirect to a non-allowlisted host or a private address is refused with its own reason", async () => {
    expect(await outboundFetch({ url: "https://api.example.com/x" }, POLICY, { fetch: async () => redirect("https://evil.example.org/steal"), resolve: PUBLIC })).toMatchObject({ ok: false, code: "host_not_allowed" });
    expect(await outboundFetch({ url: "https://api.example.com/x" }, POLICY, { fetch: async () => redirect("https://169.254.169.254/latest/meta-data/"), resolve: PUBLIC })).toMatchObject({ ok: false, code: "address_blocked" });
    expect(await outboundFetch({ url: "https://api.example.com/x" }, POLICY, { fetch: async () => redirect("http://api.example.com/x"), resolve: PUBLIC }), "a downgrade to HTTP").toMatchObject({ ok: false, code: "scheme_not_https" });
  });

  it("hops are bounded, and credentials never cross an origin", async () => {
    expect(await outboundFetch({ url: "https://api.example.com/x" }, POLICY, { fetch: async () => redirect("https://api.example.com/x"), resolve: PUBLIC })).toMatchObject({ ok: false, code: "too_many_redirects" });
    const seen: Array<{ url: string; auth: string | undefined }> = [];
    const transport: typeof fetch = async (input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({ url: String(input), auth: headers.Authorization });
      return String(input).startsWith("https://api.example.com") ? redirect("https://cdn.example.com/file.json") : json("{}");
    };
    const result = await outboundFetch({ url: "https://api.example.com/x", headers: { Authorization: "Bearer sk-live-SECRET-1234567890" } }, POLICY, { fetch: transport, resolve: PUBLIC });
    expect(result.ok).toBe(true);
    expect(seen).toEqual([
      { url: "https://api.example.com/x", auth: "Bearer sk-live-SECRET-1234567890" },
      { url: "https://cdn.example.com/file.json", auth: undefined },
    ]);
  });

  it("a request whose URL carries a secret is never redirected at all — the Location could be anywhere", async () => {
    const result = await outboundFetch({ url: "https://api.example.com/search?apiKey=SECRET-KEY-VALUE" }, { ...POLICY, secretQueryParams: ["apiKey"] }, { fetch: async () => redirect("https://api.example.com/elsewhere"), resolve: PUBLIC });
    expect(result).toMatchObject({ ok: false, code: "redirect_refused" });
  });
});

describe("[B19-B I1] what an error may say", () => {
  it("never the secret, never the query string, never the remote body", async () => {
    const results = [
      await outboundFetch({ url: "https://api.example.com/search?apiKey=SECRET-KEY-VALUE" }, { ...POLICY, secretQueryParams: ["apiKey"] }, { fetch: async () => { throw new Error("connect ECONNREFUSED https://api.example.com/search?apiKey=SECRET-KEY-VALUE"); }, resolve: PUBLIC }),
      await outboundFetch({ url: "https://api.example.com/search?apiKey=SECRET-KEY-VALUE" }, { ...POLICY, secretQueryParams: ["apiKey"] }, { fetch: async () => new Response("internal: db password hunter2", { status: 500, headers: { "content-type": "text/plain" } }), resolve: PUBLIC }),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      const text = JSON.stringify(result);
      expect(text, text).not.toContain("SECRET-KEY-VALUE");
      expect(text, text).not.toContain("hunter2");
    }
  });

  it("never throws, whatever the transport does", async () => {
    const hostile: typeof fetch = async () => { throw Object.assign(new Error("boom"), { cause: new Error("deeper") }); };
    await expect(outboundFetch({ url: "https://api.example.com/x" }, POLICY, { fetch: hostile, resolve: PUBLIC })).resolves.toMatchObject({ ok: false, code: "network_error" });
  });
});
