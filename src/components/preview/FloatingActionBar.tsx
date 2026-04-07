import { Palette, Copy, Bug, Wand2, X, MousePointerClick, Send } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useElementSelectionStore, type SelectedElement } from "../../stores/elementSelectionStore";
import { themes } from "../../config/themes";

interface FloatingActionBarProps {
  iframeRect: DOMRect | null;
}

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function FloatingActionBar({ iframeRect }: FloatingActionBarProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const { selectedElements, clearSelection, setPendingChatInput, setPendingImage, setPendingElementContext } = useElementSelectionStore();
  const [customInput, setCustomInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const count = selectedElements.length;
  if (count === 0 || !iframeRect) return null;

  const primary = selectedElements[0];
  const isMulti = count > 1;

  // Position: right side of preview, near the selected element
  const barTop = Math.min(
    iframeRect.top + primary.rect.top + primary.rect.height + 12,
    window.innerHeight - 260
  );
  const barRight = window.innerWidth - iframeRect.right + 12;

  function describeElement(el: SelectedElement): string {
    return `- <${el.tagName}> "${el.textContent}" (${el.selector}) — color=${el.computedStyles.color}, bg=${el.computedStyles.backgroundColor}, font=${el.computedStyles.fontFamily}`;
  }

  function describeSelection(): string {
    if (isMulti) {
      const descs = selectedElements.map((el) => describeElement(el));
      return `[ELEMENTS SELECTED]\n${descs.join("\n")}\n[/ELEMENTS SELECTED]`;
    }
    return `[ELEMENT SELECTED]\nSelector: ${primary.selector}\nTag: <${primary.tagName}>\nText: "${primary.textContent}"\nCurrent styles: color=${primary.computedStyles.color}, bg=${primary.computedStyles.backgroundColor}, font=${primary.computedStyles.fontFamily}, size=${primary.computedStyles.fontSize}, weight=${primary.computedStyles.fontWeight}, padding=${primary.computedStyles.padding}, border-radius=${primary.computedStyles.borderRadius}\n[/ELEMENT SELECTED]`;
  }

  // Save context separately (hidden from user), put only instruction in chat input
  function handleAction(instruction: string) {
    const context = describeSelection();
    clearSelection();
    setPendingElementContext(context);
    setPendingChatInput(instruction);
  }

  function sendWithImage(base64: string, mimeType: string) {
    const context = describeSelection();
    clearSelection();
    setPendingElementContext(context);
    setPendingImage({ base64, mimeType });
    setPendingChatInput("Match the style of the reference image. Keep the text content unchanged.");
  }

  function handleCustomSend() {
    if (!customInput.trim()) return;
    handleAction(customInput.trim());
    setCustomInput("");
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !ALLOWED_IMAGE_TYPES.includes(file.type)) return;
    const mimeType = file.type;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      if (base64) sendWithImage(base64, mimeType);
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Paste listener: Ctrl+V image while bar is open
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const blob = items[i].getAsFile();
          if (!blob) continue;
          const mimeType = items[i].type;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const base64 = dataUrl.split(",")[1];
            if (base64) sendWithImage(base64, mimeType);
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    }
    window.addEventListener("paste", handlePaste, true);
    return () => window.removeEventListener("paste", handlePaste, true);
  });

  const elementLabel = isMulti
    ? `${count} elements selected`
    : `<${primary.tagName}>${primary.textContent ? ` "${primary.textContent.slice(0, 25)}${primary.textContent.length > 25 ? "…" : ""}"` : ""}`;

  return (
    <div
      className="fixed z-[10001] flex flex-col gap-2"
      style={{
        top: `${barTop}px`,
        right: `${barRight}px`,
        width: "280px",
        background: "#1a1c20",
        border: "1px solid #2DB87A",
        borderRadius: "10px",
        padding: "12px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(45,184,122,0.2)",
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-300 truncate" style={{ maxWidth: "230px" }} title={primary.selector}>
          {elementLabel}
        </span>
        <button onClick={clearSelection} className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-600 text-gray-200 hover:bg-[#2DB87A] hover:border-[#2DB87A] hover:text-white transition-all duration-150"
        >
          📷 Make it look like this
        </button>
        <button
          onClick={() => handleAction("This element looks wrong. Inspect its styles, check for overflow, z-index, or inheritance issues, and fix any problems.")}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-600 text-gray-200 hover:bg-[#2DB87A] hover:border-[#2DB87A] hover:text-white transition-all duration-150"
        >
          <Bug size={13} />
          Debug this
        </button>
      </div>

      {/* Paste hint */}
      <div className="text-[10px] text-gray-500">
        💡 Ctrl+V to paste a reference screenshot
      </div>

      {/* Free-form input */}
      <div className="flex gap-1.5 mt-1">
        <input
          ref={inputRef}
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCustomSend();
            if (e.key === "Escape") clearSelection();
          }}
          placeholder="Or type instruction..."
          className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-gray-600 bg-[#2a2c30] text-gray-200 outline-none focus:border-[#2DB87A] placeholder-gray-500"
        />
        <button
          onClick={handleCustomSend}
          disabled={!customInput.trim()}
          className={`px-3 py-1.5 rounded-lg transition-all duration-150 ${
            customInput.trim()
              ? "bg-[#2DB87A] text-white hover:bg-[#25a06a]"
              : "bg-gray-700 text-gray-500"
          }`}
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}

export default FloatingActionBar;