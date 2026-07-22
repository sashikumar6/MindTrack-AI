import { useSearchParams } from "react-router-dom";

const ERROR_MESSAGES = {
  oauth_failed: "Google sign-in didn't complete. Please try again.",
  missing_profile: "Google didn't return an email/profile — please try again.",
};

export default function Login() {
  const [params] = useSearchParams();
  const error = params.get("error");

  return (
    <div style={wrap}>
      <div style={orb} />
      <div style={eyebrow}>MindTrack AI</div>
      <h1 style={headline}>A calmer way to track how you're doing.</h1>
      <p style={subtitle}>
        A quick voice check-in each day, plus a quiet eye on your job
        search — so you can see the pattern, not just the moment.
      </p>

      {error ? (
        <div style={errorBox}>{ERROR_MESSAGES[error] || "Sign-in failed. Please try again."}</div>
      ) : null}

      {/* Must be a real top-level navigation, not a fetch/XHR -- the OAuth
          redirect flow (state/PKCE/nonce) requires the browser to follow
          Google's redirect chain itself. */}
      <a href="/auth/login" style={googleBtn}>
        <GoogleIcon />
        Continue with Google
      </a>

      <p style={fineprint}>
        We request Gmail read access at sign-in so job-application emails
        can be tracked automatically. Nothing is scanned until you sign in,
        and you can see what's connected any time from Settings.
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20.5H24v7h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.5 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 5.1 29.6 3 24 3 16 3 9 7.5 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 45c5.5 0 10.4-2.1 14.1-5.6l-6.5-5.5c-2 1.5-4.6 2.4-7.6 2.4-5.3 0-9.7-3.4-11.3-8l-6.6 5.1C9 40.4 16 45 24 45z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20.5H24v7h11.3c-.8 2.2-2.2 4.1-4 5.5l6.5 5.5C41.5 35.6 45 30.4 45 24c0-1.2-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

const wrap = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 40,
  textAlign: "center",
  animation: "fadeUp 500ms ease both",
};
const orb = {
  width: 88,
  height: 88,
  borderRadius: "50%",
  background: "radial-gradient(circle at 35% 30%, #7dbcff, #4da3ff 45%, #34d399 100%)",
  animation: "breathe 3.6s ease-in-out infinite",
  boxShadow: "0 0 70px rgba(77,163,255,0.35)",
  marginBottom: 36,
};
const eyebrow = {
  fontSize: 15,
  letterSpacing: "0.16em",
  color: "var(--text-tertiary)",
  textTransform: "uppercase",
  marginBottom: 14,
};
const headline = {
  fontSize: 40,
  fontWeight: 600,
  lineHeight: 1.15,
  margin: "0 0 16px",
  maxWidth: 520,
};
const subtitle = {
  fontSize: 16,
  lineHeight: 1.6,
  color: "var(--text-secondary)",
  maxWidth: 420,
  margin: "0 0 36px",
};
const googleBtn = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: "15px 34px",
  background: "var(--text-primary)",
  color: "var(--bg-primary)",
  border: 0,
  borderRadius: 100,
  fontSize: 15,
  fontWeight: 600,
  textDecoration: "none",
  cursor: "pointer",
  transition: "transform 160ms",
};
const fineprint = {
  marginTop: 22,
  color: "var(--text-tertiary)",
  fontSize: 11,
  lineHeight: 1.5,
  maxWidth: 420,
};
const errorBox = {
  marginBottom: 20,
  padding: "10px 14px",
  background: "rgba(255,92,92,0.1)",
  border: "1px solid var(--rejected-color)",
  borderRadius: 8,
  color: "var(--rejected-color)",
  fontSize: 12,
  maxWidth: 420,
};
