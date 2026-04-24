import { useState, FormEvent } from "react";
import { useAuthStore } from "../../stores/authStore";

export default function LoginPage() {
  const { signIn } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await signIn(email.trim(), password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error || "Login failed");
    }
  }

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
          maxWidth: 400,
          padding: 28,
          background: "rgba(56, 60, 67, 0.55)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(85, 91, 99, 0.5)",
          borderRadius: 12,
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 300,
              letterSpacing: "0.05em",
              marginBottom: 4,
            }}
          >
            omnirun admin
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#9CA3AF",
              letterSpacing: "0.05em",
            }}
          >
            Internal access only
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label
              htmlFor="email"
              style={{
                display: "block",
                fontSize: 12,
                color: "#9CA3AF",
                marginBottom: 6,
              }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label
              htmlFor="password"
              style={{
                display: "block",
                fontSize: 12,
                color: "#9CA3AF",
                marginBottom: 6,
              }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={inputStyle}
            />
          </div>

          {error && (
            <div
              style={{
                marginBottom: 16,
                padding: "10px 12px",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: 8,
                color: "#FCA5A5",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !email || !password}
            style={{
              width: "100%",
              padding: "10px 14px",
              background: "#2DB87A",
              color: "#FFFFFF",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "'Sora', sans-serif",
              cursor: submitting || !email || !password ? "not-allowed" : "pointer",
              opacity: submitting || !email || !password ? 0.6 : 1,
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => {
              if (!submitting && email && password) {
                (e.target as HTMLButtonElement).style.background = "#5DE8A0";
              }
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.background = "#2DB87A";
            }}
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div
          style={{
            marginTop: 20,
            fontSize: 11,
            color: "#6B7280",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          Access restricted to authorized administrators.
          <br />
          All actions are logged.
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  background: "#262A2F",
  border: "1px solid #4A4F57",
  borderRadius: 8,
  color: "#DCE0E4",
  fontSize: 14,
  fontFamily: "'Sora', sans-serif",
  outline: "none",
  boxSizing: "border-box",
};