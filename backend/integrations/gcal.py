from datetime import datetime
from typing import Any
from urllib.parse import urlencode

import httpx

_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_API_BASE = "https://www.googleapis.com/calendar/v3"
_SCOPES = "https://www.googleapis.com/auth/calendar"

_EDEN_MANAGED_KEY = "eden_managed"
_EDEN_MANAGED_VALUE = "true"


class GCalClient:
    def __init__(self, client_id: str, client_secret: str, redirect_uri: str) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri
        self._access_token: str | None = None

    def set_tokens(self, access_token: str, refresh_token: str | None = None) -> None:
        self._access_token = access_token

    def get_auth_url(self) -> str:
        params = {
            "client_id": self._client_id,
            "redirect_uri": self._redirect_uri,
            "response_type": "code",
            "scope": _SCOPES,
            "access_type": "offline",
            "prompt": "consent",
        }
        return f"{_AUTH_URL}?{urlencode(params)}"

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

    def get_events(self, time_min: datetime, time_max: datetime) -> list[dict[str, Any]]:
        """Fetch events in range, excluding Eden-managed events."""
        resp = httpx.get(
            f"{_API_BASE}/calendars/primary/events",
            params={
                "timeMin": time_min.isoformat() + "Z",
                "timeMax": time_max.isoformat() + "Z",
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": 250,
            },
            headers=self._headers(),
        )
        resp.raise_for_status()
        events = resp.json().get("items", [])
        return [
            e for e in events
            if e.get("status") != "cancelled"
            and e.get("extendedProperties", {}).get("private", {}).get(_EDEN_MANAGED_KEY) != _EDEN_MANAGED_VALUE
        ]

    def create_event(self, summary: str, start_dt: datetime, end_dt: datetime) -> dict[str, Any]:
        """Create a calendar event tagged as Eden-managed."""
        body = {
            "summary": summary,
            "start": {"dateTime": start_dt.isoformat(), "timeZone": "UTC"},
            "end": {"dateTime": end_dt.isoformat(), "timeZone": "UTC"},
            "extendedProperties": {
                "private": {_EDEN_MANAGED_KEY: _EDEN_MANAGED_VALUE}
            },
        }
        resp = httpx.post(
            f"{_API_BASE}/calendars/primary/events",
            json=body,
            headers=self._headers(),
        )
        resp.raise_for_status()
        return resp.json()

    def delete_event(self, event_id: str) -> None:
        resp = httpx.delete(
            f"{_API_BASE}/calendars/primary/events/{event_id}",
            headers=self._headers(),
        )
        # 404 = already deleted — treat as success
        if resp.status_code not in (200, 204, 404):
            resp.raise_for_status()
