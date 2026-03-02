from typing import Any

import httpx

GITHUB_API = "https://api.github.com"


class GitHubClient:
    def __init__(self, token: str) -> None:
        self._headers = {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
        }

    def get_assigned_issues(self) -> list[dict[str, Any]]:
        """Return open issues assigned to the authenticated user (excludes PRs)."""
        resp = httpx.get(
            f"{GITHUB_API}/issues",
            params={"filter": "assigned", "state": "open"},
            headers=self._headers,
        )
        resp.raise_for_status()
        return [item for item in resp.json() if "pull_request" not in item]

    def get_review_requested_prs(self) -> list[dict[str, Any]]:
        """Return open PRs where review is requested from the authenticated user."""
        resp = httpx.get(
            f"{GITHUB_API}/search/issues",
            params={"q": "is:open is:pr review-requested:@me"},
            headers=self._headers,
        )
        resp.raise_for_status()
        return resp.json().get("items", [])
