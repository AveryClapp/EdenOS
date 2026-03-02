from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "sqlite:///eden.db"
    scheduler_interval_seconds: int = 1800
    sync_interval_seconds: int = 600
    llm_model: str = "claude-opus-4-6"
    secret_key: str = "dev-secret-change-in-prod"

    anthropic_api_key: str = ""
    gcal_client_id: str = ""
    gcal_client_secret: str = ""
    gcal_redirect_uri: str = ""
    ms_client_id: str = ""
    ms_client_secret: str = ""
    ms_tenant_id: str = ""
    github_token: str = ""
    github_client_id: str = ""
    github_client_secret: str = ""

    whoop_client_id: str = ""
    whoop_client_secret: str = ""
    whoop_redirect_uri: str = "http://localhost:8000/api/whoop/callback"


settings = Settings()
