"""Exercise DHW entity setup, actions, discovery and unload on real HA 2026.10.2."""

from __future__ import annotations

import asyncio
import json
import time
from copy import deepcopy
from unittest.mock import AsyncMock, Mock, patch

import probatio
import pytest
from dhw_fixtures import dhw_locations
from homeassistant.components.water_heater import WaterHeaterEntityFeature
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.resideo_native.diagnostics import (
    async_get_config_entry_diagnostics,
)
from custom_components.resideo_native.protocol import (
    AuthenticationError,
    CannotConnect,
    CommandError,
    RateLimited,
    Token,
)
from custom_components.resideo_native.protocol.device import parse_locations


@pytest.fixture(autouse=True)
def custom_integrations(enable_custom_integrations):
    """Enable the custom component under test."""


@pytest.fixture
def client():
    client = Mock()
    client.devices = parse_locations(dhw_locations())
    client.update = AsyncMock(side_effect=lambda: client.devices)
    client.get_schedule = AsyncMock(return_value={"schedule_type": "Timed", "revision": "startup", "schedule_controls_supported": True})
    for method in (
        "set_temperature",
        "set_mode",
        "set_hold",
        "set_hot_water_mode",
        "boost_hot_water",
        "cancel_hot_water_boost",
    ):
        setattr(client, method, AsyncMock())
    with patch("custom_components.resideo_native.NativeClient", return_value=client):
        yield client


async def load_entry(hass):
    entry = MockConfigEntry(
        domain="resideo_native",
        unique_id="456",
        title="Resideo Native",
        data={
            "country": "GB",
            "token": Token(
                "private-access", "private-refresh", time.time() + 3600
            ).as_dict(),
        },
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


@pytest.fixture
async def entry(hass, client):
    return await load_entry(hass)


def water_state(hass):
    states = hass.states.async_all("water_heater")
    assert len(states) == 1
    return states[0]


def sensor_state(hass):
    states = [s for s in hass.states.async_all("sensor") if s.entity_id.endswith("_hot_water_state")]
    assert len(states) == 1
    return states[0]


async def test_two_thermostats_create_one_dhw_pair_on_existing_device(
    hass, entry, client
):
    assert len(hass.states.async_all("climate")) == 2
    water = water_state(hass)
    sensor = sensor_state(hass)
    assert water.state == "auto"
    assert sensor.state == "off"
    assert sensor.attributes["dhw_state"] == "Off"
    assert water.attributes["status"] == "NoHold"
    assert water.attributes["operation_list"] == ["auto", "on", "off", "boost"]
    assert water.attributes["supported_features"] == (
        WaterHeaterEntityFeature.OPERATION_MODE | WaterHeaterEntityFeature.ON_OFF
    )
    assert water.attributes["current_temperature"] is None
    assert water.attributes["temperature"] is None
    assert "min_temp" not in water.attributes
    assert "max_temp" not in water.attributes
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), entry.entry_id)
    assert len(devices) == 2
    client.set_hot_water_mode.assert_not_awaited()
    client.boost_hot_water.assert_not_awaited()
    client.cancel_hot_water_boost.assert_not_awaited()


@pytest.mark.parametrize("mode", ["auto", "on", "off", "boost"])
async def test_operation_modes_use_shared_client_and_read_back(
    hass, entry, client, mode
):
    before = client.update.await_count
    await hass.services.async_call(
        "water_heater",
        "set_operation_mode",
        {
            "entity_id": water_state(hass).entity_id,
            "operation_mode": mode,
        },
        blocking=True,
    )
    if mode == "boost":
        client.boost_hot_water.assert_awaited_once_with("T6R-parent", 30)
    else:
        client.set_hot_water_mode.assert_awaited_once_with("T6R-parent", mode)
    assert client.update.await_count > before
    assert water_state(hass).state == "auto"  # simulated server still reports NoHold


