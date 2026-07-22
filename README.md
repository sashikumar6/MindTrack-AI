# MindTrack AI

MindTrack AI is a multi-user wellness app: sign in with Google, talk through
a daily mood check-in with a streaming voice agent, and get your job search
tracked automatically from Gmail.

```text
Browser microphone or typed reply
        -> FastAPI (WebSocket)
        -> OpenAI transcription
        -> multi-turn conversation agent
        -> structured mood extraction
        -> streamed OpenAI text-to-speech, sentence by sentence
```

Anonymous visitors can still try a voice check-in without signing in — that
path keeps the original ephemeral, nothing-persisted behavior. Signing in
with Google unlocks persistent history, the Job Tracker (Gmail-based, scoped
to that account only), and a full multi-tab dashboard.

## Highlights

- Google sign-in; login and Gmail job-tracking consent happen in one
  screen, not two.
- Every mood entry, conversation, and job record is scoped per user
  (PostgreSQL, isolation covered by tests using dependency overrides).
- Voice agent replies stream over a WebSocket: text renders sentence by
  sentence as the coach's reply is generated, and each sentence's audio
  starts playing as soon as it's synthesized — not after the whole reply is
  done.
- Live waveform visualizer for both the user's mic input and the agent's
  streamed speech.
- Tabbed UI: Overview, Voice Agent, History (browse past check-ins and their
  full transcripts), Job Tracker, Settings.
- Structured mood, energy, and anxiety extraction with strict JSON handling.
- Deterministic crisis-language handling before the generative coach, for
  both signed-in and anonymous users.
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

See [DEPLOYMENT.md](DEPLOYMENT.md). It covers the Docker build, Google Cloud
Console OAuth setup, Render Postgres + web service, secrets, the auth/privacy
model, verification steps, and rollback process.

See [DESIGN.md](DESIGN.md) for the full architecture writeup.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness check |
| GET | `/auth/login` | Start Google sign-in (redirect) |
| GET | `/auth/callback` | OAuth callback |
| GET | `/auth/me` | Current user, or 401 |
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
| POST | `/jobs/scan` | Scan the signed-in user's Gmail for job-application emails |
| GET | `/jobs/history` | Job lifecycle history |
| GET | `/jobs/stats` | Job status counts and weekly delta |
| GET | `/jobs/timeline` | Job status timeline |
| GET | `/dashboard` | Combined mood + job summary |

## Current status

Backend auth, multi-tenant data isolation, the streaming voice agent, and the
frontend rebuild have been tested locally (pytest + a real browser session
with the full WS flow). Google OAuth verification and the first production
deploy are manual, explicit steps; this repository does not claim they have
already been completed.

## Screenshot

<img width="1472" height="852" alt="MindTrack AI dashboard screenshot" src="https://github.com/user-attachments/assets/f4bd75be-41c0-453b-82ad-17d2b2b4086b" />
