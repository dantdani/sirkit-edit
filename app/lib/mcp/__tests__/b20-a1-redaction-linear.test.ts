/**
 * [B20 A1 review-2] The URL-credential pattern of THE redaction authority (`app/lib/agent/redaction.ts`, B19-D I5e row 30)
 * in linear time. The MCP transport runs it over server-controlled text (`scrubVendorText`); the B19 pattern began with a
 * word boundary, so on text such as "a.a.a.…" a scan started at every letter and each ran to the end of the run: quadratic,
 * synchronous, and no deadline can interrupt it. The scan now starts only at the FIRST letter of a run of scheme characters.
 *
 * Pinned here: the outputs are the B19 outputs wherever the B19 pattern matched (the reference pattern is kept below and
 * compared over a generated corpus), the two places where the new pattern redacts MORE are named, and the time is linear.
 * Every value is an obvious fake.
 */
import { describe, expect, it } from "vitest";
import { containsSecretShapedText, containsTokenAnchoredSecretShapedText, sanitizeModelBoundText, sanitizeTraceText } from "../../agent/redaction";
import { scrubVendorText } from "../http-transport";

/** The B19 pattern, verbatim, as the reference the new one is compared against. */
const B19_URL_CREDENTIALS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s@]*@(?:[^\s@]*@)*/gi;
const b19 = (text: string): string => text.replace(new RegExp(B19_URL_CREDENTIALS.source, "gi"), "[redacted]");
const UNBOUNDED = Number.MAX_SAFE_INTEGER;
const E_ACUTE = String.fromCharCode(233);

