from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    OPENAI_API_KEY: str
    OPENAI_FINETUNED_MODEL: str = ""
    OPENAI_REALTIME_MODEL: str = "gpt-realtime-2.1-mini"
    OPENAI_REALTIME_TRANSCRIPTION_MODEL: str = "gpt-live-transcribe"
    OPENAI_REALTIME_TRANSCRIPTION_DELAY: str = "minimal"
    # "medium" is semantic VAD's balanced default: it handles natural pauses
    # without leaving the user in a listening state for an excessive time.
    OPENAI_REALTIME_VAD_EAGERNESS: str = "medium"
    # Comma-separated expected spoken languages. This is passed as `languages`
    # for gpt-live-transcribe, preventing noisy English from being rendered as
    # an unrelated language in the UI transcript.
    OPENAI_REALTIME_TRANSCRIPTION_LANGUAGES: str = "en"
    OPENAI_TRANSCRIPTION_MODEL: str = "gpt-4o-mini-transcribe"
    MOOD_EXTRACTOR_MODEL: str = "gpt-4o-mini"
    COACH_MODEL: str = "gpt-4o"
    CONVERSATION_MODEL: str = "gpt-4o"
    FINE_TUNE_BASE_MODEL: str = "gpt-4o-mini-2024-07-18"
    TTS_PROVIDER: str = "openai"
    OPENAI_TTS_MODEL: str = "gpt-4o-mini-tts"
    OPENAI_TTS_VOICE: str = "marin"
    ELEVENLABS_API_KEY: str = ""
    ELEVENLABS_VOICE_ID: str = "21m00Tcm4TlvDq8ikWAM"
    STT_PROVIDER: str = "openai"
    WHISPER_MODEL: str = "base"
    DATABASE_URL: str = "postgresql://mindtrack:mindtrack@localhost:5432/mindtrack"
    ENABLE_JOB_TRACKER: bool = True
    DEMO_MAX_POSTS_PER_HOUR: int = 60
    DEMO_MAX_POSTS_PER_HOUR_PER_USER: int = 120
    MAX_AUDIO_BYTES: int = 10 * 1024 * 1024
    MAX_TEXT_CHARS: int = 4000
    EXTERNAL_API_TIMEOUT_SECONDS: float = 45.0

    # --- Auth ---
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    SESSION_SECRET_KEY: str = ""
    TOKEN_ENCRYPTION_KEY: str = ""
    OAUTH_REDIRECT_URL: str = "http://localhost:8000/auth/callback"
    FRONTEND_URL: str = "http://localhost:5173"
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    SESSION_HTTPS_ONLY: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
