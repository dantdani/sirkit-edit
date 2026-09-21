/**
 * [B20 A3] The dated live re-read of the authorization pages (task-A3 section 0) is RECORDED, not only reported. A3 stopped
 * at that re-read before any code (the client-credentials extension asks for a declared capability that no section 4
 * decision makes), so this suite pins the record the stop rests on: `mcp-reference-notes.md` keeps sections 1-8 byte for
 * byte (discovery.md cites its lines) and ends with the A3 re-read as section 9, which states the facts the lead's
 * decisions need; the execution ledger records the stopped attempt (the lead writes it: the ledger is reserved).
 * Reading only: nothing is fetched and nothing is written.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const NOTES = "artifacts/ai-control-plane-b20/mcp-reference-notes.md";
const LEDGER = "artifacts/remaining-builder-program/EXECUTION_LEDGER.md";
const HEADING = "## 9. Re-read of 2026-09-21 (B20-A3: authorization)";
// sections 1-8 as B20-B3 left them (163 lines at 4299067). A reviewed pin move, with its reason beside it, if they are ever re-issued.
const SECTIONS_1_TO_8_LINES = 163;
const SECTIONS_1_TO_8_SHA256 = "08124a50938dd0fefc4db3ab36719e2e8a5fcd6cc009a3e3b83d784dd96f514e";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
// a paragraph wraps where it will: every phrase is read with its whitespace collapsed
const flat = (text: string): string => text.replace(/\s+/g, " ");
const sectionNine = (): string => {
  const notes = read(NOTES);
  const at = notes.indexOf(`\n${HEADING}\n`);
  return at < 0 ? "" : flat(notes.slice(at));
};

describe("[B20 A3] the live re-read of 2026-09-21 is recorded in the reference notes (coverage-02)", () => {
  it("mcp-reference-notes.md keeps sections 1-8 byte for byte and appends the A3 re-read as section 9", () => {
    const lines = read(NOTES).split("\n");
    const kept = `${lines.slice(0, SECTIONS_1_TO_8_LINES).join("\n")}\n`;
    // an insertion inside section 5 would move the lines discovery.md cites (notes `:129` among them)
    expect(createHash("sha256").update(kept, "utf8").digest("hex"), "sections 1-8 unchanged").toBe(SECTIONS_1_TO_8_SHA256);
    expect(lines[SECTIONS_1_TO_8_LINES], "one blank line before section 9").toBe("");
    expect(lines[SECTIONS_1_TO_8_LINES + 1]).toBe(HEADING);
  });

  it("section 9 names every page it read and the fetch date", () => {
    const section = sectionNine();
    expect(section.length, "section 9 exists").toBeGreaterThan(2_000);
    for (const source of [
      "fetched live 2026-09-21",
      "modelcontextprotocol.io/specification/2026-07-28/basic/authorization",
      "/specification/2026-07-28/basic/authorization/authorization-server-discovery",
      "/extensions/auth/oauth-client-credentials",
      "/extensions/overview",
      "github.com/modelcontextprotocol/ext-auth",
      "oauth-client-credentials.mdx",
      "RFC 8414",
      "RFC 9728",
      "RFC 6749",
      "RFC 8707",
      "draft-ietf-oauth-v2-1-13",
    ]) expect(section, source).toContain(source);
  });

  it("section 9 records the stop: the extension's declared capability, which no section 4 decision makes", () => {
    const section = sectionNine();
    for (const phrase of [
      "lists \"Declare support\" first",
      "`io.modelcontextprotocol/oauth-client-credentials`",
      "a server that requires an authentication extension can reject a client that does not declare it",
      "The ext-auth normative draft does not itself state the declaration",
      "contradicts task §4",
      "A3 stopped before code on 2026-09-21",
    ]) expect(section, phrase).toContain(phrase);
  });

  it("section 9 records the client-authentication facts OD-64 decides on: the body method and the metadata MUST", () => {
    const section = sectionNine();
    for (const phrase of [
      "a client secret \"transmitted in the request content\" as OAuth 2.1 §2.4.1 defines",
      "MUST include `token_endpoint_auth_methods_supported` with at least one of `private_key_jwt` and `client_secret_basic`",
      "the authorization server MUST support client credentials in the request body; HTTP Basic is MAY",
      "is the reverse of the extension's body method",
      "`grant_types_supported` omitted means `[\"authorization_code\", \"implicit\"]`",
    ]) expect(section, phrase).toContain(phrase);
  });
});

describe("[B20 A3] the record states what the proactive default cannot reach and where it departs (coverage-01, coverage-03)", () => {
  it("a conforming server may publish its metadata only through the 401 challenge, and the proactive default (D2, OD-64) cannot reach it", () => {
    const section = sectionNine();
    for (const phrase of [
      "MCP servers MUST implement ONE of two mechanisms",
      "A server that publishes its metadata only through the challenge conforms",
      "MUST use the challenge URL when present, and otherwise MUST fall back to the well-known URIs in that order",
      "A3 cannot reach a conforming server that publishes its metadata only through the challenge; that row ends in `prm_unavailable`",
    ]) expect(section, phrase).toContain(phrase);
  });

  it("the canonical URI's SHOULD to accept an uppercase scheme and host is recorded, with the exact comparison (D3) as a departure", () => {
    const section = sectionNine();
    for (const phrase of [
      "implementations SHOULD accept uppercase scheme and host components for robustness and interoperability",
      "follows RFC 9728 \"identical\" and departs from this SHOULD for an uppercase scheme or host",
    ]) expect(section, phrase).toContain(phrase);
  });
});

describe("[B20 A3] the execution ledger records the stopped attempt (coverage-04; the lead writes it)", () => {
  it("EXECUTION_LEDGER.md has a B20-A3 entry that says A3 stopped, why, and which decisions and closures wait on it", () => {
    const ledger = read(LEDGER);
    const heading = /^### B20-A3\b[^\n]*\bstopped\b[^\n]*$/m.exec(ledger);
    expect(heading, "a `### B20-A3 ... stopped ...` heading").not.toBeNull();
    const rest = ledger.slice(heading!.index + heading![0].length);
    const next = rest.search(/^### /m);
    const entry = flat(next < 0 ? rest : rest.slice(0, next));
    for (const phrase of ["Declare support", "D20-19", "D20-31", "OD-64", "mcp-reference-notes.md"]) expect(entry, phrase).toContain(phrase);
  });
});
