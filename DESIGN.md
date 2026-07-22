# MindTrack AI — System Design

## 1. Product scope

MindTrack AI is a multi-user product with two capabilities, unlocked by
signing in with Google:

1. A multi-turn wellness check-in that accepts speech or text, asks follow-up
   questions, extracts structured mood metrics, and replies with streamed
   speech over a WebSocket.
2. A Gmail job tracker, scoped to that user's own inbox, that classifies
   application emails and produces lifecycle trends.

Google sign-in and the Gmail `readonly` consent happen in one screen — there
is no separate "connect Gmail" step. Anonymous visitors (no session) can
still use the voice check-in without an account; nothing is persisted for
them and completed conversations are purged immediately, preserving the
original portfolio-demo's privacy behavior for that specific path.

## 2. Architecture

```text
React/Vite static UI
        |
        | same-origin HTTPS (prod) / Vite dev proxy (local)
        v
FastAPI/Uvicorn
  |-- Google OAuth (Authlib) + signed session cookie
  |-- WebSocket voice turns: streamed conversation model -> sentence-chunked
  |     TTS, alongside REST fallback endpoints
  |-- mood extractor
  |-- deterministic safety layer
  |-- per-user Gmail client (encrypted stored tokens) + APScheduler daily sweep
  `-- PostgreSQL (SQLAlchemy + Alembic), all rows scoped by user_id

Local development: docker-compose runs a `postgres` service alongside
backend/frontend; local Whisper remains optional via STT_PROVIDER=local.
```

## 3. Core request flow

### Voice check-in

1. The browser records WebM/Opus or MP4 audio with `MediaRecorder`.
2. FastAPI validates upload size and writes a temporary file.
3. The configured STT provider returns a transcript.
4. A conversation agent decides whether to ask one focused follow-up or
   finalize. Sessions are capped at six user turns.
5. On finalization, the extractor returns five structured fields:
   `mood_score`, `energy_level`, `anxiety_level`, `keywords`, and `summary`.
6. The coach creates a short non-clinical response.
7. TTS returns MP3 bytes encoded in the API response.
8. In public demo mode, completed records and turns are deleted after the
   response is assembled.

### Safety flow

Direct crisis-language patterns are checked before the conversational or
extraction models. A match bypasses generative coaching and returns a fixed
911/988 response. Safety events do not update dashboard scores.

This is defense in depth for a portfolio demo, not a substitute for clinical
review or a medical-device safety program.

### Job tracking

1. APScheduler triggers an 8 a.m. scan locally.
2. Gmail search queries narrow the inbox to likely application messages.
3. A classifier maps subject/snippet text to an application state.
4. `email_id` is unique, making repeated scans idempotent.
5. Applied records older than 30 days without a response become `ghosted`.

## 4. Technology decisions

### FastAPI

Chosen for async request handling, Pydantic validation, automatic OpenAPI
documentation, and clean lifecycle hooks.

Not Flask: async external calls would require more infrastructure.

Not Django: its full web stack and admin system are unnecessary for this small
API.

### React + Vite

Chosen for fast dashboard iteration, browser audio APIs, Recharts, and a simple
static production bundle.

Not Next.js: server rendering, routing, and SEO provide little value for a
single-screen interactive tool.

### One production service

The root multi-stage Dockerfile builds React in Node and copies the static
bundle into the Python image. FastAPI serves both UI and API.

Why: one URL, one TLS certificate, no production CORS dependency, and one
deployment to diagnose.

Not two cloud services: unnecessary coordination and cost for a portfolio demo.

### SQLite + SQLAlchemy

SQLite is appropriate for local single-user persistence and short-lived public
session state. SQLAlchemy keeps the data layer portable if PostgreSQL becomes
necessary.

The public profile uses `/tmp` without a disk. This is deliberate: a resume
demo should not retain strangers' mental-health transcripts.

Not PostgreSQL yet: there is no multi-user durable-data requirement.

### Managed STT in cloud, optional local Whisper

Cloud default: `gpt-4o-mini-transcribe`.

Why: avoids packaging Torch and Whisper weights, reduces image size and cold
start, and fits a small cloud instance.

Local option: `STT_PROVIDER=local` plus `requirements-local.txt`.

Why keep it: local Whisper supports private/offline development when compute is
available.

### OpenAI TTS default, ElevenLabs optional

The cloud default is `gpt-4o-mini-tts` with a configurable voice. ElevenLabs
remains available behind `TTS_PROVIDER=elevenlabs`.

Why the provider abstraction exists: the original ElevenLabs library voice
returned a paid-plan error during release testing. The application should not
become silent because one vendor or subscription changes.

### Configurable model routing

Separate settings exist for:

- transcription;
- conversation decisions;
- structured extraction;
- coaching;
- speech synthesis;
- optional fine-tuned extraction.

Why: each task has different cost, latency, and quality requirements. Model IDs
can change without code edits.

### Structured output and defensive validation

Extraction/classification calls request JSON and use low temperature where
determinism matters. Numeric values are clamped to 1-10, enum outputs are
validated, and malformed output fails safely.

Not free-form parsing: a dashboard cannot depend on prose shape.

### APScheduler instead of Celery/Redis

One daily local Gmail job does not justify a broker and worker deployment.

Trade-off: an in-process scheduler must be disabled or redesigned before
running multiple API replicas.

### Async boundaries

The OpenAI SDK is asynchronous. Blocking providers such as the Google API
client and local Whisper run through `asyncio.to_thread`. External calls have
timeouts and retries.

Why: a slow transcription or Gmail request must not freeze the FastAPI event
loop.

## 5. Fine-tuning design

Fine-tuning is optional and gated by evaluation:

```text
teacher-generated examples
        -> schema validation
        -> duplicate/coverage report
        -> deterministic 80/20 split
        -> base-model evaluation
        -> explicitly confirmed fine-tune
        -> base vs fine-tuned comparison