@pytest.mark.parametrize(("service", "mode"), [("turn_on", "on"), ("turn_off", "off")])
async def test_standard_on_off_actions(hass, entry, client, service, mode):
    await hass.services.async_call(
        "water_heater",
        service,
        {
            "entity_id": water_state(hass).entity_id,
        },
        blocking=True,
    )
    client.set_hot_water_mode.assert_awaited_once_with("T6R-parent", mode)


@pytest.mark.parametrize("duration", [30, 60, 90, "30", "60", "90"])
async def test_boost_action_accepts_yaml_and_ui_selector(hass, entry, client, duration):
    await hass.services.async_call(
        "resideo_native",
        "boost_hot_water",
        {
            "entity_id": water_state(hass).entity_id,
            "duration": duration,
        },
        blocking=True,
    )
    client.boost_hot_water.assert_awaited_once_with("T6R-parent", int(duration))


async def test_default_boost_and_cancel_actions(hass, entry, client):
    target = {"entity_id": water_state(hass).entity_id}
    await hass.services.async_call(
        "resideo_native", "boost_hot_water", target, blocking=True
    )
    client.boost_hot_water.assert_awaited_once_with("T6R-parent", 30)
    await hass.services.async_call(
        "resideo_native", "cancel_hot_water_boost", target, blocking=True
    )
    client.cancel_hot_water_boost.assert_awaited_once_with("T6R-parent")


@pytest.mark.parametrize("duration", [True, 0, 15, 120, 30.5, "30.5"])
async def test_invalid_boost_action_sends_no_command(hass, entry, client, duration):
    with pytest.raises(probatio.Invalid):
        await hass.services.async_call(
            "resideo_native",
            "boost_hot_water",
            {
                "entity_id": water_state(hass).entity_id,
                "duration": duration,
            },
            blocking=True,
        )
    client.boost_hot_water.assert_not_awaited()


async def test_rejected_commands_surface_failure_without_success_state(
    hass, entry, client
):
    client.boost_hot_water.side_effect = CommandError(
        "Resideo rejected the command (HTTP 400)"
    )
    before = client.update.await_count
    with pytest.raises(HomeAssistantError, match="HTTP 400"):
        await hass.services.async_call(
            "resideo_native",
            "boost_hot_water",
            {
                "entity_id": water_state(hass).entity_id,
            },
            blocking=True,
        )
    assert client.update.await_count == before
    assert water_state(hass).state == "auto"


async def test_no_temperature_controls(hass, entry, client):
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            "water_heater",
            "set_temperature",
            {
                "entity_id": water_state(hass).entity_id,
                "temperature": 60,
            },
            blocking=True,
        )
    client.set_temperature.assert_not_awaited()


async def test_polled_state_is_independent_from_scheduled_mode(hass, entry, client):
    raw = client.devices["T6R-parent"].raw["dhwZone"]["dhw"]
    raw["dhwState"] = "On"
    entry.runtime_data.async_set_updated_data(client.devices)
    await hass.async_block_till_done()
    assert water_state(hass).state == "auto"
    assert sensor_state(hass).state == "on"
    raw.update(status="TemporaryHold", boostDuration=60)
    entry.runtime_data.async_set_updated_data(client.devices)
    await hass.async_block_till_done()
    assert water_state(hass).state == "boost"
    assert sensor_state(hass).attributes["boost_duration"] == 60


@pytest.mark.parametrize("level", ["parent", "zone", "removed", "account_removed"])
async def test_offline_or_removed_zones_are_unavailable(hass, entry, client, level):
    device = client.devices["T6R-parent"]
    if level == "parent":
        device.raw["isAlive"] = False
    elif level == "zone":
        device.raw["dhwZone"]["isAlive"] = False
    elif level == "removed":
        del device.raw["dhwZone"]
    else:
        del client.devices["T6R-parent"]
    entry.runtime_data.async_set_updated_data(client.devices)
    await hass.async_block_till_done()
    assert water_state(hass).state == "unavailable"
    assert sensor_state(hass).state == "unavailable"


