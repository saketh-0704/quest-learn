from pathlib import Path
from pydantic import Field, HttpUrl, SecretStr
from app.retrieval.models import SearchOptions
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parents[1] / ".env", extra="ignore", env_ignore_empty=True, env_nested_delimiter="__")
    cors_origins: list[str] = ["http://127.0.0.1:5173", "http://localhost:5173"]
    # Public project credentials are sufficient for remote user verification.
    supabase_url: HttpUrl | None = None
    supabase_publishable_key: SecretStr | None = None
    supabase_secret_key: SecretStr | None = None
    database_url: SecretStr | None = None
    storage_bucket: str = "study-material"
    gemini_api_key: SecretStr | None = None
    gemini_model: str = "gemini-3.5-flash-lite"
    gemini_quiz_fallback_model: str = "gemini-3.1-flash-lite"
    gemini_embedding_model: str = "gemini-embedding-001"
    rag_python: Path = Path(__file__).resolve().parents[2] / ".local/raganything/.venv/Scripts/python.exe"
    rag_timeout_seconds: int = Field(default=180, ge=30, le=300)
    notebook_job_timeout_seconds: int = Field(default=900, ge=60, le=3600)
    retrieval: SearchOptions = Field(default_factory=SearchOptions)
    retrieval_statement_timeout_ms: int = Field(default=5000, ge=100, le=30000)
