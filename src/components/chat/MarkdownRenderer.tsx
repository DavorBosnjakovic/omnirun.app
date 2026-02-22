import { useCallback, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js";
import { Save } from "lucide-react";
import type { Theme } from "../../config/themes";

interface MarkdownRendererProps {
  content: string;
  theme: Theme;
  themeKey: string;
  projectPath: string | null;
  onSaveCodeBlock?: (code: string, filename: string) => void;
}

function MarkdownRenderer({ content, theme: t, themeKey, projectPath, onSaveCodeBlock }: MarkdownRendererProps) {
  const codeBlockRefs = useRef<Map<number, HTMLElement>>(new Map());
  const blockCounter = useRef(0);

  // Reset counter on each render
  blockCounter.current = 0;

  // Highlight all code blocks after render
  useEffect(() => {
    codeBlockRefs.current.forEach((el) => {
      if (!el.dataset.highlighted) {
        hljs.highlightElement(el);
      }
    });
  });

  const handleCopy = useCallback((code: string) => {
    navigator.clipboard.writeText(code);
  }, []);

  const handleSave = useCallback((code: string, detectedFilename: string) => {
    if (!onSaveCodeBlock) return;
    if (detectedFilename) {
      onSaveCodeBlock(code, detectedFilename);
    } else {
      const name = prompt("Save as (e.g., index.html):");
      if (name) onSaveCodeBlock(code, name);
    }
  }, [onSaveCodeBlock]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // ── Code blocks and inline code ──────────────────────────
        code({ node, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const codeString = String(children).replace(/\n$/, "");

          // Inline code (no language class, no newlines, short)
          const isInline = !match && !codeString.includes("\n") && codeString.length < 200;

          if (isInline) {
            return (
              <code
                className={`inline-code px-1.5 py-0.5 ${t.borderRadius} text-sm`}
                style={{ fontFamily: "monospace" }}
                {...props}
              >
                {children}
              </code>
            );
          }

          // Full code block
          const language = match ? match[1] : "";
          const blockId = blockCounter.current++;

          // Try to detect filename from comment in code
          let filename = "";
          const filenameMatch =
            codeString.match(/^\/\/\s*filename:\s*(.+)/m) ||
            codeString.match(/^<!--\s*filename:\s*(.+?)\s*-->/m) ||
            codeString.match(/^#\s*filename:\s*(.+)/m);
          if (filenameMatch) {
            filename = filenameMatch[1].trim();
          }

          return (
            <div className={`my-2 code-block-wrapper ${t.borderRadius} overflow-hidden`}>
              <div className={`flex justify-between items-center px-3 py-1 code-block-header`}>
                <span className={`text-xs ${t.colors.textMuted}`}>{language || "code"}</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleCopy(codeString)}
                    className={`text-xs px-2 py-1 ${t.borderRadius} ${t.colors.textMuted} hover:${t.colors.text}`}
                  >
                    Copy
                  </button>
                  {projectPath && onSaveCodeBlock && (
                    <button
                      onClick={() => handleSave(codeString, filename)}
                      className={`text-xs px-2 py-1 ${t.borderRadius} flex items-center gap-1 ${t.colors.accent} ${themeKey === "highContrast" ? "text-black" : "text-white"}`}
                    >
                      <Save size={12} />
                      {filename ? `Save ${filename}` : "Save to file"}
                    </button>
                  )}
                </div>
              </div>
              <pre className="p-3 text-sm overflow-x-auto select-text !m-0">
                <code
                  ref={(el) => {
                    if (el) codeBlockRefs.current.set(blockId, el);
                  }}
                  className={language ? `language-${language}` : ""}
                  style={{ fontFamily: "monospace" }}
                  {...props}
                >
                  {codeString}
                </code>
              </pre>
            </div>
          );
        },

        // ── Block elements ───────────────────────────────────────
        p({ children }) {
          return <p className="mb-2 last:mb-0">{children}</p>;
        },

        h1({ children }) {
          return <h1 className="text-xl font-bold mb-2 mt-3 first:mt-0">{children}</h1>;
        },

        h2({ children }) {
          return <h2 className="text-lg font-bold mb-2 mt-3 first:mt-0">{children}</h2>;
        },

        h3({ children }) {
          return <h3 className="text-base font-bold mb-1 mt-2 first:mt-0">{children}</h3>;
        },

        h4({ children }) {
          return <h4 className="text-sm font-bold mb-1 mt-2 first:mt-0">{children}</h4>;
        },

        // ── Lists ────────────────────────────────────────────────
        ul({ children }) {
          return <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>;
        },

        ol({ children }) {
          return <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>;
        },

        li({ children }) {
          return <li className="ml-2">{children}</li>;
        },

        // ── Links ────────────────────────────────────────────────
        a({ href, children }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              {children}
            </a>
          );
        },

        // ── Blockquote ───────────────────────────────────────────
        blockquote({ children }) {
          return (
            <blockquote className={`border-l-3 pl-3 my-2 ${t.colors.textMuted} italic blockquote-border`}>
              {children}
            </blockquote>
          );
        },

        // ── Horizontal rule ──────────────────────────────────────
        hr() {
          return <hr className={`my-3 ${t.colors.border} border-t`} />;
        },

        // ── Table ────────────────────────────────────────────────
        table({ children }) {
          return (
            <div className="overflow-x-auto my-2">
              <table className={`min-w-full text-sm ${t.colors.border} border`}>
                {children}
              </table>
            </div>
          );
        },

        thead({ children }) {
          return <thead className="table-header-bg">{children}</thead>;
        },

        th({ children }) {
          return (
            <th className={`px-3 py-1.5 text-left text-xs font-semibold ${t.colors.border} border`}>
              {children}
            </th>
          );
        },

        td({ children }) {
          return (
            <td className={`px-3 py-1.5 text-sm ${t.colors.border} border`}>
              {children}
            </td>
          );
        },

        // ── Other inline ─────────────────────────────────────────
        strong({ children }) {
          return <strong className="font-bold">{children}</strong>;
        },

        em({ children }) {
          return <em className="italic">{children}</em>;
        },

        del({ children }) {
          return <del className="line-through opacity-60">{children}</del>;
        },

        // ── Images in markdown ───────────────────────────────────
        img({ src, alt }) {
          return (
            <img
              src={src}
              alt={alt || ""}
              className={`max-w-full h-auto ${t.borderRadius} my-2`}
            />
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export default MarkdownRenderer;