describe("[B20 A1] the URL-credential pattern: the same redactions as B19", () => {
  const rows: ReadonlyArray<readonly [string, string, string]> = [
    ["the scheme at the start of the text", "postgres://u:SENTINELPW@db.internal:5432/x", "[redacted]db.internal:5432/x"],
    ["after a space", "connect failed postgres://u:SENTINELPW@db.internal:5432/x", "connect failed [redacted]db.internal:5432/x"],
    ["after a double quote", 'url="redis://:SENTINELPW@cache.internal:6379"', 'url="[redacted]cache.internal:6379"'],
    ["after a single quote and a parenthesis", "('amqp://guest:SENTINELPW@mq.internal/')", "('[redacted]mq.internal/')"],
    ["after a colon (a jdbc prefix)", "jdbc:postgresql://u:SENTINELPW@db.internal/x", "jdbc:[redacted]db.internal/x"],
    ["inside a word: the whole run is the scheme", "xhttps://u:SENTINELPW@h.internal/p", "[redacted]h.internal/p"],
    ["a compound scheme", "clone git+ssh://git:SENTINELPW@h.internal/repo", "clone [redacted]h.internal/repo"],
    ["a run that starts with a hyphen", "-https://u:SENTINELPW@h.internal", "-[redacted]h.internal"],
    ["a run that starts with a digit and a dot", "1.https://u:SENTINELPW@h.internal", "1.[redacted]h.internal"],
    ["mixed case", "Fetch Failed HTTPS://User:SENTINELPW@Git.Internal/Repo", "Fetch Failed [redacted]Git.Internal/Repo"],
    ["an @ in the password", "postgres://u:SENTI@NELPW@db.internal:5432/x", "[redacted]db.internal:5432/x"],
    ["a slash in the password", "postgres://u:SENTI/NELPW@db.internal:5432/x", "[redacted]db.internal:5432/x"],
    ["an empty user", "redis://:SENTINELPW@cache.internal:6379", "[redacted]cache.internal:6379"],
    ["token-only userinfo", "https://SENTINELPW@git.internal/repo", "[redacted]git.internal/repo"],
    ["two URLs in one text", "a postgres://u:SENTINELPW@db.internal b https://SENTINELPW@git.internal c", "a [redacted]db.internal b [redacted]git.internal c"],
    ["after a line break and a tab", "first\n\tmysql://root:SENTINELPW@db.internal", "first\n\t[redacted]db.internal"],
    ["after a non-ASCII letter", `caf${E_ACUTE}https://u:SENTINELPW@h.internal`, `caf${E_ACUTE}[redacted]h.internal`],
    ["no credentials: nothing to redact", "see https://example.com/a?b=c and mailto:someone@example.com", "see https://example.com/a?b=c and mailto:someone@example.com"],
    ["an @ in a path is still over-redacted, as in B19", "https://example.com/img@2x.png", "[redacted]2x.png"],
    ["a scheme separator with no letter before it", "12://u:SENTINELPW@h.internal ://x@y", "12://u:SENTINELPW@h.internal ://x@y"],
  ];

  it("every row redacts exactly as the B19 pattern did, through each classifier that uses it", () => {
    for (const [label, input, expected] of rows) {
      expect(b19(input), `${label}: the reference`).toBe(expected);
      expect(sanitizeTraceText(input, UNBOUNDED), label).toBe(expected);
      expect(sanitizeModelBoundText(input), label).toBe(expected);
      expect(containsSecretShapedText(input), label).toBe(input !== expected);
      expect(containsTokenAnchoredSecretShapedText(input), label).toBe(input !== expected);
    }
  });

  it("a generated corpus (prefix x scheme x userinfo x rest) redacts as B19 did; where the first letter of the run follows a digit or an underscore the new pattern redacts MORE, never less", () => {
    const prefixes = ["", " ", "\"", "'", "(", "=", ":", "/", "x", "X.", "a+", "b-", "-", ".", "+", "9.", "a9", "\n", "\t", ",", "9", "_", "x_", "9a.", "0-1"];
    const schemes = ["https", "POSTGRES", "git+ssh", "a", "s3.v4-x"];
    const userinfos = ["u:SENTINELPW", ":SENTINELPW", "SENTINELPW", "u:SENTI@NELPW", "u:SENTI/NELPW"];
    const rests = ["h.internal/p", "h.internal:5432/x?y=1 and more text", "h"];
    let same = 0;
    const more: string[] = [];
    for (const prefix of prefixes) for (const scheme of schemes) for (const userinfo of userinfos) for (const rest of rests) {
      const input = `say ${prefix}${scheme}://${userinfo}@${rest}`;
      const before = b19(input);
      const after = sanitizeTraceText(input, UNBOUNDED);
      expect(after, input).not.toContain("SENTI");
      if (after === before) { same += 1; continue; }
      // the first LETTER of the run is not at a word boundary (it follows a digit of the run, or an underscore before it):
      // B19 started later in the run or not at all, the new pattern starts at that letter — a longer redaction with the same end
      expect(/(?:[0-9]|_)$/.test(prefix) || /[0-9][+.-]*$/.test(prefix.replace(/[a-z].*$/i, "")), `${input}: differs only where named`).toBe(true);
      expect(after.length, input).toBeLessThanOrEqual(before.length);
      expect(after.endsWith(rest), input).toBe(true);
      more.push(prefix);
    }
    expect(same, "20 of the 25 prefixes, 75 combinations each").toBe(20 * 75);
    expect([...new Set(more)].sort()).toEqual(["0-1", "9", "9a.", "_", "x_"].sort());
    // the named differences, literally: B19 left these credentials in place
    expect(b19("say 9https://u:SENTINELPW@h")).toBe("say 9https://u:SENTINELPW@h");
    expect(sanitizeTraceText("say 9https://u:SENTINELPW@h", UNBOUNDED)).toBe("say 9[redacted]h");
    expect(b19("say x_https://u:SENTINELPW@h")).toBe("say x_https://u:SENTINELPW@h");
    expect(sanitizeTraceText("say x_https://u:SENTINELPW@h", UNBOUNDED)).toBe("say x_[redacted]h");
    expect(b19("say 9a.https://u:SENTINELPW@h")).toBe("say 9a.[redacted]h");
    expect(sanitizeTraceText("say 9a.https://u:SENTINELPW@h", UNBOUNDED)).toBe("say 9[redacted]h");
  });
});

describe("[B20 A1] the URL-credential pattern: linear time", () => {
  const elapsed = (run: () => void): number => { const started = performance.now(); run(); return performance.now() - started; };

  it("200 scrubs of a 4 000-character leaf with a word boundary at every letter finish well under 2 000 ms", () => {
    const leaf = "a.".repeat(2_000);
    expect(scrubVendorText(leaf, 1_000)).toBe(leaf.slice(0, 1_000));
    expect(elapsed(() => { for (let i = 0; i < 200; i += 1) scrubVendorText(leaf, 1_000); })).toBeLessThan(2_000);
  });

  it("one 100 000-character text of each run shape — letters and dots, digits, digits then letters, hyphens, mixed case — is classified and redacted in under 1 000 ms", () => {
    for (const unit of ["a.", "1", "1a", "a1.", "-", "A.b+", "a-1."]) {
      const text = unit.repeat(Math.ceil(100_000 / unit.length));
      const spent = elapsed(() => {
        expect(sanitizeTraceText(text, UNBOUNDED)).toBe(text);
        expect(containsSecretShapedText(text)).toBe(false);
      });
      expect(spent, JSON.stringify(unit)).toBeLessThan(1_000);
    }
    // and with a credential at the very end of a long run, the run is still one redaction
    const tail = `${"a.".repeat(50_000)}https://u:SENTINELPW@h.internal`;
    expect(sanitizeTraceText(tail, UNBOUNDED)).toBe("[redacted]h.internal");
  });
});
