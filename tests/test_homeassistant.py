"""Load the integration into real Home Assistant 2026.10.2 test instances."""

from __future__ import annotations

import time
from unittest.mock import AsyncMock, Mock, patch

import pytest
from homeassistant.config_entries import SOURCE_REAUTH, SOURCE_USER
from homeassistant.exceptions import HomeAssistantError
from pytest_homeassistant_custom_component.common import MockConfigEntry
from test_protocol import locations

from custom_components.resideo_native.diagnostics import async_get_config_entry_diagnostics
from custom_components.resideo_native.protocol import (
    AuthenticationError,
    InteractionRequired,
    Token,
)
from custom_components.resideo_native.protocol.device import parse_locations


@pytest.fixture(autouse=True)
def custom_integrations(enable_custom_integrations):
    """Allow the integration under test."""


@pytest.fixture
def client():
    client = Mock()
    client.account_id = "456"
    client.devices = parse_locations(locations())
    client.update = AsyncMock(side_effect=lambda: client.devices)
    client.get_schedule = AsyncMock(return_value={"schedule_type": "Timed", "revision": "startup", "schedule_controls_supported": True})
    client.set_temperature = AsyncMock()
    client.set_mode = AsyncMock()
    client.set_hold = AsyncMock()
    with (
        patch("custom_components.resideo_native.NativeClient", return_value=client),
        patch("custom_components.resideo_native.config_flow.NativeClient", return_value=client),
    ):
        yield client


@pytest.fixture
async def entry(hass, client):
    entry = MockConfigEntry(
        domain="resideo_native",
        unique_id="456",
        title="Resideo Native",
        data={
            "country": "RO",
            "token": Token("private-access", "private-refresh", time.time() + 3600).as_dict(),
        },
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def thermostat_state(hass):
    states = hass.states.async_all("climate")
    assert len(states) == 1
    return states[0]


async def test_setup_creates_real_climate_entity(hass, entry):
    state = thermostat_state(hass)
    assert state.state == "heat"
    assert state.attributes["current_temperature"] == 21
    assert state.attributes["temperature"] == 22
    assert state.attributes["min_temp"] == 5
    assert state.attributes["max_temp"] == 35
    assert state.attributes["hvac_action"] == "heating"
    assert state.attributes["hvac_modes"] == ["off", "heat"]
    assert state.attributes.get("current_humidity") is None


async def test_reported_fahrenheit_values_display_as_celsius(hass, entry, client):
    raw = client.devices["T6-test"].thermostat
    raw["indoorTemperature"] = 78.8
    raw["changeableValues"]["heatSetpoint"] = 73.4
    entry.runtime_data.async_set_updated_data(client.devices)
    await hass.async_block_till_done()
    state = thermostat_state(hass)
    assert state.attributes["current_temperature"] == 26
    assert state.attributes["temperature"] == 23
    assert state.attributes["target_temp_step"] == 0.5
    assert (state.attributes["min_temp"], state.attributes["max_temp"]) == (5, 35)
    assert raw["indoorTemperature"] == 78.8


@pytest.mark.parametrize(
    ("system_units", "requested", "expected_wire"),
    [("metric", 23, 73.4), ("us", 74, 74)],
)
async def test_temperature_service_reaches_correct_native_command(
    hass, entry, client, system_units, requested, expected_wire
):
    from homeassistant.helpers.aiohttp_client import async_get_clientsession
    from homeassistant.util.unit_system import US_CUSTOMARY_SYSTEM

    from custom_components.resideo_native.protocol import NativeClient, ResideoAuth

    if system_units == "us":
        hass.config.units = US_CUSTOMARY_SYSTEM
    session = async_get_clientsession(hass)
    native = NativeClient(session, ResideoAuth(session))
    native.devices = client.devices
    entry.runtime_data.client = native
    with (
        patch.object(native, "_request", new_callable=AsyncMock) as request,
        patch.object(entry.runtime_data, "async_request_refresh", new_callable=AsyncMock),
    ):
        await hass.services.async_call(
            "climate",
            "set_temperature",
            {"entity_id": thermostat_state(hass).entity_id, "temperature": requested},
            blocking=True,
        )
    request.assert_awaited_once_with(
        "PUT",
        "api/v2/locations/123/devices/T6-test/thermostat/HeatSetpoint",
        {
            "thermostatSetpoint": expected_wire,
            "thermostatSetpointStatus": "TemporaryHold",
            "unit": "Celsius",
        },
    )


async def test_auto_temperature_range_is_normalized_before_display(hass, entry, client):
    raw = client.devices["T6-test"].thermostat
    raw.update(
        {
            "allowedModes": ["Heat", "Cool", "Auto", "Off"],
            "minCoolSetpoint": 60.8,
            "maxCoolSetpoint": 95,
        }
    )
    raw["changeableValues"].update(
        {"autoChangeoverActive": True, "heatSetpoint": 68, "coolSetpoint": 75.2}
    )
    entry.runtime_data.async_set_updated_data(client.devices)
    await hass.async_block_till_done()
    state = thermostat_state(hass)
    assert state.state == "heat_cool"
    assert state.attributes["target_temp_low"] == 20
    assert state.attributes["target_temp_high"] == 24
    assert (state.attributes["min_temp"], state.attributes["max_temp"]) == (5, 35)


async def test_climate_services_call_the_shared_client(hass, entry, client):
    entity_id = thermostat_state(hass).entity_id
    await hass.services.async_call(
        "climate", "set_temperature", {"entity_id": entity_id, "temperature": 22.5}, blocking=True
    )
    client.set_temperature.assert_awaited_once_with("T6-test", heat=22.5, hold="TemporaryHold")
    await hass.services.async_call(
        "climate", "set_hvac_mode", {"entity_id": entity_id, "hvac_mode": "off"}, blocking=True
    )
    client.set_mode.assert_awaited_once_with("T6-test", "Off")
    await hass.services.async_call(
        "climate", "set_preset_mode", {"entity_id": entity_id, "preset_mode": "none"}, blocking=True
    )
    client.set_hold.assert_awaited_once_with("T6-test", "NoHold")


async def test_unsupported_cooling_is_not_sent(hass, entry, client):
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            "climate",
            "set_hvac_mode",
            {"entity_id": thermostat_state(hass).entity_id, "hvac_mode": "cool"},
            blocking=True,
        )
    client.set_mode.assert_not_called()


