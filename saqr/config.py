"""Runtime configuration (environment variables prefixed SAQR_, or a .env file)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PACKAGE_DIR = Path(__file__).resolve().parent
REPO_DIR = PACKAGE_DIR.parent
DATA_DIR = PACKAGE_DIR / "data"
TEMPLATES_DIR = PACKAGE_DIR / "templates"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SAQR_", env_file=".env", extra="ignore")

    # --- service -------------------------------------------------------------------------------
    host: str = "0.0.0.0"
    port: int = 8000
    data_dir: Path = Field(default=Path("var"), description="Writable state: sqlite db, captures, evidence, keys")
    frontend_dist: Path = Field(default=REPO_DIR / "frontend" / "dist")
    log_level: str = "INFO"
    node_name: str = "saqr-node-01"
    organisation: str = "SAQR demo node (NYUAD team)"

    # --- sensing -------------------------------------------------------------------------------
    ct_source: Literal["replay", "ctlogs", "certstream", "hybrid", "none"] = "replay"
    ct_logs: str = Field(
        default="https://ct.googleapis.com/logs/us1/argon2026h2/,https://ct.googleapis.com/logs/eu1/xenon2026h2/",
        description="Comma-separated RFC 6962 log base URLs tailed in ctlogs/hybrid mode",
    )
    ct_poll_interval: float = 3.0
    ct_batch_size: int = 256
    certstream_url: str = "wss://certstream.calidog.io"
    replay_rate: float = Field(default=18.0, description="Synthetic benign certificates per second in replay mode")
    match_threshold: int = Field(default=40, description="Look-alike score (0-100) that makes a name a candidate")
    feed_buffer: int = 400

    # --- verification --------------------------------------------------------------------------
    visual_encoder: Literal["perceptual", "dino"] = "perceptual"
    dino_model: str = "facebook/dinov3-vits16-pretrain-lvd1689m"
    dino_fallback_model: str = "facebook/dinov2-small"
    browser_timeout_ms: int = 20000
    capture_mobile: bool = True
    verify_concurrency: int = 2
    recheck_interval_s: int = Field(default=90, description="Re-verification interval for inactive/parked candidates")
    recheck_max: int = 6
    browser_proxy: str | None = Field(default=None, description="Optional proxy (e.g. socks5://127.0.0.1:9050) for isolation")

    # --- evidence ------------------------------------------------------------------------------
    tsa_urls: str = "https://freetsa.org/tsr,http://timestamp.digicert.com"
    tsa_timeout_s: float = 6.0
    dns_resolvers: str = "1.1.1.1,8.8.8.8"
    rdap_bootstrap: str = "https://rdap.org"

    # --- response ------------------------------------------------------------------------------
    connector_mode: Literal["simulate", "live"] = "simulate"
    simulated_ack_delay_s: float = Field(default=4.0, description="How long simulated partners take to acknowledge")

    # --- metrics baselines (hours) --------------------------------------------------------------
    baseline_tti_hours: float = 9.0
    baseline_exposure_hours: float = 48.0

    # --- demo ----------------------------------------------------------------------------------
    demo_sites_dir: Path = Field(default=REPO_DIR / "demo" / "sites")
    demo_server_port: int = 8081
    demo_autostart: bool = Field(default=True, description="Start the scripted scenario when the server starts in replay/hybrid mode")
    demo_speed: float = Field(default=1.0, description="Scenario time multiplier (2.0 = twice as fast)")

    # ------------------------------------------------------------------------------------------
    @property
    def ct_log_urls(self) -> list[str]:
        return [u.strip().rstrip("/") + "/" for u in self.ct_logs.split(",") if u.strip()]

    @property
    def tsa_url_list(self) -> list[str]:
        return [u.strip() for u in self.tsa_urls.split(",") if u.strip()]

    @property
    def resolver_list(self) -> list[str]:
        return [u.strip() for u in self.dns_resolvers.split(",") if u.strip()]

    @property
    def db_path(self) -> Path:
        return self.data_dir / "saqr.db"

    @property
    def captures_dir(self) -> Path:
        return self.data_dir / "captures"

    @property
    def evidence_dir(self) -> Path:
        return self.data_dir / "evidence"

    @property
    def gallery_dir(self) -> Path:
        return self.data_dir / "gallery"

    @property
    def keys_dir(self) -> Path:
        return self.data_dir / "keys"

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.captures_dir, self.evidence_dir, self.gallery_dir, self.keys_dir):
            d.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