```

The first 100-example dataset had no duplicates but missed several extreme
labels. The updated generator targets 140 examples across 14 scenarios,
including mixed-emotion and full-scale cases.

Metrics:

- schema-valid response rate;
- mean absolute error per numeric field;
- numeric predictions within one point.

A fine-tuned model is not adopted unless it beats the base model on the
untouched validation set.

## 6. Auth, isolation, and anonymous-visitor controls

- Every `MoodEntry`, `MoodSession`, and `JobMetric` row carries a `user_id`;
  all reads/writes filter by the authenticated caller's id. Isolation is
  covered by tests that swap `get_current_user` via FastAPI's
  `dependency_overrides` for two different users and assert neither sees the
  other's rows.
- Session ownership is re-checked on every conversational turn
  (`sess.user_id != user_id`), not just at session creation, so a guessed
  `session_id` can't be used to continue someone else's check-in.
- Gmail access tokens are encrypted at rest (Fernet) and only decrypted
  in-process to call the Gmail API; `JobMetric` dedup is scoped to
  `(user_id, email_id)`, since a Gmail message id is only unique within one
  mailbox.
- Anonymous callers (`current_user is None`) get the original ephemeral
  behavior: no persistence, no cross-session memory, completed conversations
  purged immediately. This is now a per-request branch, not a global
  settings flag, since authenticated and anonymous traffic share one process.
- Rate limiting is split into an unkeyed anonymous bucket and a per-user
  bucket, covering both REST and the WebSocket voice endpoint.
- 10 MB audio limit, 4,000-character text limit, external call timeouts and
  retries, typed fallback when microphone access fails.
- Direct crisis language bypasses the coach LLM and returns a deterministic
  U.S. 988/911 response, before any generation call, for every caller.

The in-memory rate limit is intentionally lightweight. A production
multi-replica service would use Redis or an API gateway.

## 7. Verification completed

- Backend unit/API/isolation tests (pytest), including multi-tenant
  isolation via dependency overrides and a token-encryption round trip.
- Production dependency audit: zero runtime npm vulnerabilities.
- Multi-stage Docker build; Alembic migration verified against both
  PostgreSQL and SQLite (batch mode for SQLite's limited `ALTER TABLE`).
- Real external conversation-agent, streamed coach response, and streamed
  OpenAI TTS, exercised end-to-end over a real WebSocket connection
  (ask-turn, multi-sentence finalize-turn, and crisis-language paths).
- Full frontend flow verified in a real headless-Chromium session: Google
  login gate, tab navigation, a live voice check-in over the WebSocket with
  captions and audio arriving progressively, History, Job Tracker (including
  the "Gmail not connected" state), and Settings.
- Deterministic crisis-response path, both anonymous and authenticated.

The remaining manual gates are Google OAuth verification (or staying on the
test-user allowlist), improved dataset generation, base-model evaluation,
optional fine-tuning, and the first Render deploy.

## 8. Scaling path

Completed as part of the multi-user rework:

1. ~~Add authentication and tenant ownership to every record.~~ Done --
   Google OAuth + `user_id` on every table.
2. ~~Move durable data to PostgreSQL with Alembic migrations.~~ Done.

Still open for a larger-scale deployment:

3. Move session state and rate limiting to Redis (currently in-process,
   which caps this at one Render instance).
4. Replace in-process APScheduler with one dedicated worker/cron service.
5. Add OpenTelemetry traces, structured logs, metrics, and alerting.
6. Add clinical safety review and geographically correct crisis resources
   (currently U.S.-only 988/911).
7. Define formal data retention/deletion policies for authenticated users'
   data (encryption at rest for Gmail tokens is already in place).
8. Submit for Google's OAuth verification review so sign-in isn't limited to
   an explicit test-user allowlist.

## 9. Interview summary

> I turned a single-user portfolio demo into a real multi-user product:
> Google OAuth for identity, combined with a `gmail.readonly` consent grant
> so the job tracker works per-account instead of one shared inbox. Every
> record is scoped by `user_id`, and I tested isolation with FastAPI
> dependency overrides rather than trusting the schema change alone. The
> voice agent now streams over a WebSocket -- the coach's reply is
> sentence-chunked as it generates, and each sentence's TTS audio plays as
> soon as it's synthesized, so the user hears the first sentence before the
> rest of the reply has finished generating. I kept the original anonymous,
> ephemeral check-in path working too, which meant turning a global
> `DEMO_MODE` flag into a per-request decision so both kinds of traffic run
> safely in one process. I verified the whole thing three ways: backend
> tests, live API calls against the real OpenAI streaming endpoints, and a
> full browser session driven end-to-end through login, the voice flow, and
> every tab.
