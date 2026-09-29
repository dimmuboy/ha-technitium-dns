from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import TechnitiumApiError, TechnitiumClient
from .const import CONF_BASE_URL, CONF_TOKEN, CONF_VERIFY_SSL, DOMAIN


class TechnitiumDnsLiveConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Configure Technitium DNS Live."""

    VERSION = 1

    async def async_step_user(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> config_entries.ConfigFlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            base_url = user_input[CONF_BASE_URL].strip().rstrip("/")
            token = user_input[CONF_TOKEN].strip()
            verify_ssl = user_input[CONF_VERIFY_SSL]

            client = TechnitiumClient(
                async_get_clientsession(self.hass),
                base_url,
                token,
                verify_ssl,
            )

            try:
                logger = await client.async_initialize()
            except TechnitiumApiError:
                errors["base"] = "cannot_connect"
            else:
                await self.async_set_unique_id(base_url)
                self._abort_if_unique_id_configured()

                return self.async_create_entry(
                    title="Technitium DNS",
                    data={
                        CONF_BASE_URL: base_url,
                        CONF_TOKEN: token,
                        CONF_VERIFY_SSL: verify_ssl,
                        "query_logger_name": logger.name,
                        "query_logger_class_path": logger.class_path,
                    },
                )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_BASE_URL,
                        default="http://technitium.example:5380",
                    ): str,
                    vol.Required(CONF_TOKEN): str,
                    vol.Required(CONF_VERIFY_SSL, default=True): bool,
                }
            ),
            errors=errors,
        )
