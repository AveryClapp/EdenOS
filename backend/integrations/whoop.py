from datetime import datetime, timedelta
from urllib.parse import urlencode
from typing import Any

import httpx

_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
_API_BASE = "https://api.prod.whoop.com/developer/v1"
_SCOPES = "offline read:recovery read:sleep read:cycles"


class WhoopClient:
    def __init__(self, client_id: str, client_secret: str, redirect_uri: str) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri
        self._access_token: str | None = None

    def set_tokens(self, access_token: str, refresh_token: str | None = None) -> None:
        self._access_token = access_token

    def get_auth_url(self) -> str:
        params = {
            "response_type": "code",
            "client_id": self._client_id,
            "redirect_uri": self._redirect_uri,
            "scope": _SCOPES,
        }
        # Use safe=':' so OAuth scopes like "read:recovery" are not percent-encoded
        non_scope = {k: v for k, v in params.items() if k != "scope"}
        scope_part = f"scope={params['scope']}"
        return f"{_AUTH_URL}?{urlencode(non_scope)}&{scope_part}"

    def exchange_code(self, code: str) -> dict[str, Any]:
        resp = httpx.post(
            _TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self._redirect_uri,
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            },
        )
        resp.raise_for_status()
        return resp.json()

    def refresh_access_token(self, refresh_token: str) -> dict[str, Any]:
        resp = httpx.post(
            _TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            },
        )
        resp.raise_for_status()
        return resp.json()

    def _headers(self) -> dict[str, str]:
        if not self._access_token:
            raise RuntimeError("No access token — call set_tokens() first")
        return {"Authorization": f"Bearer {self._access_token}"}

    def get_latest_recovery(self) -> dict[str, Any] | None:
        resp = httpx.get(
            f"{_API_BASE}/recovery/",
            params={"limit": 1},
            headers=self._headers(),
        )
        resp.raise_for_status()
        records = resp.json().get("records", [])
        return records[0] if records else None

    def get_latest_sleep(self) -> dict[str, Any] | None:
        resp = httpx.get(
            f"{_API_BASE}/activity/sleep/",
            params={"limit": 1},
            headers=self._headers(),
        )
        resp.raise_for_status()
        records = resp.json().get("records", [])
        return records[0] if records else None

    def get_latest_cycle(self) -> dict[str, Any] | None:
        resp = httpx.get(
            f"{_API_BASE}/cycle/",
            params={"limit": 1},
            headers=self._headers(),
        )
        resp.raise_for_status()
        records = resp.json().get("records", [])
        return records[0] if records else None
