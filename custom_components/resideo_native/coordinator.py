"""Share one account poll across all thermostats and serialize commands."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Coroutine
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import callback
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import CONF_POLL_INTERVAL, DEFAULT_POLL_INTERVAL, NAME
from .protocol import AuthenticationError, NativeClient, ResideoError, Thermostat

_LOGGER = logging.getLogger(__name__)

# The cloud reports a command's result some seconds after the thermostat acts on
# it (about 10-15 s for hot water), so the read-back straight after a command
# usually still shows the old state. Read back again this many seconds apart
# (5, 15 and 30 s after the command) instead of waiting for the next poll.
READ_BACK_DELAYS = (5, 10, 15)


class ResideoCoordinator(DataUpdateCoordinator[dict[str, Thermostat]]):
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, client: NativeClient) -> None:
        self.client = client
        self.schedule_modes: dict[str, str] = {}
        self.configured_options = dict(entry.options)
        self._read_back: asyncio.Task | None = None
        interval = int(entry.options.get(CONF_POLL_INTERVAL, DEFAULT_POLL_INTERVAL))
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=NAME,
            update_interval=timedelta(seconds=max(30, min(600, interval))),
        )

    @callback
    def async_note_schedule(self, device_id, result):
        mode = result.get("schedule_type")
        previous = self.schedule_modes.get(device_id)
        if mode in ("Timed", "Geofence", "None"):
            self.schedule_modes[device_id] = mode
        else:
            self.schedule_modes.pop(device_id, None)
        if previous != self.schedule_modes.get(device_id):
            self.async_update_listeners()

    async def _async_update_data(self) -> dict[str, Thermostat]:
        try:
            return await self.client.update()
        except AuthenticationError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except ResideoError as err:
            raise UpdateFailed(str(err)) from err

    async def async_command(
        self,
        command: Coroutine[Any, Any, None],
        confirmed: Callable[[dict[str, Thermostat]], bool] | None = None,
    ) -> None:
        """Send a command, then read back until the server reports it.

        confirmed says whether polled data shows the command's result; without
        it every READ_BACK_DELAYS read-back is made.
        """
        try:
            await command
        except AuthenticationError as err:
            if self.config_entry:
                self.config_entry.async_start_reauth(self.hass)
            raise HomeAssistantError("Sign in to Resideo again") from err
        except ResideoError as err:
            raise HomeAssistantError(str(err)) from err
        # Read back from the server instead of inventing an optimistic state.
        await self.async_request_refresh()
        if self._read_back:
            self._read_back.cancel()
        if confirmed and self.data and confirmed(self.data):
            return
        if self.config_entry:
            self._read_back = self.config_entry.async_create_background_task(
                self.hass, self._async_read_back(confirmed), f"{NAME} command read-back"
            )

    async def _async_read_back(
        self, confirmed: Callable[[dict[str, Thermostat]], bool] | None
    ) -> None:
        for delay in READ_BACK_DELAYS:
            await asyncio.sleep(delay)
            await self.async_refresh()
            if confirmed and self.data and confirmed(self.data):
                return
