"""Jasper/T6R domestic hot-water modes and timed boosts."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import probatio
from homeassistant.components.water_heater import (
    WaterHeaterEntity,
    WaterHeaterEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTemperature
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_platform
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import CommandConfirmation, ResideoCoordinator
from .dhw_entity import ResideoHotWaterEntity
from .protocol import Thermostat
from .protocol.hot_water import DHW_BOOST_MINUTES, DHW_MODES
from .schedule_entity import ScheduleEntityMixin, register_schedule_actions


def _boost_duration(value: Any) -> int:
    """Accept the UI selector's strings and YAML integers without truncation."""
    if type(value) is int and value in DHW_BOOST_MINUTES:
        return value
    if isinstance(value, str) and value in {str(n) for n in DHW_BOOST_MINUTES}:
        return int(value)
    raise probatio.Invalid("Choose 30, 60 or 90 minutes")


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    register_schedule_actions(True)
    coordinator: ResideoCoordinator = entry.runtime_data
    known: set[str] = set()

    @callback
    def add_zones() -> None:
        added = []
        for device_id, device in (coordinator.data or {}).items():
            if device.hot_water and device_id not in known:
                known.add(device_id)
                added.append(ResideoHotWater(coordinator, device_id))
        if added:
            async_add_entities(added)

    add_zones()
    entry.async_on_unload(coordinator.async_add_listener(add_zones))
    platform = entity_platform.async_get_current_platform()
    platform.async_register_entity_service(
        "boost_hot_water",
        {probatio.Optional("duration", default=30): _boost_duration},
        "async_boost_hot_water",
        required_features=[WaterHeaterEntityFeature.OPERATION_MODE],
    )
    platform.async_register_entity_service(
        "cancel_hot_water_boost",
        {},
        "async_cancel_hot_water_boost",
        required_features=[WaterHeaterEntityFeature.OPERATION_MODE],
    )


class ResideoHotWater(ScheduleEntityMixin, ResideoHotWaterEntity, WaterHeaterEntity):
    """Control a DHW relay without inventing water-temperature measurements."""

    _schedule_hot_water = True
    _attr_translation_key = "hot_water"
    _attr_icon = "mdi:water-boiler"
    # HA 2026.10 requires a unit even for a relay without temperature support.
    _attr_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_native_temperature_unit = UnitOfTemperature.CELSIUS

    def __init__(self, coordinator: ResideoCoordinator, device_id: str) -> None:
        super().__init__(coordinator, device_id)
        self._attr_unique_id = f"{device_id}_dhw"

    @property
    def supported_features(self) -> WaterHeaterEntityFeature:
        if self.zone and self.zone.can_control:
            return (
                WaterHeaterEntityFeature.OPERATION_MODE
                | WaterHeaterEntityFeature.ON_OFF
            )
        return WaterHeaterEntityFeature(0)

    @property
    def operation_list(self) -> list[str]:
        return list(DHW_MODES) if self.zone and self.zone.can_control else []

    @property
    def capability_attributes(self) -> dict[str, Any]:
        """A relay has no water-temperature range to advertise."""
        return {"operation_list": self.operation_list} if self.operation_list else {}

    @property
    def current_operation(self) -> str | None:
        return self.zone.operation_mode if self.zone else None

    async def async_set_operation_mode(self, operation_mode: str) -> None:
        if operation_mode == "boost":
            await self.async_boost_hot_water()
            return
        await self.coordinator.async_command(
            self.coordinator.client.set_hot_water_mode(self.device_id, operation_mode),
            self._shows(lambda mode: mode == operation_mode),
            read_back_key=f"hot_water:{self.device_id}",
        )

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.async_set_operation_mode("on")

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.async_set_operation_mode("off")

    async def async_boost_hot_water(self, duration: int = 30) -> None:
        await self.coordinator.async_command(
            self.coordinator.client.boost_hot_water(self.device_id, duration),
            self._shows(lambda mode: mode == "boost"),
            read_back_key=f"hot_water:{self.device_id}",
        )

    async def async_cancel_hot_water_boost(self) -> None:
        await self.coordinator.async_command(
            self.coordinator.client.cancel_hot_water_boost(self.device_id),
            self._shows(lambda mode: mode in ("auto", "on", "off")),
            read_back_key=f"hot_water:{self.device_id}",
        )

    def _shows(self, want: Callable[[str], bool]) -> CommandConfirmation:
        """Confirm only a known operating mode from an online DHW zone."""

        def confirmed(data: dict[str, Thermostat]) -> bool:
            device = data.get(self.device_id)
            zone = device.hot_water if device else None
            return bool(
                zone
                and zone.online
                and zone.operation_mode in DHW_MODES
                and want(zone.operation_mode)
            )

        return confirmed
