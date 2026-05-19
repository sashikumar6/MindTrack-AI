import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000",
  timeout: 60_000,
});

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
export const submitMoodText = (text) =>
  api.post("/mood/text", { text }).then((r) => r.data);
export const submitMoodAudio = (blob) => {
  const form = new FormData();
  form.append("file", blob, "checkin.webm");
  return api
    .post("/mood/audio", form, { headers: { "Content-Type": "multipart/form-data" } })
    .then((r) => r.data);
};
