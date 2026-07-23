# MindTrack AI

MindTrack AI is a multi-user wellness app: sign in with Google and talk
through a daily mood check-in with a streaming voice agent, "Jeni" (or any
of 8 other companion personalities you can pick), in whichever conversation
mode fits the moment (advice, just listen, soothe me, motivation, or an
action plan).

```text
Browser microphone or typed reply
        -> FastAPI (WebSocket)
        -> OpenAI transcription
        -> multi-turn conversation agent
        -> structured mood extraction
        -> streamed OpenAI text-to-speech, sentence by sentence
```

Anonymous visitors can try a voice check-in without signing in — that path
keeps the original ephemeral, nothing-persisted behavior. Signing in with
Google (basic profile scope only — see note below) unlocks persistent
history, companion customization, and a full multi-tab dashboard.

**Note on scope:** this deployment intentionally does not request Gmail
access. `gmail.readonly` is a Google "restricted" scope that requires an
annual third-party security assessment to clear the "unverified app"
warning for the general public; dropping it keeps sign-in open to anyone
immediately, at the cost of the Gmail-based Job Tracker feature (present in
the codebase, gated off via `ENABLE_JOB_TRACKER`, not exposed in this
deployment's UI).

## Highlights

- Google sign-in, open to any Google account — no "unverified app" warning,
  since only basic (non-restricted) OAuth scopes are requested.
- 8 selectable companion personalities (Empathetic, Compassionate, Stoic,
  Playful, Motivational, Direct, Strict Coach, Calm Guide) and 5
  conversation modes (Advice, Just Listen, Soothe Me, Motivation, Action
  Plan) — independent preferences, so tone and intent compose freely.
- A voice picker with live preview (cloud TTS sample, falling back to the
  browser's own speech synthesis) across 10 OpenAI voices.
- Every mood entry and conversation is scoped per user (PostgreSQL,
  isolation covered by tests using dependency overrides).
- Voice agent replies stream over a WebSocket: text renders sentence by
  sentence as the coach's reply is generated, and each sentence's audio
  starts playing as soon as it's synthesized — not after the whole reply is
  done.
- A live "vibe" signal (calm/warm/energized/tense/low) computed on the same
  per-turn model call — no added latency — drives a reactive waveform and
  orb color as the conversation happens, not just after it ends.
- A dedicated, full-bleed "Talk It Out" voice screen, a wellness-ring +
  trend-chart Overview, weekly insights, and a daily reflection prompt.
- Structured mood, energy, and anxiety extraction with strict JSON handling.
- Deterministic crisis-language handling before the generative coach, for
  both signed-in and anonymous users, with a dedicated crisis-support card
  (988 / Crisis Text Line) instead of a generic chat reply.
- Configurable cloud/local STT and OpenAI/ElevenLabs TTS providers.
- Multi-stage Docker image serves React and FastAPI from one HTTPS origin,
  which is also what makes the Google OAuth session cookie work without any
  cross-site cookie configuration.

## Local development

```bash
cp .env.example .env
# Add your OpenAI key, and Google OAuth client id/secret + session/token
# keys -- see DEPLOYMENT.md's Google Cloud Console section for how to get
# the Google credentials.

docker compose up --build
```

Open http://localhost:5173.

The default `.env.example` uses managed OpenAI speech services. To run local
Whisper instead, install `backend/requirements-local.txt` and set:

```text
STT_PROVIDER=local
```

## Tests

```bash
docker compose up -d postgres
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 PYTHONPATH=backend pytest -q backend/tests
```

## Model quality workflow

Do not start a billable fine-tune before measuring the base model.

```bash
docker compose exec -w /app backend \
  python -m finetuning.generate_training_data

docker compose exec -w /app backend \
  python -m finetuning.prepare_dataset

docker compose exec -w /app backend \
  python -m finetuning.evaluate_model gpt-4o-mini

# Only after reviewing the baseline and confirming account support:
docker compose exec -w /app backend \
  python -m finetuning.finetune --confirm
```

See [TRAINING.md](TRAINING.md) for quality gates and honest resume language.

## Deployment

Live deployment runs on a Google Cloud Compute Engine "Always Free" e2-micro
VM (not the Render path `DEPLOYMENT.md` originally describes — Render's free
tier expires its Postgres database after 30 days and sleeps the web service,
which silently breaks a background scheduler; GCP's always-on free VM avoids
both). The stack is `docker-compose.prod.yml`: the app image (built from the
root `Dockerfile`), Postgres, and Caddy as a reverse proxy providing
automatic HTTPS (Let's Encrypt) via a `sslip.io` hostname, so no custom
domain is required.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the original Render-based walkthrough
(Docker build, Google Cloud Console OAuth setup, secrets, the auth/privacy
model, verification steps, and rollback process) — still accurate for the
parts that don't depend on which host runs the container.

See [DESIGN.md](DESIGN.md) for the full architecture writeup.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness check |
| GET | `/auth/login` | Start Google sign-in (redirect) |
| GET | `/auth/callback` | OAuth callback |
| GET | `/auth/me` | Current user, or 401 |
| PATCH | `/auth/me` | Update persona/conversation-mode/voice preferences |
| POST | `/auth/logout` | Clear the session |
| WS | `/ws/mood/session/{id}` | Streamed conversational turn (text + audio) |
| POST | `/mood/session/start` | Start a multi-turn check-in |
| POST | `/mood/session/turn/audio` | Transcribe and process a voice turn (REST fallback) |
| POST | `/mood/session/turn/text` | Process a typed turn (REST fallback) |
| GET | `/mood/sessions` | List past check-ins (History tab) |
| GET | `/mood/session/{id}` | Full transcript of one check-in; requires login |
| POST | `/mood/audio` | One-shot voice check-in (no follow-ups) |
| POST | `/mood/text` | One-shot text check-in |
| GET | `/mood/history` | Mood history; empty for anonymous callers |
| GET | `/mood/stats` | Daily mood aggregates |
| POST | `/mood/voice-preview` | Synthesize a fixed sample line in a given voice, for the Settings voice picker |
| POST | `/jobs/scan` | Scan the signed-in user's Gmail for job-application emails (disabled — no Gmail scope in this deployment, see note above) |
| GET | `/jobs/history` | Job lifecycle history (disabled, as above) |
| GET | `/jobs/stats` | Job status counts and weekly delta (disabled, as above) |
| GET | `/jobs/timeline` | Job status timeline (disabled, as above) |
| GET | `/dashboard` | Combined mood + job summary |

## Current status

Deployed at `https://mindtrack-ai-yx57.onrender.com` on a GCP Compute Engine Always
Free VM — `/health` passes and the site is served over a real, trusted
Let's Encrypt certificate. Backend auth, multi-tenant data isolation, the
streaming voice agent, and the frontend have been tested locally (pytest +
a real browser session with the full WS flow). A full real-Google-sign-in
walkthrough against the live deployment is still pending confirmation as of
this writing. The Job Tracker feature is present in the codebase but
disabled in this deployment (no Gmail OAuth scope — see the note near the
top of this file).

## Screenshot

<!-- TODO: add current screenshots of the redesigned UI (Overview, Talk It
     Out, Companion customization) -->
