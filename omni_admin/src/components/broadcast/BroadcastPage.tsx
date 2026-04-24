import { Send, Users, MailOpen, Eye } from "lucide-react";

export default function BroadcastPage() {
  return (
    <div style={{ padding: "24px 28px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 500,
              color: "#DCE0E4",
              margin: 0,
              marginBottom: 4,
            }}
          >
            Broadcast
          </h1>
          <div style={{ fontSize: 12, color: "#9CA3AF" }}>
            Send announcements to your users and waitlist
          </div>
        </div>

        <button
          disabled
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            background: "#2DB87A",
            border: "none",
            borderRadius: 6,
            color: "#0B1510",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "'Sora', sans-serif",
            cursor: "not-allowed",
            opacity: 0.35,
          }}
          title="Add recipients and content first"
        >
          <Send size={12} strokeWidth={2} />
          Send broadcast
        </button>
      </div>

      {/* Three-column layout:
          left  = recipients & filters
          mid   = composer (block list)
          right = live preview */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "280px 1fr 420px",
          gap: 14,
          alignItems: "start",
        }}
      >
        {/* ---------- Recipients ---------- */}
        <Panel icon={<Users size={13} strokeWidth={1.6} />} title="Recipients">
          <PlaceholderText>
            Pick a list (Users or Waitlist) and apply filters. Recipient count will appear here.
          </PlaceholderText>
        </Panel>

        {/* ---------- Composer ---------- */}
        <Panel icon={<MailOpen size={13} strokeWidth={1.6} />} title="Compose">
          <PlaceholderText>
            Subject, preheader, and content blocks (text, images, buttons, dividers). Add blocks and reorder with arrows.
          </PlaceholderText>
        </Panel>

        {/* ---------- Preview ---------- */}
        <Panel icon={<Eye size={13} strokeWidth={1.6} />} title="Preview">
          <PlaceholderText>
            Live preview of the email with omnirun branding.
          </PlaceholderText>
        </Panel>
      </div>
    </div>
  );
}

// -------- Subcomponents --------

function Panel({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#262A2F",
        border: "1px solid #383C43",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "10px 14px",
          borderBottom: "1px solid #383C43",
          fontSize: 11,
          fontWeight: 600,
          color: "#9CA3AF",
          letterSpacing: "0.03em",
          textTransform: "uppercase",
          background: "#2F3238",
        }}
      >
        <span style={{ color: "#6B7280" }}>{icon}</span>
        {title}
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

function PlaceholderText({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "30px 14px",
        textAlign: "center",
        color: "#6B7280",
        fontSize: 12,
        lineHeight: 1.6,
        border: "1px dashed #383C43",
        borderRadius: 6,
      }}
    >
      {children}
    </div>
  );
}