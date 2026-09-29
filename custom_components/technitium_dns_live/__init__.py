from __future__ import annotations

from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import QueryLogger, TechnitiumApiError, TechnitiumClient
from .const import (
    CONF_BASE_URL,
    CONF_TOKEN,
    CONF_VERIFY_SSL,
    DATA_CLIENT,
    DATA_PANEL_REGISTERED,
    DATA_WS_REGISTERED,
    DOMAIN,
    FRONTEND_URL,
    FRONTEND_VERSION,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL,
)


def _get_client(hass: HomeAssistant) -> TechnitiumClient:
    """Return the configured Technitium client."""
    for entry_data in hass.data.get(DOMAIN, {}).values():
        if isinstance(entry_data, dict) and DATA_CLIENT in entry_data:
            return entry_data[DATA_CLIENT]

    raise TechnitiumApiError("Technitium DNS Live is not configured.")


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/query",
        vol.Optional("limit", default=50): vol.All(
            vol.Coerce(int),
            vol.Range(min=1, max=200),
        ),
        vol.Optional("response_type"): str,
    }
)
@websocket_api.async_response
async def websocket_query(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return recent Technitium query logs."""
    try:
        response = await _get_client(hass).async_query_logs(
            limit=msg["limit"],
            response_type=msg.get("response_type") or None,
        )
    except TechnitiumApiError as err:
        connection.send_error(msg["id"], "technitium_error", str(err))
        return

    connection.send_result(msg["id"], response)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/allow",
        vol.Required("domain"): str,
    }
)
@websocket_api.async_response
async def websocket_allow(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Add a domain to Technitium Allowed Zones."""
    try:
        await _get_client(hass).async_allow(msg["domain"].strip())
    except TechnitiumApiError as err:
        connection.send_error(msg["id"], "technitium_error", str(err))
        return

    connection.send_result(msg["id"], {"status": "ok"})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/block",
        vol.Required("domain"): str,
    }
)
@websocket_api.async_response
async def websocket_block(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Add a domain to Technitium Blocked Zones."""
    try:
        await _get_client(hass).async_block(msg["domain"].strip())
    except TechnitiumApiError as err:
        connection.send_error(msg["id"], "technitium_error", str(err))
        return

    connection.send_result(msg["id"], {"status": "ok"})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/pause",
        vol.Required("minutes"): vol.All(
            vol.Coerce(int),
            vol.Range(min=1, max=1440),
        ),
    }
)
@websocket_api.async_response
async def websocket_pause(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Temporarily disable Technitium blocking."""
    try:
        until = await _get_client(hass).async_pause_blocking(msg["minutes"])
    except TechnitiumApiError as err:
        connection.send_error(msg["id"], "technitium_error", str(err))
        return

    connection.send_result(
        msg["id"],
        {
            "status": "ok",
            "until": until,
        },
    )



@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/blocking_state",
    }
)
@websocket_api.async_response
async def websocket_blocking_state(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return the current Technitium blocking state."""
    try:
        state = await _get_client(hass).async_get_blocking_state()
    except TechnitiumApiError as err:
        connection.send_error(msg["id"], "technitium_error", str(err))
        return

    connection.send_result(msg["id"], state)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/set_blocking",
        vol.Required("enabled"): bool,
    }
)
@websocket_api.async_response
async def websocket_set_blocking(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Enable or disable Technitium blocking."""
    try:
        state = await _get_client(hass).async_set_blocking(msg["enabled"])
    except TechnitiumApiError as err:
        connection.send_error(msg["id"], "technitium_error", str(err))
        return

    connection.send_result(msg["id"], state)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/stats",
        vol.Optional("stats_type", default="LastDay"): vol.In(
            ["LastHour", "LastDay", "LastWeek", "LastMonth", "LastYear"]
        ),
    }
)
@websocket_api.async_response
async def websocket_stats(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return Technitium dashboard statistics."""
    try:
        response = await _get_client(hass).async_dashboard_stats(msg["stats_type"])
    except TechnitiumApiError as err:
        connection.send_error(msg["id"], "technitium_error", str(err))
        return

    connection.send_result(msg["id"], response)


async def _async_register_panel(hass: HomeAssistant) -> None:
    """Register the DNS Live sidebar panel."""
    domain_data = hass.data.setdefault(DOMAIN, {})

    if domain_data.get(DATA_PANEL_REGISTERED):
        return

    frontend_dir = Path(__file__).parent / "frontend"

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                FRONTEND_URL,
                str(frontend_dir),
                False,
            )
        ]
    )

    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL,
        webcomponent_name="technitium-dns-live-panel",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=f"{FRONTEND_URL}/technitium-panel.js?v={FRONTEND_VERSION}",
        embed_iframe=False,
        trust_external=False,
        require_admin=False,
    )

    domain_data[DATA_PANEL_REGISTERED] = True


async def _async_register_websockets(hass: HomeAssistant) -> None:
    """Register backend WebSocket commands."""
    domain_data = hass.data.setdefault(DOMAIN, {})

    if domain_data.get(DATA_WS_REGISTERED):
        return

    websocket_api.async_register_command(hass, websocket_query)
    websocket_api.async_register_command(hass, websocket_allow)
    websocket_api.async_register_command(hass, websocket_block)
    websocket_api.async_register_command(hass, websocket_pause)
    websocket_api.async_register_command(hass, websocket_blocking_state)
    websocket_api.async_register_command(hass, websocket_set_blocking)
    websocket_api.async_register_command(hass, websocket_stats)

    domain_data[DATA_WS_REGISTERED] = True


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    """Set up Technitium DNS Live from a config entry."""
    domain_data = hass.data.setdefault(DOMAIN, {})

    client = TechnitiumClient(
        async_get_clientsession(hass),
        entry.data[CONF_BASE_URL],
        entry.data[CONF_TOKEN],
        entry.data.get(CONF_VERIFY_SSL, True),
    )

    client.query_logger = QueryLogger(
        name=entry.data["query_logger_name"],
        class_path=entry.data["query_logger_class_path"],
    )

    domain_data[entry.entry_id] = {DATA_CLIENT: client}

    await _async_register_websockets(hass)
    await _async_register_panel(hass)

    return True


async def async_unload_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    """Unload a config entry."""
    hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)

    if not any(
        isinstance(value, dict) and DATA_CLIENT in value
        for value in hass.data.get(DOMAIN, {}).values()
    ):
        frontend.async_remove_panel(hass, PANEL_URL, warn_if_unknown=False)
        hass.data.get(DOMAIN, {}).pop(DATA_PANEL_REGISTERED, None)

    return True