async def test_offline_device_becomes_unavailable(hass, entry, client):
    client.devices["T6-test"].raw["isAlive"] = False
    entry.runtime_data.async_set_updated_data(client.devices)
    await hass.async_block_till_done()
    assert thermostat_state(hass).state == "unavailable"


async def test_token_persistence_does_not_reload_the_integration(hass, entry):
    with patch.object(hass.config_entries, "async_reload", new_callable=AsyncMock) as reload:
        hass.config_entries.async_update_entry(
            entry,
            data={**entry.data, "token": Token("new", "rotated", time.time() + 3600).as_dict()},
        )
        await hass.async_block_till_done()
        reload.assert_not_awaited()
        hass.config_entries.async_update_entry(entry, options={"poll_interval": 120})
        await hass.async_block_till_done()
        reload.assert_awaited_once_with(entry.entry_id)


async def test_expired_authorization_starts_reauth(hass, entry, client):
    client.update.side_effect = AuthenticationError("Sign in again")
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    flows = hass.config_entries.flow.async_progress_by_handler("resideo_native")
    assert len(flows) == 1
    assert flows[0]["context"]["source"] == SOURCE_REAUTH


async def test_diagnostics_omit_all_account_material(hass, entry):
    import json

    text = json.dumps(await async_get_config_entry_diagnostics(hass, entry))
    data = json.loads(text)
    assert data["integration_version"] == "0.3.2"
    assert data["thermostats"][0]["units"] == "Celsius"
    assert data["thermostats"][0]["api_temperature_units"] == "Fahrenheit"
    for secret in (
        "private-access",
        "private-refresh",
        "private@example.test",
        "T6-test",
        "Test home",
        "Test thermostat",
    ):
        assert secret not in text


async def test_account_flow_stores_tokens_and_no_password(hass, client):
    async def login(auth, *args):
        auth.token = Token("test-access", "test-refresh", time.time() + 3600)
        return auth.token

    with patch("custom_components.resideo_native.config_flow.ResideoAuth.login", new=login):
        menu = await hass.config_entries.flow.async_init(
            "resideo_native", context={"source": SOURCE_USER}
        )
        assert menu["type"] == "menu"
        form = await hass.config_entries.flow.async_configure(
            menu["flow_id"], {"next_step_id": "account"}
        )
        assert form["step_id"] == "account"
        result = await hass.config_entries.flow.async_configure(
            form["flow_id"],
            {"username": "private@example.test", "password": "do-not-save", "country": "RO"},
        )
        assert result["type"] == "create_entry"
        assert result["data"]["token"]["refresh_token"] == "test-refresh"
        assert "password" not in result["data"]
        assert "username" not in result["data"]
        await hass.async_block_till_done()


