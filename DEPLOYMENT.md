# MindTrack AI — Manual Cloud Deployment Lab

This guide deploys MindTrack AI to Render without asking an agent or CLI to
create resources for you. You perform every cloud action and can explain what
each setting does in an interview.

## 1. Understand the production shape

The root `Dockerfile` is a multi-stage image:

```text
Node build stage
  npm ci -> Vite production bundle
                 |
                 v
Python runtime stage
  alembic upgrade head -> FastAPI + bundled React files -> one HTTPS Render URL
```

One service is preferable because the browser and API share the same origin.
That removes production CORS configuration, a second deploy, and a second
failure domain — it's also what makes the session cookie from Google login
work without any cross-site cookie configuration at all.

The cloud profile uses:

- FastAPI/Uvicorn for HTTP and WebSocket traffic.
- React/Vite compiled to static assets, served by FastAPI's `StaticFiles`.
- Google OAuth (via Authlib) for sign-in, combined with a `gmail.readonly`
  consent grant used by the per-user job tracker.
- Managed PostgreSQL (Render add-on) for persistent multi-user data.
- OpenAI transcription for cloud STT.
- A configurable OpenAI model for mood extraction and conversation.
- OpenAI `gpt-4o-mini-tts`, streamed, for spoken responses over the
  `/ws/mood/session/{id}` WebSocket.
- One daily APScheduler sweep across every user with a connected Gmail
  account (in-process; see DESIGN.md's note on why this doesn't scale past a
  single Render instance).

Local Whisper remains optional through `STT_PROVIDER=local` and
`backend/requirements-local.txt`. It is not installed in the cloud image
because Torch and model weights create slow builds, large images, and high
memory requirements.

## 2. Auth & privacy model

Signing in with Google does two things at once: it identifies the user, and
(via the combined `gmail.readonly` scope) grants the job tracker access to
scan their inbox for application emails. Both are captured in one consent
screen — there is no separate "connect Gmail later" step.

Anonymous visitors (no session cookie) still get a "try it" voice check-in
with the pre-auth privacy behavior: nothing is persisted, no cross-session
memory, and completed conversations are purged immediately after the closing
message. This is now a per-request decision (`current_user is None`), not a
global settings flag, so both kinds of traffic run correctly in the same
process — see `auth/deps.get_current_user_optional`.

Other things worth knowing before you deploy:

- Access/refresh tokens are encrypted at rest (Fernet, `TOKEN_ENCRYPTION_KEY`)
  and only ever decrypted in-process to call the Gmail API.
- Rate limiting is split: an unkeyed bucket for anonymous traffic
  (`DEMO_MAX_POSTS_PER_HOUR`) and a per-user bucket
  (`DEMO_MAX_POSTS_PER_HOUR_PER_USER`), covering both the REST turn endpoints
  and the WebSocket.
- Direct crisis language bypasses the coach LLM entirely and returns a
  deterministic U.S. 988/911 safety response, for both anonymous and signed-in
  users.
- Rotating `SESSION_SECRET_KEY` invalidates every existing session (everyone
  is signed out). Rotating `TOKEN_ENCRYPTION_KEY` makes every stored Gmail
  token undecryptable — users would need to reconnect Gmail. Treat both as
  "generate once, back up, don't rotate casually."

This is a real product now, not an ephemeral demo, but it is still not a
medical device or a substitute for clinical review.

## 3. Google Cloud Console setup

This has to happen before login works anywhere, local or deployed.

1. Create (or reuse) a project at [console.cloud.google.com](https://console.cloud.google.com).
2. **APIs & Services > Library** — enable the **Gmail API**.
3. **APIs & Services > OAuth consent screen** — configure it:
   - User type: **External**.
   - Add the scope `https://www.googleapis.com/auth/gmail.readonly` (plus the
     default `openid`/`email`/`profile` scopes, which don't need explicit
     adding).
   - Under **Test users**, add your own Google account (and anyone else who
     should be able to sign in) while the app is unverified.
4. **APIs & Services > Credentials > Create Credentials > OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URIs — add both:
     - `http://localhost:8000/auth/callback` (local dev)
     - `https://YOUR-SERVICE.onrender.com/auth/callback` (production, once
       you know the Render URL)
5. Copy the generated **Client ID** and **Client secret** — these become
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

**Verification status matters.** `gmail.readonly` is a Google "sensitive"
scope. While the app is unverified, sign-in only works for the up-to-100
accounts explicitly added as test users in step 3 — anyone else sees an
"unverified app" warning and can't proceed. That's fine for a personal
deployment or a small pilot; submitting for Google's verification review (so
anyone can sign in without a warning) is a separate, longer process and out
of scope for this guide.

## 4. Local release checks

Run these from the repository root:

```bash
docker compose up -d postgres

PYTHONPATH=backend PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 \
  pytest -q backend/tests

cd frontend
npm ci
npm audit --omit=dev
npm run build
cd ..

docker build -t mindtrack-ai:local .
```

Run the production image locally against the same Postgres container, using
your `.env` for OpenAI/Google credentials:

```bash
docker run --rm \
  --name mindtrack-local \
  --env-file .env \
  --network mindtrack-ai_default \
  -e DATABASE_URL=postgresql://mindtrack:mindtrack@postgres:5432/mindtrack \
  -e OAUTH_REDIRECT_URL=http://localhost:8000/auth/callback \
  -e FRONTEND_URL=http://localhost:8000 \
  -e ALLOWED_ORIGINS=http://localhost:8000 \
  -p 8000:8000 \
  mindtrack-ai:local
```

In another terminal:

