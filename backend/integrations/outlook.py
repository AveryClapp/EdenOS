from datetime import datetime
from typing import Any
from urllib.parse import urlencode

import httpx

_API_BASE = "https://graph.microsoft.com/v1.0/me"
_SCOPES = "Calendars.ReadWrite offline_access"

_EDEN_MANAGED_PROP_ID = "String {00020329-0000-0000-C000-000000000046} Name eden_managed"
_EDEN_MANAGED_VALUE = "true"


class OutlookClient:
    def __init__(
        self, client_id: str, client_secret: str, tenant_id: str, redirect_uri: str
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._tenant_id = tenant_id
        self._redirect_uri = redirect_uri
        self._access_token: str | None = None

    def _auth_url_base(self) -> str:
        return f"https://login.microsoftonline.com/{self._tenant_id}/oauth2/v2.0/authorize"

    def _token_url(self) -> str:
        return f"https://login.microsoftonline.com/{self._tenant_id}/oauth2/v2.0/token"

    def set_tokens(self, access_token: str, refresh_token: str | None = None) -> None:
        self._access_token = access_token

    def get_auth_url(self) -> str:
        params = {
            "client_id": self._client_id,
            "response_type": "code",
            "redirect_uri": self._redirect_uri,
            "scope": _SCOPES,
            "response_mode": "query",
        }
        return f"{self._auth_url_base()}?{urlencode(params)}"

    def exchange_code(self, code: str) -> dict[str, Any]:
        resp = httpx.post(
            self._token_url(),
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self._redirect_uri,
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "scope": _SCOPES,
            },
        )
        resp.raise_for_status()
        return resp.json()

    def refresh_access_token(self, refresh_token: str) -> dict[str, Any]:
        resp = httpx.post(
            self._token_url(),
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "scope": _SCOPES,
            },
        )
        resp.raise_for_status()
        return resp.json()

    def _headers(self) -> dict[str, str]:
        if not self._access_token:
            raise RuntimeError("No access token — call set_tokens() first")
        return {
            "Authorization": f"Bearer {self._access_token}",
            "Content-Type": "application/json",
        }

    def _is_eden_managed(self, event: dict) -> bool:
        for prop in event.get("singleValueExtendedProperties", []):
            if prop.get("id") == _EDEN_MANAGED_PROP_ID and prop.get("value") == _EDEN_MANAGED_VALUE:
                return True
        return False

    def get_events(self, time_min: datetime, time_max: datetime) -> list[dict[str, Any]]:
        """Fetch events in range, excluding Eden-managed events."""
        resp = httpx.get(
            f"{_API_BASE}/calendarView",
            params={
                "startDateTime": time_min.isoformat() + "Z",
                "endDateTime": time_max.isoformat() + "Z",
                "$top": 250,
                "$expand": f"singleValueExtendedProperties($filter=id eq '{_EDEN_MANAGED_PROP_ID}')",
            },
            headers=self._headers(),
        )
        resp.raise_for_status()
        events = resp.json().get("value", [])
        return [e for e in events if not self._is_eden_managed(e)]

    def create_event(self, summary: str, start_dt: datetime, end_dt: datetime) -> dict[str, Any]:
        """Create a calendar event tagged as Eden-managed."""
        body = {
            "subject": summary,
            "start": {"dateTime": start_dt.isoformat(), "timeZone": "UTC"},
            "end": {"dateTime": end_dt.isoformat(), "timeZone": "UTC"},
            "singleValueExtendedProperties": [
                {"id": _EDEN_MANAGED_PROP_ID, "value": _EDEN_MANAGED_VALUE}
            ],
        }
        resp = httpx.post(
            f"{_API_BASE}/events",
            json=body,
            headers=self._headers(),
        )
        resp.raise_for_status()
        return resp.json()

    def delete_event(self, event_id: str) -> None:
        resp = httpx.delete(
            f"{_API_BASE}/events/{event_id}",
            headers=self._headers(),
        )
        if resp.status_code not in (200, 204, 404):
            resp.raise_for_status()