@pytest.mark.usefixtures("socket_enabled")
async def test_account_flow_completes_redirected_login_without_pasting_a_url(hass, client):
    import base64
    import hashlib
    import json
    from urllib.parse import urlencode

    import aiohttp
    from aiohttp import web
    from aiohttp.test_utils import TestServer

    from custom_components.resideo_native.protocol import auth as auth_module

    authorization = {}
    paths = []
    expected_cookies = {
        "x-ms-cpim-trans=eyJ0cmFucyI6InRlc3QifQ==",
        "x-ms-cpim-cache|test_0=YWJjL2RlZis/==",
    }

    async def request(request):
        paths.append(request.path)
        if request.path.endswith("/authorize"):
            authorization.update(request.query)
            response = web.Response(status=302, headers={"Location": "/signin"})
            response.set_cookie("pre-login", "redirect-cookie")
            return response
        if request.path.endswith("/signin"):
            assert request.cookies.get("pre-login") == "redirect-cookie"
            settings = {
                "hosts": {
                    "tenant": "/lyricprod.onmicrosoft.com/B2C_1A_SignIn_Mob_HH",
                    "policy": "B2C_1A_SignIn_Mob_HH",
                },
                "csrf": "csrf-test",
                "transId": "StateProperties=test",
                "api": "CombinedSigninAndSignup",
            }
            response = web.Response(text="var SETTINGS = " + json.dumps(settings))
            for cookie in expected_cookies:
                response.headers.add("Set-Cookie", cookie + "; Path=/; HttpOnly")
            response.set_cookie("x-ms-cpim-csrf", "cookie-test")
            return response
        if request.path.endswith(("/SelfAsserted", "/confirmed")) and not expected_cookies.issubset(
            request.headers.get("Cookie", "").split("; ")
        ):
            return web.Response(status=400, text="Bad Request", content_type="text/html")
        if request.path.endswith("/SelfAsserted"):
            assert request.method == "POST"
            assert request.headers["X-CSRF-TOKEN"] == "csrf-test"
            assert request.cookies["x-ms-cpim-csrf"] == "cookie-test"
            form = await request.post()
            assert form["password"] == "do-not-save"
            return web.json_response({"status": "200"})
        if request.path.endswith("/confirmed"):
            callback = (
                auth_module.REDIRECT_URI
                + "?"
                + urlencode({"state": authorization["state"], "code": "one-time-code"})
            )
            return web.Response(status=302, headers={"Location": callback})
        assert request.path.endswith("/token")
        assert "Cookie" not in request.headers
        grant = await request.post()
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(grant["code_verifier"].encode()).digest())
            .decode()
            .rstrip("=")
        )
        assert challenge == authorization["code_challenge"]
        assert grant["code"] == "one-time-code"
        return web.json_response(
            {"access_token": "test-access", "refresh_token": "test-refresh", "expires_in": 3600}
        )

    app = web.Application()
    app.router.add_route("*", "/{tail:.*}", request)
    async with (
        TestServer(app, host="localhost") as server,
        aiohttp.ClientSession(
            cookie_jar=aiohttp.DummyCookieJar(),
            connector=aiohttp.TCPConnector(resolver=aiohttp.ThreadedResolver()),
        ) as http,
    ):
        with (
            patch.object(
                auth_module, "AUTHORITY", str(server.make_url("/lyricprod.onmicrosoft.com"))
            ),
            patch(
                "custom_components.resideo_native.config_flow.async_get_clientsession",
                return_value=http,
            ),
        ):
            menu = await hass.config_entries.flow.async_init(
                "resideo_native", context={"source": SOURCE_USER}
            )
            form = await hass.config_entries.flow.async_configure(
                menu["flow_id"], {"next_step_id": "account"}
            )
            result = await hass.config_entries.flow.async_configure(
                form["flow_id"],
                {"username": "private@example.test", "password": "do-not-save", "country": "RO"},
            )
    assert result["type"] == "create_entry"
    assert result["data"]["token"]["refresh_token"] == "test-refresh"
    assert result["data"]["country"] == "RO"
    assert not any(key in result["data"] for key in ("username", "password", "redirect_url"))
    assert len(paths) == 5
    await hass.async_block_till_done()


