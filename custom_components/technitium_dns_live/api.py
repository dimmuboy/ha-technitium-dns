from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import aiohttp


class TechnitiumApiError(Exception):
    """Raised when the Technitium API returns an error."""


@dataclass(slots=True)
class QueryLogger:
    """Describe the installed Technitium query logger."""

    name: str
    class_path: str


class TechnitiumClient:
    """Small async client for the Technitium HTTP API."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        base_url: str,
        token: str,
        verify_ssl: bool = True,
    ) -> None:
        self._session = session
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._ssl = None if verify_ssl else False
        self.query_logger: QueryLogger | None = None

    async def _get(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        *,
        ignore_api_error: bool = False,
    ) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {self._token}"}
        url = f"{self._base_url}{path}"

        try:
            async with self._session.get(
                url,
                params=params,
                headers=headers,
                ssl=self._ssl,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as response:
                response.raise_for_status()
                data = await response.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError, ValueError) as err:
            raise TechnitiumApiError(str(err)) from err

        if data.get("status") != "ok" and not ignore_api_error:
            message = data.get("errorMessage") or data.get("error") or str(data)
            raise TechnitiumApiError(message)

        return data

    async def async_initialize(self) -> QueryLogger:
        """Validate access and locate a compatible Query Logs app."""
        data = await self._get("/api/apps/list")
        apps = data.get("response", {}).get("apps", [])

        for app in apps:
            for dns_app in app.get("dnsApps", []):
                if dns_app.get("isQueryLogs"):
                    self.query_logger = QueryLogger(
                        name=app["name"],
                        class_path=dns_app["classPath"],
                    )
                    return self.query_logger

        raise TechnitiumApiError(
            "No Technitium Query Logs app was found. Install Query Logs (Sqlite)."
        )

    async def async_query_logs(
        self,
        limit: int = 50,
        response_type: str | None = None,
    ) -> dict[str, Any]:
        """Return recent query log entries."""
        if self.query_logger is None:
            await self.async_initialize()

        params: dict[str, Any] = {
            "name": self.query_logger.name,
            "classPath": self.query_logger.class_path,
            "pageNumber": 1,
            "entriesPerPage": limit,
            "descendingOrder": "true",
        }

        if response_type:
            params["responseType"] = response_type

        data = await self._get("/api/logs/query", params)
        return data.get("response", {})

    async def async_allow(self, domain: str) -> None:
        """Allow a domain, remove a manual block if present, then clear cache."""
        await self._get(
            "/api/blocked/delete",
            {"domain": domain},
            ignore_api_error=True,
        )
        await self._get("/api/allowed/add", {"domain": domain})
        await self._get(
            "/api/cache/delete",
            {"domain": domain},
            ignore_api_error=True,
        )

    async def async_block(self, domain: str) -> None:
        """Block a domain, remove an allow rule if present, then clear cache."""
        await self._get(
            "/api/allowed/delete",
            {"domain": domain},
            ignore_api_error=True,
        )
        await self._get("/api/blocked/add", {"domain": domain})
        await self._get(
            "/api/cache/delete",
            {"domain": domain},
            ignore_api_error=True,
        )

    async def async_pause_blocking(self, minutes: int) -> str | None:
        """Temporarily disable Technitium blocking."""
        data = await self._get(
            "/api/settings/temporaryDisableBlocking",
            {"minutes": minutes},
        )
        return data.get("response", {}).get("temporaryDisableBlockingTill")
