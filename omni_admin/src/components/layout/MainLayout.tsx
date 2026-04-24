import { Routes, Route, Navigate } from "react-router-dom";
import { Construction } from "lucide-react";
import Topbar from "../topbar/Topbar";
import Sidebar from "./Sidebar";
import OverviewPage from "../overview/OverviewPage";
import UsersPage from "../users/UsersPage";
import AuditLogPage from "../audit/AuditLogPage";
import WaitlistPage from "../waitlist/WaitlistPage";
import BroadcastPage from "../broadcast/BroadcastPage";

export default function MainLayout() {
  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        background: "#2F3238",
        color: "#DCE0E4",
        fontFamily: "'Sora', sans-serif",
        overflow: "hidden",
      }}
    >
      <Topbar />
      <div
        style={{
          flex: 1,
          display: "flex",
          minHeight: 0,
        }}
      >
        <Sidebar />
        <main
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "auto",
          }}
        >
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/waitlist" element={<WaitlistPage />} />
            <Route path="/broadcast" element={<BroadcastPage />} />
            <Route path="/audit" element={<AuditLogPage />} />

            {/* Placeholders for later phases */}
            <Route path="/teams" element={<ComingSoon title="Teams" />} />
            <Route path="/subscriptions" element={<ComingSoon title="Subscriptions" />} />
            <Route path="/usage" element={<ComingSoon title="Usage & Costs" />} />
            <Route path="/engagement" element={<ComingSoon title="Engagement" />} />
            <Route path="/projects" element={<ComingSoon title="Projects" />} />
            <Route path="/templates" element={<ComingSoon title="Templates" />} />
            <Route path="/integrations" element={<ComingSoon title="Integrations" />} />
            <Route path="/devices" element={<ComingSoon title="Devices & Sync" />} />
            <Route path="/system" element={<ComingSoon title="System" />} />

            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "#9CA3AF",
      }}
    >
      <Construction size={32} strokeWidth={1.5} style={{ marginBottom: 14 }} />
      <div style={{ fontSize: 18, color: "#DCE0E4", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13 }}>Coming soon</div>
    </div>
  );
}