async def test_login_failure_can_retry_without_saving_password(hass, client):
    with patch(
        "custom_components.resideo_native.config_flow.ResideoAuth.login",
        new_callable=AsyncMock,
        side_effect=AuthenticationError("rejected"),
    ):
        form = await hass.config_entries.flow.async_init(
            "resideo_native", context={"source": SOURCE_USER}, data=None
        )
        form = await hass.config_entries.flow.async_configure(
            form["flow_id"], {"next_step_id": "account"}
        )
        result = await hass.config_entries.flow.async_configure(
            form["flow_id"],
            {"username": "private@example.test", "password": "wrong", "country": "RO"},
        )
        assert result["type"] == "form"
        assert result["errors"] == {"base": "invalid_auth"}
        assert not hass.config_entries.async_entries("resideo_native")


async def test_browser_required_login_continues_with_selected_country(hass, client, caplog):
    from urllib.parse import parse_qs, urlsplit

    with patch(
        "custom_components.resideo_native.config_flow.ResideoAuth.login",
        new_callable=AsyncMock,
        side_effect=InteractionRequired("private@example.test do-not-save private-response-token"),
    ):
        menu = await hass.config_entries.flow.async_init(
            "resideo_native", context={"source": SOURCE_USER}
        )
        form = await hass.config_entries.flow.async_configure(
            menu["flow_id"], {"next_step_id": "account"}
        )
        browser = await hass.config_entries.flow.async_configure(
            form["flow_id"],
            {"username": "private@example.test", "password": "do-not-save", "country": "GB"},
        )
    assert browser["step_id"] == "browser"
    assert browser["errors"] == {"base": "interaction_required"}
    assert "Resideo automatic sign-in fell back to browser (stage=" in caplog.text
    for secret in ("private@example.test", "do-not-save", "private-response-token"):
        assert secret not in caplog.text
    query = parse_qs(urlsplit(browser["description_placeholders"]["login_url"]).query)
    assert query["country"] == ["GB"]

    async def exchange(auth, *args):
        auth.token = Token("browser-access", "browser-refresh", time.time() + 3600)
        return auth.token

    with patch(
        "custom_components.resideo_native.config_flow.ResideoAuth.exchange_callback", new=exchange
    ):
        result = await hass.config_entries.flow.async_configure(
            browser["flow_id"], {"redirect_url": "synthetic-callback"}
        )
    assert result["type"] == "create_entry"
    assert result["data"]["country"] == "GB"
    assert "password" not in result["data"]
    assert "username" not in result["data"]
    await hass.async_block_till_done()


async def test_invalid_browser_callback_keeps_the_current_authorization(hass, client):
    menu = await hass.config_entries.flow.async_init(
        "resideo_native", context={"source": SOURCE_USER}
    )
    browser = await hass.config_entries.flow.async_configure(
        menu["flow_id"], {"next_step_id": "browser"}
    )
    original_url = browser["description_placeholders"]["login_url"]
    with patch(
        "custom_components.resideo_native.config_flow.ResideoAuth._token_request",
        new_callable=AsyncMock,
    ) as token_request:
        result = await hass.config_entries.flow.async_configure(
            browser["flow_id"],
            {
                "redirect_url": "com.honeywell.acs.lyric.enterprise://oauth2redirect/?code=x&state=wrong"
            },
        )
        token_request.assert_not_awaited()
    assert result["step_id"] == "browser"
    assert result["errors"] == {"base": "invalid_callback"}
    assert result["description_placeholders"]["login_url"] == original_url


async def test_rejected_browser_code_generates_a_fresh_link(hass, client):
    menu = await hass.config_entries.flow.async_init(
        "resideo_native", context={"source": SOURCE_USER}
    )
    browser = await hass.config_entries.flow.async_configure(
        menu["flow_id"], {"next_step_id": "browser"}
    )
    original_url = browser["description_placeholders"]["login_url"]
    with patch(
        "custom_components.resideo_native.config_flow.ResideoAuth.exchange_callback",
        new_callable=AsyncMock,
        side_effect=AuthenticationError("Expired code"),
    ):
        result = await hass.config_entries.flow.async_configure(
            browser["flow_id"], {"redirect_url": "synthetic-callback"}
        )
    assert result["errors"] == {"base": "invalid_auth"}
    assert result["description_placeholders"]["login_url"] != original_url


