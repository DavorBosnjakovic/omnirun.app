import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Users2,
  CreditCard,
  BarChart3,
  Activity,
  FolderOpen,
  LayoutTemplate,
  ListChecks,
  Send,
  Plug,
  Smartphone,
  ScrollText,
  Server,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/users", label: "Users", icon: Users },
  { to: "/teams", label: "Teams", icon: Users2 },
  { to: "/subscriptions", label: "Subscriptions", icon: CreditCard },
  { to: "/usage", label: "Usage & Costs", icon: BarChart3 },
  { to: "/engagement", label: "Engagement", icon: Activity },
  { to: "/projects", label: "Projects", icon: FolderOpen },
  { to: "/templates", label: "Templates", icon: LayoutTemplate },
  { to: "/waitlist", label: "Waitlist", icon: ListChecks },
  { to: "/broadcast", label: "Broadcast", icon: Send },
  { to: "/integrations", label: "Integrations", icon: Plug },
  { to: "/devices", label: "Devices & Sync", icon: Smartphone },
  { to: "/audit", label: "Audit Log", icon: ScrollText },
  { to: "/system", label: "System", icon: Server },
];

const ACTIVE_GRADIENT =
  "linear-gradient(to right, rgba(45,184,122,0.28) 0%, rgba(45,184,122,0.14) 35%, rgba(45,184,122,0) 75%)";
const HOVER_BG = "#2F3238";

export default function Sidebar() {
  return (
    <div
      style={{
        width: 220,
        height: "100%",
        background: "#262A2F",
        borderRight: "1px solid #1E1E1E",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          padding: "14px 14px 8px",
          fontSize: 10,
          color: "#6B7280",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        Admin
      </div>

      <nav style={{ padding: "0 8px 16px", display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            style={({ isActive }) => ({
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              paddingLeft: 8,
              borderRadius: 6,
              fontSize: 13,
              fontFamily: "'Sora', sans-serif",
              color: isActive ? "#DCE0E4" : "#9CA3AF",
              background: isActive ? ACTIVE_GRADIENT : "transparent",
              textDecoration: "none",
              transition: "background 0.15s ease, color 0.15s ease",
              borderLeft: isActive ? "2px solid #2DB87A" : "2px solid transparent",
            })}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLAnchorElement;
              if (!el.style.background.includes("gradient")) {
                el.style.background = HOVER_BG;
                el.style.color = "#DCE0E4";
              }
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLAnchorElement;
              if (!el.style.background.includes("gradient")) {
                el.style.background = "transparent";
                el.style.color = "#9CA3AF";
              }
            }}
          >
            <item.icon size={15} strokeWidth={1.6} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div style={{ flex: 1 }} />

      <div
        style={{
          padding: "10px 14px",
          borderTop: "1px solid #1E1E1E",
          fontSize: 10,
          color: "#6B7280",
          lineHeight: 1.5,
        }}
      >
        omnium admin v0.1.0
      </div>
    </div>
  );
}