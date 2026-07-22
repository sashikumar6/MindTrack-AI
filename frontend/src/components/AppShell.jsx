import { NavLink, Outlet } from "react-router-dom";

const TABS = [
  { to: "/", label: "Overview", end: true },
  { to: "/voice", label: "Talk It Out" },
  { to: "/companion", label: "Customize Your Buddy" },
  { to: "/history", label: "History" },
  { to: "/jobs", label: "Job Tracker" },
  { to: "/settings", label: "Settings" },
];

export function AppHeader() {
  return (
    <header className="app-header">
      <NavLink to="/" className="app-wordmark">MindTrack AI</NavLink>
      <nav className="app-nav" aria-label="Primary navigation">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => `app-nav-item${isActive ? " active" : ""}`}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

export default function AppShell() {
  return (
    <div className="app-shell">
      <AppHeader />

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
