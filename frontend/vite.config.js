import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Node-side env var (not import.meta.env -- this file runs in Node, not the
// browser). Overridden in docker-compose to the backend container's service
// name; defaults to localhost for running the frontend dev server directly
// against a locally-running backend.
const BACKEND = process.env.VITE_PROXY_TARGET || "http://localhost:8000";

// Proxying these paths makes the browser see same-origin requests in dev,
// matching prod (FastAPI serves the built frontend from the same origin via
// StaticFiles). That sidesteps cross-site cookie/SameSite issues entirely
// instead of fighting them -- the session cookie set by /auth/callback just
// works the same way here as it does in production.
const PROXIED_PATHS = ["/auth", "/mood", "/jobs", "/dashboard", "/health"];

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      ...Object.fromEntries(
        PROXIED_PATHS.map((path) => [path, { target: BACKEND, changeOrigin: true }])
      ),
      "/ws": { target: BACKEND, changeOrigin: true, ws: true },
    },
  },
});
