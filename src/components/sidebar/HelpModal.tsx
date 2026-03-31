import { useState, useEffect, useCallback } from "react";

// ─── Icons (inline SVGs to avoid extra dependencies) ───────────────────────

const IconX = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconBook = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const IconMessageCircle = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
  </svg>
);

const IconBug = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="m8 2 1.88 1.88" />
    <path d="M14.12 3.88 16 2" />
    <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
    <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z" />
    <path d="M12 20v-9" />
    <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
    <path d="M6 13H2" />
    <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
    <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
    <path d="M22 13h-4" />
    <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
  </svg>
);

const IconExternalLink = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

// ─── Types ─────────────────────────────────────────────────────────────────

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Help Items ────────────────────────────────────────────────────────────

const helpItems = [
  {
    icon: <IconMessageCircle />,
    label: "FAQ",
    description: "Common questions answered",
    action: "link" as const,
    href: "https://omnirun.app/faq",
  },
  {
    icon: <IconBook />,
    label: "Documentation",
    description: "Guides, features & how-tos",
    action: "link" as const,
    href: "https://omnirun.app/docs",
  },
  {
    icon: <IconBug />,
    label: "Report a Bug",
    description: "Let us know what went wrong",
    action: "email" as const,
    href: "mailto:bugreports@omnirun.app?subject=Bug%20Report&body=%0A%0A---%0AApp%20version%3A%20%0AOS%3A%20%0ASteps%20to%20reproduce%3A%0A1.%20%0A2.%20%0A3.%20",
  },
];

// ─── Component ─────────────────────────────────────────────────────────────

export default function HelpModal({ isOpen, onClose }: HelpModalProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const handleItemClick = (item: (typeof helpItems)[number]) => {
    // For Tauri: use window.__TAURI__.shell.open() if available,
    // otherwise fall back to window.open / window.location
    const openExternal = (url: string) => {
      try {
        // Tauri v1
        if ((window as any).__TAURI__?.shell?.open) {
          (window as any).__TAURI__.shell.open(url);
          return;
        }
        // Tauri v2
        if ((window as any).__TAURI__?.opener?.openUrl) {
          (window as any).__TAURI__.opener.openUrl(url);
          return;
        }
      } catch {
        // fall through
      }

      if (item.action === "email") {
        window.location.href = url;
      } else {
        window.open(url, "_blank", "noopener");
      }
    };

    openExternal(item.href);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-30 flex items-center justify-center pointer-events-none">
        <div
          className="pointer-events-auto w-[360px] rounded-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150"
          style={{
            backgroundColor: "rgba(30, 33, 38, 0.75)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            boxShadow: "0 24px 48px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05) inset",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.08)" }}
          >
            <h2
              className="text-base font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              Help
            </h2>
            <button
              onClick={onClose}
              className="flex items-center justify-center w-8 h-8 rounded-md transition-colors duration-150 cursor-pointer"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.12)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              <IconX />
            </button>
          </div>

          {/* Items */}
          <div className="p-3 flex flex-col gap-1">
            {helpItems.map((item, i) => (
              <button
                key={item.label}
                onClick={() => handleItemClick(item)}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                className="flex items-center gap-3.5 w-full px-3 py-3 rounded-lg text-left transition-colors duration-150 cursor-pointer"
                style={{
                  backgroundColor:
                    hoveredIndex === i ? "rgba(255,255,255,0.1)" : "transparent",
                }}
              >
                {/* Icon */}
                <div
                  className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.08)",
                    color: "var(--accent)",
                  }}
                >
                  {item.icon}
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div
                    className="text-sm font-medium"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {item.label}
                  </div>
                  <div
                    className="text-xs mt-0.5"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {item.description}
                  </div>
                </div>

                {/* External link indicator */}
                <div
                  className="shrink-0 opacity-0 transition-opacity duration-150"
                  style={{
                    color: "var(--text-muted)",
                    opacity: hoveredIndex === i ? 0.7 : 0,
                  }}
                >
                  <IconExternalLink />
                </div>
              </button>
            ))}
          </div>

          {/* Footer */}
          <div
            className="px-5 py-3 text-center"
            style={{
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Omnirun v0.1.0
            </span>
          </div>
        </div>
      </div>
    </>
  );
}