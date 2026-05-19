# MindTrack AI

Two independent systems, one beautiful dashboard.

- **Job Application Tracker** — Gmail MCP scans your inbox each morning; GPT-4o classifies emails into applied / rejected / interview / ghosted and logs them to SQLite.
- **Mental Health Voice Agent** — speak a 30-second daily check-in; Whisper transcribes, a fine-tuned GPT-4o-mini extracts mood/energy/anxiety, and ElevenLabs replies with a warm voice.

## Architecture

```
                ┌──────────────────────────────────────────┐
                │              React Dashboard             │
                │   (Apple Activity Monitor aesthetic)     │
                └───────────────┬──────────────────────────┘
                                │ REST
                ┌───────────────▼──────────────────────────┐
                │              FastAPI Backend             │
                │  /mood/*    /jobs/*    /dashboard        │
                └───┬─────────────────────────────────┬────┘
                    │                                 │
        ┌───────────▼─────────┐           ┌───────────▼──────────┐
        │  Mood Voice Agent   │           │  Job Tracker Agent   │
        │  Whisper → FT GPT   │           │  Gmail MCP → GPT-4o  │
        │  → ElevenLabs       │           │  (cron @ 8am daily)  │
        └───────────┬─────────┘           └───────────┬──────────┘
                    │                                 │
                ┌───▼─────────────────────────────────▼────┐
                │              SQLite (separate tables)    │
                │   mood_entries          job_metrics      │
                └──────────────────────────────────────────┘
```

## Setup

```bash
git clone <this-repo>
cd mindtrack-ai
cp .env.example .env   # fill in OPENAI_API_KEY, ELEVENLABS_API_KEY
docker-compose up
```

Open http://localhost:5173.

## Fine-tune the mood model

```bash
docker compose exec backend python finetuning/generate_training_data.py
docker compose exec backend python finetuning/finetune.py
# Copy the printed model id into .env → OPENAI_FINETUNED_MODEL=ft:gpt-4o-mini:...
docker compose restart backend
```

## API reference

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/mood/text` | Run mood agent on text input |
| POST | `/mood/audio` | Whisper transcribe + run mood agent |
| GET  | `/mood/history` | Last 30 days of mood entries |
| GET  | `/mood/stats` | 7-day daily averages |
| GET  | `/mood/weekly` | 7-day rolling averages |
| POST | `/jobs/scan` | Manually trigger Gmail MCP scan |
| GET  | `/jobs/history` | All job metrics |
| GET  | `/jobs/stats` | Status counts, week-over-week |
| GET  | `/jobs/timeline` | Applications over time |
| GET  | `/dashboard` | Combined stats for both panels |

## Screenshots

<img width="1472" height="852" alt="Screenshot 2026-05-19 at 1 22 20 PM" src="https://github.com/user-attachments/assets/f4bd75be-41c0-453b-82ad-17d2b2b4086b" />

