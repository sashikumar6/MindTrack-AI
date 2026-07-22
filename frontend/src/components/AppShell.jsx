import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/AuthContext.jsx";

const TABS = [
  { to: "/", label: "Overview", end: true },
  { to: "/voice", label: "Voice Agent" },
  { to: "/history", label: "History" },
  { to: "/jobs", label: "Job Tracker" },
  { to: "/settings", label: "Settings" },
];

export default function AppShell() {
  const { user } = useAuth();

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.wordmark}>MindTrack AI</div>
        <nav style={styles.nav}>
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              style={({ isActive }) => ({ ...styles.navItem, ...(isActive ? styles.navItemActive : {}) })}
            >
              {t.label}
            </NavLink>
          ))}
          {user ? (
            user.picture_url ? (
              <img src={user.picture_url} alt="" style={styles.avatar} referrerPolicy="no-referrer" />
            ) : (
              <span style={styles.avatarFallback}>{(user.name || user.email || "?")[0].toUpperCase()}</span>
            )
          ) : null}
        </nav>
      </header>

      <main style={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

const styles = {
  shell: {
    minHeight: "100vh",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "22px 56px",
    borderBottom: "1px solid var(--border)",
    position: "sticky",
    top: 0,
    background: "rgba(6,7,10,0.9)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    zIndex: 20,
    flexWrap: "wrap",
    gap: 12,
  },
  wordmark: {
    fontSize: 17,
    fontWeight: 600,
    letterSpacing: "-0.01em",
  },
  nav: {
    display: "flex",
    alignItems: "center",
    gap: 30,
    overflowX: "auto",
  },
  navItem: {
    fontSize: 14,
    color: "var(--text-secondary)",
    fontWeight: 400,
    textDecoration: "none",
    whiteSpace: "nowrap",
    transition: "color 160ms",
  },
  navItemActive: {
    color: "var(--text-primary)",
    fontWeight: 600,
  },
  avatar: { width: 28, height: 28, borderRadius: "50%", marginLeft: 4 },
  avatarFallback: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    color: "var(--text-secondary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 600,
    marginLeft: 4,
  },
  main: {
    maxWidth: 1180,
    margin: "0 auto",
    padding: "48px 56px 100px",
    animation: "fadeUp 500ms ease both",
  },
};
