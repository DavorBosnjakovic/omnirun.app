import { useState, useRef, useEffect } from "react";
import { Minus, Square, X, LogOut, ChevronDown } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAuthStore } from "../../stores/authStore";

const appWindow = getCurrentWindow();

export default function Topbar() {
  const { user, profile, signOut } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuOpen]);

  const displayName = profile?.display_name || user?.email?.split("@")[0] || "Admin";
  const initials = getInitials(displayName);

  return (
    <div
      data-tauri-drag-region
      style={{
        height: 44,
        background: "#262A2F",
        borderBottom: "1px solid #1E1E1E",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 8px 0 14px",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {/* Left: Brand */}
      <div
        data-tauri-drag-region
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flex: 1,
          minWidth: 0,
        }}
      >
        <BrandMark />
        <div
          data-tauri-drag-region
          style={{
            fontSize: 13,
            fontWeight: 300,
            letterSpacing: "0.05em",
            color: "#DCE0E4",
          }}
        >
          omnirun{" "}
          <span style={{ color: "#9CA3AF", marginLeft: 2 }}>admin</span>
        </div>
      </div>

      {/* Right: user menu + window controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div ref={menuRef} style={{ position: "relative", marginRight: 8 }}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 10px 4px 4px",
              background: menuOpen ? "#383C43" : "transparent",
              border: "none",
              borderRadius: 6,
              color: "#DCE0E4",
              fontSize: 12,
              fontFamily: "'Sora', sans-serif",
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => {
              if (!menuOpen)
                (e.currentTarget as HTMLButtonElement).style.background =
                  "#383C43";
            }}
            onMouseLeave={(e) => {
              if (!menuOpen)
                (e.currentTarget as HTMLButtonElement).style.background =
                  "transparent";
            }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "#2DB87A",
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {initials}
            </div>
            <span style={{ color: "#9CA3AF" }}>{user?.email}</span>
            <ChevronDown size={14} color="#9CA3AF" />
          </button>

          {menuOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                right: 0,
                width: 240,
                background: "#262A2F",
                border: "1px solid #555B63",
                borderRadius: 8,
                padding: 6,
                zIndex: 1000,
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              }}
            >
              <div
                style={{
                  padding: "8px 10px 10px",
                  borderBottom: "1px solid #383C43",
                  marginBottom: 4,
                }}
              >
                <div style={{ fontSize: 13, color: "#DCE0E4", marginBottom: 2 }}>
                  {displayName}
                </div>
                <div style={{ fontSize: 11, color: "#9CA3AF" }}>
                  {user?.email}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 10,
                    color: "#2DB87A",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                  }}
                >
                  Admin
                </div>
              </div>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  signOut();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "8px 10px",
                  background: "transparent",
                  border: "none",
                  borderRadius: 6,
                  color: "#DCE0E4",
                  fontSize: 13,
                  fontFamily: "'Sora', sans-serif",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.background =
                    "#383C43")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.background =
                    "transparent")
                }
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          )}
        </div>

        {/* Window controls */}
        <WindowButton onClick={() => appWindow.minimize()}>
          <Minus size={14} strokeWidth={1.5} />
        </WindowButton>
        <WindowButton onClick={() => appWindow.toggleMaximize()}>
          <Square size={11} strokeWidth={1.5} />
        </WindowButton>
        <WindowButton onClick={() => appWindow.close()} danger>
          <X size={14} strokeWidth={1.5} />
        </WindowButton>
      </div>
    </div>
  );
}

function WindowButton({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 36,
        height: 32,
        background: "transparent",
        border: "none",
        color: "#DCE0E4",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        borderRadius: 4,
        transition: "background 0.15s ease",
      }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLButtonElement).style.background = danger
          ? "#EF4444"
          : "#383C43")
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLButtonElement).style.background = "transparent")
      }
    >
      {children}
    </button>
  );
}

// Simple SVG logo mark - silver ring with green orbiting dot.
// Mirrors the omnirun brand mark.
function BrandMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#D1D5DB" />
          <stop offset="50%" stopColor="#B0B6BF" />
          <stop offset="100%" stopColor="#6B7280" />
        </linearGradient>
        <radialGradient id="dot">
          <stop offset="0%" stopColor="#5DE8A0" />
          <stop offset="100%" stopColor="#2DB87A" />
        </radialGradient>
      </defs>
      <path
        d="M 20 4 A 16 16 0 1 0 33 11"
        stroke="url(#ring)"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="31" cy="9" r="3.2" fill="url(#dot)" />
    </svg>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}