```bash
curl -i http://localhost:8000/health
```

Then open `http://localhost:8000` and complete:

1. Sign in with a Google account added as a test user.
2. A normal two- or three-turn voice check-in, confirming captions and audio
   stream in progressively rather than arriving all at once.
3. A vague response that should trigger a follow-up.
4. A deliberately anxious but non-crisis response, and confirm it shows up
   under the History tab afterward.
5. A crisis-language safety test.
6. `POST /jobs/scan` (via the Job Tracker tab's "Sync Gmail" button) and
   confirm only that account's inbox is scanned.
7. Sign out, sign in as a second test user, and confirm none of the first
   user's mood history or job data is visible.

Stop the container with `Ctrl+C`.

## 5. Create the Render service

The checked-in `render.yaml` is a Blueprint — it provisions both the web
service and a managed Postgres database together.

1. Sign in to Render.
2. Choose **New > Blueprint**, connect the GitHub repository, and select the
   `main` branch. Render reads `render.yaml` and shows you the web service
   (`mindtrack-ai`) plus the database (`mindtrack-ai-db`) it's about to
   create.
3. Choose a paid always-on starter instance for a resume link. A sleeping
   free instance gives visitors a poor cold-start experience, and a sleeping
   instance also can't run the daily Gmail sweep on schedule.
4. Apply the Blueprint. Render provisions the database first, then builds and
   deploys the web service with `DATABASE_URL` already wired to it via
   `fromDatabase`.

If you'd rather create resources manually instead of via Blueprint (to learn
the platform), create the Postgres instance first under **New > PostgreSQL**,
then the web service under **New > Web Service** with the Dockerfile runtime,
health check path `/health`, and copy the database's **Internal Connection
String** into `DATABASE_URL` by hand.

## 6. Configure environment variables

Secrets (mark `sync: false` in the dashboard, never commit these):

```text
OPENAI_API_KEY=<new production-scoped key>
OPENAI_FINETUNED_MODEL=<blank until a fine-tuned model passes evals>
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
SESSION_SECRET_KEY=<python -c "import secrets; print(secrets.token_urlsafe(32))">
TOKEN_ENCRYPTION_KEY=<python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())">
```

Non-secret settings (already in `render.yaml`, shown here for reference):

```text
STT_PROVIDER=openai
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
TTS_PROVIDER=openai
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=marin
MOOD_EXTRACTOR_MODEL=gpt-4o-mini
COACH_MODEL=gpt-4o
CONVERSATION_MODEL=gpt-4o
ENABLE_JOB_TRACKER=true
DEMO_MAX_POSTS_PER_HOUR=60
DEMO_MAX_POSTS_PER_HOUR_PER_USER=120
MAX_AUDIO_BYTES=10485760
MAX_TEXT_CHARS=4000
EXTERNAL_API_TIMEOUT_SECONDS=45
OAUTH_REDIRECT_URL=https://YOUR-SERVICE.onrender.com/auth/callback
FRONTEND_URL=https://YOUR-SERVICE.onrender.com
ALLOWED_ORIGINS=https://YOUR-SERVICE.onrender.com
SESSION_HTTPS_ONLY=true
```

Once you know Render's assigned URL (or your custom domain), update
`OAUTH_REDIRECT_URL`/`FRONTEND_URL`/`ALLOWED_ORIGINS` to match it, and add the
same redirect URI in Google Cloud Console (§3, step 4).

Use a separate, production-scoped OpenAI key so you can revoke it without
breaking development. Configure provider-side spending limits and alerts.

## 7. Deploy and verify

Watch the deploy logs. A healthy deployment should:

1. Build the Vite bundle.
2. Install Python dependencies.
3. Run `alembic upgrade head` against the managed Postgres database.
4. Start Uvicorn on Render's injected `PORT`.
5. Pass `GET /health`.

Verify:

```bash
curl -i https://YOUR-SERVICE.onrender.com/health
```

Open the root URL, sign in with a test-user Google account, and repeat the
checklist from §4. Microphone access and the WebSocket connection both
require HTTPS in production, which Render provides.

## 8. Observe and rollback

For the first week:

- Review Render error logs daily.
- Review OpenAI usage daily.
- Keep a low spending limit.
- Confirm the daily Gmail sweep actually ran (check logs around the
  scheduled hour) rather than assuming it did.
- Never log raw transcripts.

If a release breaks:

1. Open the Render service.
2. Go to deploy history.
3. Roll back to the previous successful deploy.
4. Reproduce locally against the same Git commit.

Rolling back does not roll back the database schema — if the broken deploy
included an Alembic migration, you may need `alembic downgrade` against the
production database separately, or a forward-fix migration.

## 9. What to say in an interview

> I used a multi-stage Docker build to compile React and serve it from
> FastAPI, giving one HTTPS origin — which also meant Google's OAuth session
> cookie just works without any cross-site cookie configuration. Login and
> the Gmail job tracker share a single consent screen rather than a separate
> "connect Gmail" step. Every mood/job record is scoped by user_id, verified
> with isolation tests using FastAPI's dependency-override mechanism rather
> than forging cookies. The voice agent streams: the coach's reply is
> sentence-chunked as it's generated, each sentence's TTS audio streams to
> the client over a WebSocket as soon as it's synthesized, and the browser
> plays sentences back-to-back — so the user hears the first sentence before
> the rest of the reply has even finished generating, instead of waiting for
> one big text+audio payload. Anonymous visitors still get the original
> ephemeral, privacy-preserving check-in experience; that's now a per-request
> decision instead of a global config flag, so both traffic types run safely
> in the same process.
