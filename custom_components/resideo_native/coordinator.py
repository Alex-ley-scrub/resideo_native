"""Share one account poll across all thermostats and serialize commands."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Coroutine
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import CONF_POLL_INTERVAL, DEFAULT_POLL_INTERVAL, NAME
from .protocol import (
    AuthenticationError,
    NativeClient,
    RateLimited,
    ResideoError,
    Thermostat,
)

_LOGGER = logging.getLogger(__name__)

# Resideo can accept a command before its account response shows the change.
# Wait 5, then 10, then 15 seconds between follow-up reads (roughly 5/15/30
# seconds after the immediate read). Only GETs are repeated, never commands.
READ_BACK_DELAYS = (5, 10, 15)
CommandConfirmation = Callable[[dict[str, Thermostat]], bool]


class ResideoCoordinator(DataUpdateCoordinator[dict[str, Thermostat]]):
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, client: NativeClient) -> None:
        self.client = client
        self.schedule_modes: dict[str, str] = {}
        self.configured_options = dict(entry.options)
        self._read_back_tasks: dict[str, asyncio.Task[None]] = {}
        self._read_back_requests: dict[str, object] = {}
        self._read_back_closed = False
        self._refresh_generation = 0
        self._successful_refresh_generation = 0
        interval = int(entry.options.get(CONF_POLL_INTERVAL, DEFAULT_POLL_INTERVAL))
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=NAME,
            update_interval=timedelta(seconds=max(30, min(600, interval))),
        )
        entry.async_on_unload(self._async_cancel_read_backs)

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
        self._refresh_generation += 1
        generation = self._refresh_generation
        try:
            data = await self.client.update()
        except AuthenticationError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except ResideoError as err:
            raise UpdateFailed(str(err)) from err
        self._successful_refresh_generation = generation
        return data

    async def async_command(
        self,
        command: Coroutine[Any, Any, None],
        confirmed: CommandConfirmation | None = None,
        *,
        read_back_key: str = "command",
    ) -> None:
        """Send once, then optionally wait for a fresh cloud confirmation.

        Commands without a confirmation keep their single immediate refresh.
        A newer accepted command replaces verification only for the same key.
        """
        try:
            await command
        except AuthenticationError as err:
            if self.config_entry:
                self.config_entry.async_start_reauth(self.hass)
            raise HomeAssistantError("Sign in to Resideo again") from err
        except ResideoError as err:
            raise HomeAssistantError(str(err)) from err
        marker = None
        minimum_generation = self._refresh_generation + 1
        if confirmed is not None:
            # Register before awaiting the refresh: a newer command can finish
            # while this command's refresh is still queued by HA's debouncer.
            marker = object()
            self._read_back_requests[read_back_key] = marker
            if previous := self._read_back_tasks.pop(read_back_key, None):
                previous.cancel()
        try:
            # Read back from the server instead of inventing an optimistic state.
            await self.async_request_refresh()
            if confirmed is None:
                return
            if (
                self._read_back_closed
                or self._read_back_requests.get(read_back_key) is not marker
                or self._read_back_confirmed(confirmed, minimum_generation)
                or self._read_back_terminal_error(minimum_generation)
            ):
                return
            if self.config_entry:
                self._read_back_tasks[read_back_key] = (
                    self.config_entry.async_create_background_task(
                        self.hass,
                        self._async_read_back(
                            read_back_key, marker, confirmed, minimum_generation
                        ),
                        f"{NAME} command read-back",
                        eager_start=False,
                    )
                )
        finally:
            if (
                marker is not None
                and self._read_back_requests.get(read_back_key) is marker
                and read_back_key not in self._read_back_tasks
            ):
                self._read_back_requests.pop(read_back_key, None)

    def _read_back_confirmed(
        self, confirmed: CommandConfirmation, minimum_generation: int
    ) -> bool:
        # A failed/debounced refresh retains self.data. A request which started
        # before the command also cannot confirm that command's result.
        return bool(
            self.last_update_success
            and self._successful_refresh_generation >= minimum_generation
            and self.data
            and confirmed(self.data)
        )

    def _read_back_terminal_error(self, minimum_generation: int) -> bool:
        if self.last_update_success or self._refresh_generation < minimum_generation:
            return False
        error = self.last_exception
        return isinstance(error, ConfigEntryAuthFailed) or isinstance(
            getattr(error, "__cause__", None), (AuthenticationError, RateLimited)
        )

    async def _async_read_back(
        self,
        key: str,
        marker: object,
        confirmed: CommandConfirmation,
        minimum_generation: int,
    ) -> None:
        try:
            for delay in READ_BACK_DELAYS:
                await asyncio.sleep(delay)
                if self._read_back_requests.get(key) is not marker:
                    return
                # A normal account poll or another zone's command may already
                # have provided fresh confirmation; do not issue another GET.
                if self._read_back_confirmed(confirmed, minimum_generation):
                    return
                if self._read_back_terminal_error(minimum_generation):
                    return
                await self.async_refresh()
                if self._read_back_confirmed(confirmed, minimum_generation):
                    return
                if self._read_back_terminal_error(minimum_generation):
                    return
            _LOGGER.debug("Command read-back ended without cloud confirmation")
        finally:
            if self._read_back_requests.get(key) is marker:
                self._read_back_requests.pop(key, None)
            if self._read_back_tasks.get(key) is asyncio.current_task():
                self._read_back_tasks.pop(key, None)

    @callback
    def _async_cancel_read_backs(self) -> None:
        """Stop verification when the account is unloaded or reloaded."""
        self._read_back_closed = True
        self._read_back_requests.clear()
        for task in self._read_back_tasks.values():
            task.cancel()
        self._read_back_tasks.clear()
