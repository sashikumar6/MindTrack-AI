import axios from "axios";

// Same-origin in both dev (via the Vite proxy, see vite.config.js) and prod
// (FastAPI serves the built frontend itself) -- withCredentials is required
// either way so the session cookie set by /auth/callback rides along.
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "",
  withCredentials: true,
  timeout: 90_000,
});

export const fetchMe = () => api.get("/auth/me").then((r) => r.data);
export const updateMe = (patch) => api.patch("/auth/me", patch).then((r) => r.data);
export const logout = () => api.post("/auth/logout").then((r) => r.data);
export const fetchVoicePreview = (voice) =>
  api
    .post("/mood/voice-preview", { voice }, { responseType: "blob" })
    .then((response) => response.data);

export const fetchJobStats = () => api.get("/jobs/stats").then((r) => r.data);
export const fetchJobTimeline = (days = 14) =>
  api.get(`/jobs/timeline?days=${days}`).then((r) => r.data);
export const fetchJobHistory = (limit = 10) =>
  api.get(`/jobs/history?limit=${limit}`).then((r) => r.data);
export const triggerJobScan = () => api.post("/jobs/scan").then((r) => r.data);

export const fetchMoodStats = (days = 7) =>
  api.get(`/mood/stats?days=${days}`).then((r) => r.data);
export const fetchMoodHistory = (days = 30, limit = 30) =>
  api.get(`/mood/history?days=${days}&limit=${limit}`).then((r) => r.data);

export const startMoodSession = () =>
  api.post("/mood/session/start").then((r) => r.data);

export const createRealtimeCall = (sdp) =>
  api
    .post("/mood/realtime/call", sdp, {
      headers: { "Content-Type": "application/sdp" },
      responseType: "text",
      transformRequest: [(data) => data],
    })
    .then((r) => r.data);

export const checkRealtimeSafety = (text) =>
  api.post("/mood/realtime/safety", { text }).then((r) => r.data);

export const finalizeRealtimeCheckin = (turns) =>
  api.post("/mood/realtime/finalize", { turns }).then((r) => r.data);

export const fetchMoodSessions = (limit = 30, before) =>
  api
    .get("/mood/sessions", { params: { limit, before } })
    .then((r) => r.data);
export const fetchMoodSessionTranscript = (sessionId) =>
  api.get(`/mood/session/${sessionId}`).then((r) => r.data);

// Fire-and-forget: latency reporting should never affect the live voice
// session, so failures (offline, rate limited, etc.) are swallowed.
export const reportVoiceLatency = (metric, ms) =>
  api.post("/metrics/voice-latency", { metric, ms }).catch(() => {});