async def test_browser_callback_with_root_slash_completes_setup(hass, client):
    import base64
    import hashlib
    from urllib.parse import parse_qs, urlencode, urlsplit

    from custom_components.resideo_native.protocol.auth import REDIRECT_URI, ResideoAuth

    menu = await hass.config_entries.flow.async_init(
        "resideo_native", context={"source": SOURCE_USER}
    )
    browser = await hass.config_entries.flow.async_configure(
        menu["flow_id"], {"next_step_id": "browser"}
    )
    query = parse_qs(urlsplit(browser["description_placeholders"]["login_url"]).query)
    callback = (
        REDIRECT_URI + "/?" + urlencode({"state": query["state"][0], "code": "synthetic-code"})
    )

    async def token_request(auth, grant):
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(grant["code_verifier"].encode()).digest())
            .decode()
            .rstrip("=")
        )
        assert challenge == query["code_challenge"][0]
        assert grant["code"] == "synthetic-code"
        auth.token = Token("browser-access", "browser-refresh", time.time() + 3600)
        return auth.token

    with patch.object(ResideoAuth, "_token_request", new=token_request):
        result = await hass.config_entries.flow.async_configure(
            browser["flow_id"], {"redirect_url": callback}
        )
    assert result["type"] == "create_entry"
    assert result["data"]["token"]["refresh_token"] == "browser-refresh"
    assert not any(key in result["data"] for key in ("password", "username", "redirect_url"))
    await hass.async_block_till_done()


async def test_options_flow_works_on_current_homeassistant(hass, entry):
    form = await hass.config_entries.options.async_init(entry.entry_id)
    assert form["type"] == "form"
    with patch.object(hass.config_entries, "async_reload", new_callable=AsyncMock):
        result = await hass.config_entries.options.async_configure(
            form["flow_id"], {"poll_interval": 120, "default_hold": "PermanentHold"}
        )
        assert result["type"] == "create_entry"
        assert entry.options["poll_interval"] == 120
        await hass.async_block_till_done()


async def test_browser_and_refresh_token_forms_are_available(hass, client):
    for method in ("browser", "refresh_token"):
        menu = await hass.config_entries.flow.async_init(
            "resideo_native", context={"source": SOURCE_USER}
        )
        form = await hass.config_entries.flow.async_configure(
            menu["flow_id"], {"next_step_id": method}
        )
        assert form["type"] == "form"
        assert form["step_id"] == method
        if method == "browser":
            assert form["description_placeholders"]["login_url"].startswith(
                "https://lyricprod.b2clogin.com/"
            )
        hass.config_entries.flow.async_abort(form["flow_id"])


async def test_reauth_success_updates_the_existing_entry(hass, entry, client):
    async def login(auth, *args):
        auth.token = Token("reauth-access", "reauth-refresh", time.time() + 3600)
        return auth.token

    entry.async_start_reauth(hass)
    await hass.async_block_till_done()
    flows = hass.config_entries.flow.async_progress_by_handler("resideo_native")
    with (
        patch("custom_components.resideo_native.config_flow.ResideoAuth.login", new=login),
        patch.object(hass.config_entries, "async_reload", new_callable=AsyncMock),
    ):
        form = await hass.config_entries.flow.async_configure(
            flows[0]["flow_id"], {"next_step_id": "account"}
        )
        result = await hass.config_entries.flow.async_configure(
            form["flow_id"],
            {"username": "private@example.test", "password": "not-persisted", "country": "RO"},
        )
        assert result["type"] == "abort"
        assert result["reason"] == "reauth_successful"
        assert entry.data["token"]["refresh_token"] == "reauth-refresh"
        assert "password" not in entry.data
        assert len(hass.config_entries.async_entries("resideo_native")) == 1
        await hass.async_block_till_done()


async def test_reauth_rejects_a_different_resideo_account(hass, entry, client):
    async def login(auth, *args):
        auth.token = Token("wrong-access", "wrong-refresh", time.time() + 3600)
        return auth.token

    client.account_id = "other-account"
    entry.async_start_reauth(hass)
    await hass.async_block_till_done()
    flows = hass.config_entries.flow.async_progress_by_handler("resideo_native")
    with patch("custom_components.resideo_native.config_flow.ResideoAuth.login", new=login):
        form = await hass.config_entries.flow.async_configure(
            flows[0]["flow_id"], {"next_step_id": "account"}
        )
        result = await hass.config_entries.flow.async_configure(
            form["flow_id"],
            {"username": "other@example.test", "password": "not-persisted", "country": "RO"},
        )
        assert result["type"] == "abort"
        assert result["reason"] == "wrong_account"
        assert entry.data["token"]["refresh_token"] == "private-refresh"
