import { ShieldAlert } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";

export default function NotAuthorizedPage() {
  const { user, signOut } = useAuthStore();

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        background: "#2F3238",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Sora', sans-serif",
        color: "#DCE0E4",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          padding: 32,
          background: "rgba(56, 60, 67, 0.55)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(85, 91, 99, 0.5)",
          borderRadius: 12,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 18px",
          }}
        >
          <ShieldAlert size={26} color="#FCA5A5" strokeWidth={1.5} />
        </div>

        <div
          style={{
            fontSize: 18,
            fontWeight: 500,
            marginBottom: 8,
          }}
        >
          Not authorized
        </div>

        <div
          style={{
            fontSize: 13,
            color: "#9CA3AF",
            lineHeight: 1.6,
            marginBottom: 20,
          }}
        >
          This account does not have admin access.
          {user?.email && (
            <>
              <br />
              Signed in as <span style={{ color: "#DCE0E4" }}>{user.email}</span>
            </>
          )}
        </div>

        <button
          onClick={signOut}
          style={{
            padding: "9px 20px",
            background: "transparent",
            color: "#DCE0E4",
            border: "1px solid #555B63",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "'Sora', sans-serif",
            cursor: "pointer",
            transition: "background 0.15s ease",
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLButtonElement).style.background = "#383C43";
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLButtonElement).style.background = "transparent";
          }}
        >
          Sign out
        </button>

        <div
          style={{
            marginTop: 24,
            fontSize: 11,
            color: "#6B7280",
            lineHeight: 1.5,
          }}
        >
          If you believe this is a mistake,
          <br />
          contact an existing admin to be granted access.
        </div>
      </div>
    </div>
  );
}