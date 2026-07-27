import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "lucide-react";
import { openUrl } from "@/lib/native";

/**
 * 応答の Markdown 描画。CommonMark + GFM（表・打ち消し・タスクリスト・自動リンク）を
 * react-markdown / remark-gfm でまるごと処理する。生HTMLは通さない（rehype-raw を入れない）。
 *
 * ストリーミング途中は記法が閉じていないことがあるが、パーサ側が部分入力を
 * そのまま流してくれるので、行が完成した時点で自然に整う。
 */

const link = (href?: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  if (href) openUrl(href);
};

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="text-[15px] leading-[1.75] [word-break:break-word]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,

          a: ({ href, children }) => (
            <a
              href={href}
              onClick={link(href)}
              className="inline items-baseline font-medium text-orange underline decoration-orange/35 underline-offset-2"
            >
              {children}
              <ExternalLink size={11} className="mb-[2px] ml-0.5 inline shrink-0 opacity-60" />
            </a>
          ),

          strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => <del className="text-[var(--muted)] line-through">{children}</del>,

          h1: ({ children }) => <h1 className="mb-2 mt-4 text-[19px] font-bold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-[17px] font-bold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-3.5 text-[15px] font-bold first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="mb-1.5 mt-3 text-[15px] font-semibold first:mt-0">{children}</h4>,
          h5: ({ children }) => <h5 className="mb-1 mt-3 text-[14px] font-semibold first:mt-0">{children}</h5>,
          h6: ({ children }) => (
            <h6 className="eyebrow mb-1 mt-3 text-[var(--muted)] first:mt-0">{children}</h6>
          ),

          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5 marker:text-orange first:mt-0 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5 marker:font-mono marker:text-[13px] marker:text-orange first:mt-0 last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children, className }) =>
            // タスクリスト（- [ ] / - [x]）はマーカーを消してチェックボックスを見せる
            className?.includes("task-list-item") ? (
              <li className="flex list-none items-start gap-2 -ml-5">{children}</li>
            ) : (
              <li className="pl-0.5">{children}</li>
            ),
          input: ({ checked, type }) =>
            type === "checkbox" ? (
              <span
                className={`mt-[5px] grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[4px] border text-[10px] leading-none ${
                  checked ? "border-orange bg-orange text-white" : "border-line"
                }`}
              >
                {checked ? "✓" : ""}
              </span>
            ) : null,

          blockquote: ({ children }) => (
            <blockquote className="my-2.5 border-l-[3px] border-orange/40 pl-3 text-[var(--muted)]">
              {children}
            </blockquote>
          ),

          hr: () => <hr className="my-4 border-0 border-t border-line" />,

          code: ({ className, children }) => {
            const block = /language-/.test(className || "") || String(children).includes("\n");
            if (!block)
              return (
                <code className="rounded-[5px] bg-ink/[.06] px-1 py-0.5 font-mono text-[13px]">{children}</code>
              );
            return (
              <code className="block overflow-x-auto whitespace-pre font-mono text-[12.5px] leading-relaxed">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2.5 overflow-x-auto rounded-xl border border-line bg-card p-3">{children}</pre>
          ),

          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-line">
              <table className="w-full border-collapse text-[13.5px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-stub">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-line px-3 py-2 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border-b border-line px-3 py-2 align-top">{children}</td>,

          img: ({ src, alt }) => (
            <img src={src} alt={alt || ""} className="my-2 max-w-full rounded-xl border border-line" />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
