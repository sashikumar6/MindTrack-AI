import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/AuthContext.jsx";
import AppShell from "./components/AppShell.jsx";
import Login from "./pages/Login.jsx";
import Overview from "./pages/Overview.jsx";
import VoiceAgentPage from "./pages/VoiceAgentPage.jsx";
import HistoryPage from "./pages/HistoryPage.jsx";
import JobTrackerPage from "./pages/JobTrackerPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <CenteredMessage>Loading…</CenteredMessage>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function CenteredMessage({ children }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-secondary)",
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<Overview />} />
            <Route path="voice" element={<VoiceAgentPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="jobs" element={<JobTrackerPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
