import { useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Components } from "react-markdown";

type MarkdownRendererProps = {
  content: string;
  className?: string;
};

type PreProps = {
  children: ReactNode;
  [key: string]: unknown;
};

type CodeProps = {
  children: ReactNode;
  className?: string;
  [key: string]: unknown;
};

export default function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const [copyStates, setCopyStates] = useState<Record<number, "idle" | "copied">>({});
  const codeRefs = useRef<Map<number, HTMLPreElement>>(new Map());
  let blockCounter = 0;

  const handleCopy = (index: number) => {
    const preEl = codeRefs.current.get(index);
    if (!preEl) return;

    const codeEl = preEl.querySelector(".hljs");
    const text = codeEl?.textContent || "";

    void navigator.clipboard.writeText(text).then(() => {
      setCopyStates((prev) => ({ ...prev, [index]: "copied" }));
      setTimeout(() => {
        setCopyStates((prev) => ({ ...prev, [index]: "idle" }));
      }, 2000);
    });
  };

  const components: Components = {
    pre: ({ children, ...rest }: PreProps) => {
      const index = blockCounter++;
      return (
        <pre
          ref={(el) => {
            if (el) codeRefs.current.set(index, el);
            else codeRefs.current.delete(index);
          }}
          className="my-3 w-full max-w-full overflow-hidden rounded-2xl border border-black/10 bg-ink text-sand shadow-sm first:mt-0 last:mb-0"
          {...rest}
        >
          <div className="max-h-[24rem] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-ink/95 px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-sand/55 backdrop-blur-sm">
              <span>code</span>
              <button
                type="button"
                onClick={() => handleCopy(index)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-sand/70 transition hover:bg-white/10 hover:text-sand"
                aria-label="Copy code"
                title="Copy code"
              >
                <i className="bi bi-clipboard text-[14px] leading-none" aria-hidden="true"></i>
                <span>{copyStates[index] === "copied" ? "Copied" : "Copy"}</span>
              </button>
            </div>
            {children}
          </div>
        </pre>
      );
    },
    code: ({ children, className, ...rest }: CodeProps) => {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    },
  };

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
