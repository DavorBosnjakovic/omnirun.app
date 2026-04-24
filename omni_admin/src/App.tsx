import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/authStore";
import LoginPage from "./components/auth/LoginPage";
import NotAuthorizedPage from "./components/auth/NotAuthorizedPage";
import MainLayout from "./components/layout/MainLayout";

function App() {
  const { user, isAdmin, isLoading, checkSession } = useAuthStore();

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // While checking session on startup, show nothing (avoids login flash)
  if (isLoading) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#2F3238",
          color: "#9CA3AF",
          fontFamily: "'Sora', sans-serif",
          fontSize: 14,
        }}
      >
        Loading...
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Logged in but not an admin
  if (!isAdmin) {
    return <NotAuthorizedPage />;
  }

  // Logged in and admin — full app
  return (
    <Routes>
      <Route path="/*" element={<MainLayout />} />
    </Routes>
  );
}

export default App;