async def test_later_discovery_and_restoration_do_not_duplicate_entities(hass, client):
    device = client.devices["T6R-parent"]
    zone = device.raw.pop("dhwZone")
    entry = await load_entry(hass)
    assert not hass.states.async_all("water_heater")
    assert not [s for s in hass.states.async_all("sensor") if s.entity_id.endswith("_hot_water_state")]
    for _ in range(2):
        device.raw["dhwZone"] = zone
        entry.runtime_data.async_set_updated_data(client.devices)
        await hass.async_block_till_done()
        assert water_state(hass).state == "auto"
        assert sensor_state(hass).state == "off"
        device.raw.pop("dhwZone")
        entry.runtime_data.async_set_updated_data(client.devices)
        await hass.async_block_till_done()
        assert water_state(hass).state == "unavailable"


async def test_untraced_model_is_read_only(hass, client):
    client.devices["T6R-parent"].raw["deviceType"] = "OtherLegacyModel"
    await load_entry(hass)
    assert water_state(hass).state == "auto"
    assert water_state(hass).attributes["supported_features"] == 0
    assert sensor_state(hass).state == "off"
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            "water_heater",
            "turn_on",
            {
                "entity_id": water_state(hass).entity_id,
            },
            blocking=True,
        )
    client.set_hot_water_mode.assert_not_awaited()


async def test_diagnostics_include_dhw_without_account_material(hass, entry):
    data = await async_get_config_entry_diagnostics(hass, entry)
    assert data["integration_version"] == "0.3.2"
    assert data["thermostats"][0]["hot_water"] is None
    assert data["thermostats"][1]["hot_water"]["dhw_state"] == "Off"
    text = json.dumps(data)
    for private in (
        "T6R-parent",
        "DHW-zone-not-the-command-address",
        "private-access",
        "private-refresh",
        "Second thermostat",
        "Test home",
    ):
        assert private not in text


async def test_unload_and_reload_leave_one_set_of_entities(hass, entry, client):
    coordinator = entry.runtime_data
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert not coordinator._listeners
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert water_state(hass).state == "auto"
    assert sensor_state(hass).state == "off"


def lagging_server(client, reports_after, **dhw):
    """Report a command's result only from the selected account read onwards."""
    calls = 0

    async def update():
        nonlocal calls
        calls += 1
        if calls >= reports_after:
            client.devices["T6R-parent"].raw["dhwZone"]["dhw"].update(dhw)
        return client.devices

    client.update.reset_mock()
    client.update.side_effect = update


async def test_lagging_server_is_read_back_until_it_shows_the_command(hass, entry, client):
    lagging_server(client, 3, status="PermanentHold", dhwState="Off")
    with patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (0, 0, 0)):
        await hass.services.async_call(
            "water_heater", "set_operation_mode",
            {"entity_id": water_state(hass).entity_id, "operation_mode": "off"},
            blocking=True,
        )
        await hass.async_block_till_done(wait_background_tasks=True)
    assert water_state(hass).state == "off"
    assert client.update.await_count == 3
    client.set_hot_water_mode.assert_awaited_once_with("T6R-parent", "off")


async def test_read_back_stops_when_the_first_read_shows_the_command(hass, entry, client):
    lagging_server(client, 1, status="PermanentHold", dhwState="On")
    with patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (0, 0, 0)):
        await hass.services.async_call(
            "water_heater", "turn_on", {"entity_id": water_state(hass).entity_id}, blocking=True
        )
        await hass.async_block_till_done(wait_background_tasks=True)
    assert water_state(hass).state == "on"
    assert client.update.await_count == 1
    assert not entry.runtime_data._read_back_tasks


async def test_read_back_is_bounded_when_the_server_never_shows_it(hass, entry, client):
    lagging_server(client, 99, status="PermanentHold", dhwState="Off")
    with patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (0, 0, 0)):
        await hass.services.async_call(
            "water_heater", "turn_off", {"entity_id": water_state(hass).entity_id}, blocking=True
        )
        await hass.async_block_till_done(wait_background_tasks=True)
    assert water_state(hass).state == "auto"
    assert client.update.await_count == 4
    client.set_hot_water_mode.assert_awaited_once_with("T6R-parent", "off")
    assert not entry.runtime_data._read_back_tasks


