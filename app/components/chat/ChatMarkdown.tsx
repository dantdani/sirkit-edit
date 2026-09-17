/**
 * [B19-D I5c row 02] The one renderer for assistant markdown in chat.
 *
 * Moved out of app/page.tsx with the same look, plus two rules:
 *  - an image is never fetched: markdown images render as their alt text (a reply or an imported project could otherwise make
 *    the browser request any URL the moment the chat opens — an exfiltration channel);
 *  - a link keeps only a web or mail destination (anything else renders as plain text), opens in a new tab without a referrer,
 *    and shows the host it goes to.
 */
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { safeHref } from "@/app/lib/net/href-policy";

function linkTarget(href: string | undefined): { href: string; host: string } | null {
  if (typeof href === "string" && /^mailto:[^\s]+@[^\s]+$/i.test(href.trim())) return { href: href.trim(), host: "email" };
  const safe = safeHref(href, "document");
  return safe ? { href: safe, host: new URL(safe).hostname } : null;
}

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeHighlight, rehypeKatex]}
      components={{
        p:          ({ children }) => <p className="mb-2 last:mb-0 text-zinc-200 leading-relaxed">{children}</p>,
        h1:         ({ children }) => <h1 className="text-sm font-medium text-zinc-100 mt-3 mb-1.5">{children}</h1>,
        h2:         ({ children }) => <h2 className="text-sm font-medium text-zinc-100 mt-3 mb-1.5">{children}</h2>,
        h3:         ({ children }) => <h3 className="text-xs font-medium text-zinc-100 mt-2 mb-1">{children}</h3>,
        ul:         ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5 text-zinc-300">{children}</ul>,
        ol:         ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5 text-zinc-300">{children}</ol>,
        li:         ({ children }) => <li className="text-zinc-300">{children}</li>,
        strong:     ({ children }) => <strong className="font-medium text-zinc-100">{children}</strong>,
        em:         ({ children }) => <em className="text-zinc-200">{children}</em>,
        a:          ({ children, href }) => {
          const target = linkTarget(href);
          if (!target) return <span className="text-zinc-300">{children as ReactNode}</span>;
          return (
            <a href={target.href} target="_blank" rel="noreferrer noopener" title={target.href} className="text-teal-400 hover:underline">
              {children as ReactNode}
              <span className="ml-1 text-[10px] text-zinc-500">({target.host})</span>
            </a>
          );
        },
        img:        ({ alt }) => <span className="text-zinc-400 italic">[image: {alt || "untitled"}]</span>,
        code:       ({ className, children, ...props }) => {
          const isInline = !className?.includes("language-");
          if (isInline) return <code className="bg-zinc-800 text-teal-300 px-1 py-0.5 rounded font-mono text-[11px]">{children}</code>;
          return <code className={`${className ?? ""} font-mono text-[11px]`} {...props}>{children}</code>;
        },
        pre:        ({ children }) => <pre className="bg-zinc-950 border border-zinc-800 rounded-md p-2.5 my-2 overflow-x-auto text-[11px] leading-relaxed">{children}</pre>,
        table:      ({ children }) => <div className="my-2 overflow-x-auto"><table className="w-full text-[11px] border border-zinc-800 rounded">{children}</table></div>,
        thead:      ({ children }) => <thead className="bg-zinc-800/40">{children}</thead>,
        th:         ({ children }) => <th className="text-left px-2 py-1 border-b border-zinc-800 font-medium text-zinc-200">{children}</th>,
        td:         ({ children }) => <td className="px-2 py-1 border-t border-zinc-900/60 text-zinc-300">{children}</td>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-zinc-700 pl-3 my-2 text-zinc-400 italic">{children}</blockquote>,
        hr:         () => <hr className="my-3 border-zinc-800" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
