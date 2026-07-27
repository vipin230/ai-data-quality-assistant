from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = ""
    llm_provider: str = "openai"
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    llm_model: str = "gpt-4o-mini"
    # Comma-separated list of allowed frontend origins for CORS. Defaults to
    # local dev; set to your deployed frontend URL(s) in production.
    frontend_origins: str = "http://localhost:3000"
    llm_timeout_seconds: float = 30.0
    llm_max_retries: int = 2

    class Config:
        env_file = ".env"
        extra = "ignore"

    @property
    def frontend_origins_list(self) -> list[str]:
        return [o.strip() for o in self.frontend_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