@pytest.mark.parametrize(
    ("service", "data"),
    [
        ("set_hvac_mode", {"hvac_mode": "off"}),
        ("set_temperature", {"temperature": 20}),
        ("set_preset_mode", {"preset_mode": "permanent_hold"}),
    ],
)
async def test_heating_commands_keep_one_read_without_followups(hass, entry, client, service, data):
    client.update.reset_mock()
    entity_id = hass.states.async_all("climate")[0].entity_id
    with patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (0, 0, 0)):
        await hass.services.async_call(
            "climate", service, {"entity_id": entity_id, **data}, blocking=True
        )
        await hass.async_block_till_done(wait_background_tasks=True)
    assert client.update.await_count == 1
    assert not entry.runtime_data._read_back_tasks


async def test_heating_command_does_not_cancel_hot_water_verification(hass, entry, client):
    coordinator = entry.runtime_data
    with patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (3600, 3600, 3600)):
        await hass.services.async_call(
            "water_heater", "turn_on", {"entity_id": water_state(hass).entity_id}, blocking=True
        )
        pending = coordinator._read_back_tasks["hot_water:T6R-parent"]
        await hass.services.async_call(
            "climate", "set_hvac_mode",
            {"entity_id": hass.states.async_all("climate")[0].entity_id, "hvac_mode": "off"},
            blocking=True,
        )
        assert coordinator._read_back_tasks["hot_water:T6R-parent"] is pending
        assert not pending.done()
        client.set_mode.assert_awaited_once()


async def test_newer_hot_water_command_replaces_only_its_verification(hass, entry, client):
    coordinator = entry.runtime_data
    target = {"entity_id": water_state(hass).entity_id}
    with patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (3600, 3600, 3600)):
        await hass.services.async_call("water_heater", "turn_on", target, blocking=True)
        old = coordinator._read_back_tasks["hot_water:T6R-parent"]
        await hass.services.async_call("water_heater", "turn_off", target, blocking=True)
        await hass.async_block_till_done()
        current = coordinator._read_back_tasks["hot_water:T6R-parent"]
        assert old.cancelled()
        assert current is not old and not current.done()
        assert client.set_hot_water_mode.await_count == 2
        assert client.set_hot_water_mode.await_args.args == ("T6R-parent", "off")


async def test_two_hot_water_zones_keep_independent_verification(hass, client):
    payload = dhw_locations()
    payload[0]["devices"][1]["dhwZone"] = deepcopy(payload[0]["devices"][-1]["dhwZone"])
    client.devices = parse_locations(payload)
    entry = await load_entry(hass)
    coordinator = entry.runtime_data
    waters = hass.states.async_all("water_heater")
    assert len(waters) == 2
    with patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (3600, 3600, 3600)):
        for state in waters:
            await hass.services.async_call(
                "water_heater", "turn_on", {"entity_id": state.entity_id}, blocking=True
            )
        assert len(coordinator._read_back_tasks) == 2
        assert all(not task.done() for task in coordinator._read_back_tasks.values())
        assert {call.args[0] for call in client.set_hot_water_mode.await_args_list} == {
            "T6-test", "T6R-parent"
        }


async def test_failed_refresh_cannot_confirm_previous_matching_data(hass, entry, client):
    client.devices["T6R-parent"].raw["dhwZone"]["dhw"].update(
        status="PermanentHold", dhwState="On"
    )
    client.update.reset_mock()
    client.update.side_effect = [CannotConnect("network failure"), client.devices]
    with patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (0, 0, 0)):
        await hass.services.async_call(
            "water_heater", "turn_on", {"entity_id": water_state(hass).entity_id}, blocking=True
        )
        await hass.async_block_till_done(wait_background_tasks=True)
    assert client.update.await_count == 2
    assert water_state(hass).state == "on"
    client.set_hot_water_mode.assert_awaited_once()


