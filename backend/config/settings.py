from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    OPENAI_API_KEY: str
    OPENAI_FINETUNED_MODEL: str = ""
    ELEVENLABS_API_KEY: str
    ELEVENLABS_VOICE_ID: str = "21m00Tcm4TlvDq8ikWAM"
    WHISPER_MODEL: str = "base"
    DATABASE_URL: str = "sqlite:///./mindtrack.db"
    GOOGLE_CLIENT_SECRETS_PATH: str = "credentials/client_secret.json"
    GOOGLE_TOKEN_PATH: str = "credentials/token.json"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
