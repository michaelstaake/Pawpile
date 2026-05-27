import { useState } from "react";

type CodeBlockProps = {
  code: string;
  language?: string | null;
};

export default function CodeBlock({ code, language }: CodeBlockProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = code;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 2000);
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-black/10 bg-ink text-sand shadow-sm first:mt-0 last:mb-0">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-sand/55">
        <span>{language || "code"}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-sand/70 transition hover:bg-white/10 hover:text-sand"
          aria-label="Copy code"
          title="Copy code"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M6 2.75A1.75 1.75 0 0 0 4.25 4.5v8.75c0 .966.784 1.75 1.75 1.75h6.25A1.75 1.75 0 0 0 14 13.25V4.5a1.75 1.75 0 0 0-1.75-1.75H6Z" />
            <path d="M7.5 16.5c-.63 0-1.223-.163-1.738-.45a.75.75 0 0 0-.762 1.292A5.98 5.98 0 0 0 7.5 18h4A3.5 3.5 0 0 0 15 14.5v-7c0-.294-.036-.58-.104-.854a.75.75 0 1 0-1.456.358c.04.161.06.326.06.496v7A2 2 0 0 1 11.5 16.5h-4Z" />
          </svg>
          <span>{copyState === "copied" ? "Copied" : copyState === "error" ? "Retry" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-[13px] leading-6 text-sand/95">
        <code>{code}</code>
      </pre>
    </div>
  );
}