@pytest.mark.parametrize("error", [RateLimited(120), AuthenticationError("Sign in again")])
async def test_read_back_stops_on_rate_limit_or_reauthentication(hass, entry, client, error):
    client.update.reset_mock()
    client.update.side_effect = error
    with patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (0, 0, 0)):
        await hass.services.async_call(
            "water_heater", "turn_on", {"entity_id": water_state(hass).entity_id}, blocking=True
        )
        await hass.async_block_till_done(wait_background_tasks=True)
    assert client.update.await_count == 1
    assert not entry.runtime_data._read_back_tasks
    client.set_hot_water_mode.assert_awaited_once()


async def test_unknown_mode_does_not_confirm_boost_cancellation(hass, entry, client):
    client.devices["T6R-parent"].raw["dhwZone"]["dhw"]["status"] = "VacationHold"
    lagging_server(client, 3, status="NoHold", dhwState="Off")
    with patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (0, 0, 0)):
        await hass.services.async_call(
            "resideo_native", "cancel_hot_water_boost",
            {"entity_id": water_state(hass).entity_id}, blocking=True,
        )
        await hass.async_block_till_done(wait_background_tasks=True)
    assert client.update.await_count == 3
    assert water_state(hass).state == "auto"
    client.cancel_hot_water_boost.assert_awaited_once()


@pytest.mark.parametrize("level", ["parent", "zone"])
async def test_offline_data_does_not_confirm_requested_mode(hass, entry, client, level):
    device = client.devices["T6R-parent"]
    lagging_server(client, 1, status="PermanentHold", dhwState="On")
    report = client.update.side_effect

    async def update():
        (device.raw if level == "parent" else device.raw["dhwZone"])["isAlive"] = False
        return await report()

    client.update.side_effect = update
    with patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (0, 0, 0)):
        await hass.services.async_call(
            "water_heater", "turn_on", {"entity_id": water_state(hass).entity_id}, blocking=True
        )
        await hass.async_block_till_done(wait_background_tasks=True)
    assert client.update.await_count == 4
    assert water_state(hass).state == "unavailable"


async def test_unload_cancels_pending_readbacks_without_later_reads(hass, entry, client):
    coordinator = entry.runtime_data
    with patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (3600, 3600, 3600)):
        await hass.services.async_call(
            "water_heater", "turn_on", {"entity_id": water_state(hass).entity_id}, blocking=True
        )
        pending = list(coordinator._read_back_tasks.values())
        before = client.update.await_count
        assert await hass.config_entries.async_unload(entry.entry_id)
        await hass.async_block_till_done(wait_background_tasks=True)
    assert pending and all(task.cancelled() for task in pending)
    assert client.update.await_count == before
    assert not coordinator._read_back_tasks and not coordinator._read_back_requests


async def test_older_service_completion_cannot_replace_newer_command(hass, entry, client):
    coordinator = entry.runtime_data
    first_started = asyncio.Event()
    release_first = asyncio.Event()
    refresh_calls = 0

    async def refresh():
        nonlocal refresh_calls
        refresh_calls += 1
        if refresh_calls == 1:
            first_started.set()
            await release_first.wait()
        await coordinator.async_refresh()

    with (
        patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (3600, 3600, 3600)),
        patch.object(coordinator, "async_request_refresh", side_effect=refresh),
    ):
        first = hass.async_create_task(coordinator.async_command(
            client.set_hot_water_mode("T6R-parent", "on"),
            lambda data: data["T6R-parent"].hot_water.operation_mode == "on",
            read_back_key="hot_water:T6R-parent",
        ))
        await first_started.wait()
        await coordinator.async_command(
            client.set_hot_water_mode("T6R-parent", "off"),
            lambda data: data["T6R-parent"].hot_water.operation_mode == "off",
            read_back_key="hot_water:T6R-parent",
        )
        newest = coordinator._read_back_tasks["hot_water:T6R-parent"]
        release_first.set()
        await first
        assert coordinator._read_back_tasks["hot_water:T6R-parent"] is newest
        assert not newest.done()


async def test_pre_command_inflight_read_cannot_confirm_command(hass, entry, client):
    coordinator = entry.runtime_data
    started = asyncio.Event()
    finish = asyncio.Event()
    client.update.reset_mock()
    calls = 0

    async def update():
        nonlocal calls
        calls += 1
        if calls == 1:
            started.set()
            await finish.wait()
        return client.devices

    client.devices["T6R-parent"].raw["dhwZone"]["dhw"].update(
        status="PermanentHold", dhwState="On"
    )
    client.update.side_effect = update
    old_refresh = hass.async_create_task(coordinator.async_refresh())
    await started.wait()
    with (
        patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (0, 0, 0)),
        patch.object(coordinator, "async_request_refresh", new=AsyncMock()),
    ):
        await hass.services.async_call(
            "water_heater", "turn_on", {"entity_id": water_state(hass).entity_id}, blocking=True
        )
        finish.set()
        await old_refresh
        await hass.async_block_till_done(wait_background_tasks=True)
    assert client.update.await_count == 2
    client.set_hot_water_mode.assert_awaited_once()


@pytest.mark.parametrize(
    ("mode", "status", "state"),
    [("auto", "NoHold", "Off"), ("boost", "TemporaryHold", "On")],
)
async def test_auto_and_boost_wait_for_reported_mode(hass, entry, client, mode, status, state):
    client.devices["T6R-parent"].raw["dhwZone"]["dhw"].update(
        status="PermanentHold", dhwState="Off"
    )
    lagging_server(client, 3, status=status, dhwState=state)
    with patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (0, 0, 0)):
        await hass.services.async_call(
            "water_heater", "set_operation_mode",
            {"entity_id": water_state(hass).entity_id, "operation_mode": mode}, blocking=True,
        )
        await hass.async_block_till_done(wait_background_tasks=True)
    assert client.update.await_count == 3
    assert water_state(hass).state == mode
    if mode == "boost":
        client.boost_hot_water.assert_awaited_once_with("T6R-parent", 30)
    else:
        client.set_hot_water_mode.assert_awaited_once_with("T6R-parent", "auto")


async def test_normal_poll_confirmation_avoids_extra_read(hass, entry, client):
    coordinator = entry.runtime_data
    client.update.reset_mock()
    with patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (0, 0, 0)):
        await coordinator.async_command(
            client.set_hot_water_mode("T6R-parent", "on"),
            lambda data: data["T6R-parent"].hot_water.operation_mode == "on",
            read_back_key="hot_water:T6R-parent",
        )
        client.devices["T6R-parent"].raw["dhwZone"]["dhw"].update(
            status="PermanentHold", dhwState="On"
        )
        await coordinator.async_refresh()
        await hass.async_block_till_done(wait_background_tasks=True)
    assert client.update.await_count == 2  # immediate GET plus the normal poll
    assert water_state(hass).state == "on"
    assert not coordinator._read_back_tasks


async def test_rejected_new_command_keeps_accepted_command_verification(hass, entry, client):
    coordinator = entry.runtime_data
    target = {"entity_id": water_state(hass).entity_id}
    with patch("custom_components.resideo_native.coordinator.READ_BACK_DELAYS", (3600, 3600, 3600)):
        await hass.services.async_call("water_heater", "turn_on", target, blocking=True)
        accepted = coordinator._read_back_tasks["hot_water:T6R-parent"]
        client.set_hot_water_mode.side_effect = CommandError("Rejected new command")
        with pytest.raises(HomeAssistantError, match="Rejected new command"):
            await hass.services.async_call("water_heater", "turn_off", target, blocking=True)
        assert coordinator._read_back_tasks["hot_water:T6R-parent"] is accepted
        assert not accepted.done()
