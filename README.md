<img width="1176" height="269" alt="dark_logo@2x" src="https://github.com/user-attachments/assets/f92124ae-9edb-4260-914d-d42453e9e2c1" />

# Resideo Native for Home Assistant

Control Honeywell Home / Resideo **Lyric T6 and T6R** thermostats from Home Assistant using your normal **Resideo Smart Home** account.

**No Resideo developer account, consumer key, consumer secret, SmartThings connection, or HomeKit pairing is required.**

This is an independent community integration for the legacy Resideo / Honeywell Home cloud service used by European Lyric thermostats. Internet access and an available Resideo service are required; this is not local LAN control.

> **Hardware-tested write controls:** The maintainer confirms successful thermostat operation using this Home Assistant integration on a physical **Honeywell Home Lyric T6 Pro** thermostat (internally reported as **Jasper** by Home Assistant), including HVAC mode, target temperature and hold/preset commands. The owner reports **firmware 6.0.1.50** from the physical thermostat; Home Assistant separately reports the internal model as `Jasper` and leaves `sw_version` blank. This confirmation is limited to the actual device tested; other model/firmware combinations remain unverified. Offline packaging checks cannot independently prove physical command acceptance. See [VALIDATION.md](VALIDATION.md).

**Quick links:** [Installation](#installation) · [Schedule editor](#schedule-entities-and-editor-032) · [Testing evidence](docs/TESTING_2026-10-27.md) · [Updating](#updating) · [Troubleshooting](#troubleshooting)

## Compatibility

| Device or service | Support |
| --- | --- |
| Honeywell Home Lyric T6 Pro (internally `Jasper`), firmware `6.0.1.50` | Maintainer reports successful physical operation of mode, setpoint and hold commands | 
| Honeywell Home Lyric T6R `T6H700RW4011` (internally `Jasper`), firmware `6.0.1.50`, UK/EMEA | Requester confirms heating/DHW schedule reads, edits, deletion/restoration, DHW boost and real HVAC Off on HA OS 2026.10.4; see [testing evidence](docs/TESTING_2026-10-27.md) |
| Other European Lyric T6 / T6R variants on the legacy Resideo Smart Home backend | Discovered/supported by code; device/firmware write behavior requires separate verification |
| Other thermostats using the same legacy API | May work; not individually verified |
| First Alert / Auth0 / Titan-only accounts or devices | Not supported |
| Total Connect Comfort or Total Connect security systems | Not supported |

The integration is based on the protocol used by Resideo Smart Home Android **6.21.1**. An Android phone is not required for setup.

## Features

- One `climate` entity per supported thermostat.
- Jasper/T6R domestic hot water: reported on/off state, follow schedule, always on/off, and 30/60/90-minute boost controls when a nested `dhwZone` is present.
- Bounded follow-up reads after hot-water commands, stopping when a fresh cloud response confirms the requested mode.
- Current temperature, target temperature, and device-reported temperature limits.
- Celsius/Fahrenheit handling, including the Jasper/T6 API conversion corrected in version 0.1.2.
- Heating, cooling, off, and automatic heat/cool modes when reported by the device. Heating-only models are not given cooling controls.
- Heating/cooling activity when the reported operating status can be interpreted.
- Indoor humidity when the device exposes a valid, enabled reading.
- **Follow schedule**, **Temporary hold**, and **Permanent hold** presets.
- Shared account polling, automatic discovery of newly returned thermostats, and unavailable status for offline devices.
- Automatic token refresh and reauthentication support.
- English and Romanian setup text, plus light/dark brand icons and logos.
- Read/edit heating and DHW cloud schedules through response actions or the visual editor, with backups, revision checks and bounded readback.
- Visible schedule On/Off, Geofencing setup and optional sidebar controls on supported thermostat devices.

## Command readback (0.3.2)

Resideo can accept a hot-water command before its account response shows the
new mode. After the immediate refresh, the integration waits 5 seconds before
reading again, then 10 seconds, then 15 seconds if still needed. With short
requests these reads occur roughly 5, 15 and 30 seconds after the immediate
read. The loop stops as soon as a successful fresh response confirms a known
mode on an online zone. It repeats GETs only; the command is sent once.

Heating commands retain their single immediate refresh. The configured account
poll interval and the once-per-minute schedule-mode reads remain unchanged.
An accepted newer command replaces verification for that hot-water zone only;
another zone's commands do not cancel it. A normal poll can also provide the
confirmation and avoid an extra GET. Each hot-water command adds at most three
follow-up account reads; account unload cancels pending verification.

Failed or pre-command responses cannot confirm success. Rate limiting and
reauthentication stop follow-up reads, leaving the existing client cooldown
and reauthentication flows in charge. Ordinary transient failures still use
the bounded remaining GET attempts. No optimistic state is published. If the
cloud never confirms, the last reported state remains and normal polling
continues. This change addresses delayed post-command updates; it does not
change the integration's availability policy after a failed poll.

Based on [Alex-ley-scrub's contribution, PR #6](https://github.com/Kosztyk/resideo_native/pull/6),
with fresh-response checks, per-zone cancellation and lifecycle regressions.
See [release notes](RELEASE_NOTES_0.3.2.md) and [validation](VALIDATION.md).

## Schedule entities and editor (0.3.2)

Open **Settings → Devices & services → Resideo Native → your thermostat**.

| Entity | Purpose |
| --- | --- |
| **Heating schedule** (`switch`) | Native schedule On/Off; independent of manual holds |
| **Switch to Geofencing** (`switch`) | Right/On opens Geofencing setup; left/Off opens timed setup |
| **Add scheduler to sidebar** (`switch`) | Optional shared shortcut, Off by default; saved per account |
| **Schedule editor** (`sensor`) | Opens the full schedule page for this thermostat |

**Switch to Geofencing is a left/right switch.** The old Press entity is removed
on upgrade. Its state follows the cloud's schedule type: On for Geofence and Off
for Timed. Schedule enabled/disabled remains the separate Heating schedule switch.

- **On:** Home/Away popup → optional **Create Sleep Settings** → **Review & save**
  → confirm → **Save to Resideo**.
- **Off:** timed-week popup → edit/import your periods → **Review & save**
  → confirm → **Save to Resideo**.
- **Cancel:** closes the popup; the cloud mode and switch state remain unchanged.

The popup stays over the current HA page. No command is sent when it opens or
while a draft is edited. The switch updates after confirmed cloud readback.
Missing profile values and omitted timed routines receive no invented defaults.
Export a timed backup before changing type; inactive routines may be omitted by
Resideo. Sleep start/end and night temperature support overnight periods. The
same create/edit/remove sleep controls are available in the existing editor,
including **Edit Geofencing settings** for an already active profile.

Version **0.3.1** corrects the sleep request format from 0.3.0: the final app
serializer sends a trigger array with all seven days and the sleep times.
Readback checks day coverage as well as times and temperature. See
[the protocol investigation](docs/SLEEP_PROTOCOL.md).

Replace the complete integration folder, restart HA and refresh the browser.
Confirm **Editor 0.3.2**. The editor entity, Configure options and optional sidebar
remain available. Sidebar-only changes preserve poll/default-hold values and do
not reload thermostat controls; thermostats sharing an account show one preference.

Mode is read at startup and once per minute for each supported thermostat, as
well as after schedule action readback. Phone registration/location permissions
remain in the official app. Direct switch services have no interactive browser;
they provide a setup link and leave the cloud mode unchanged. Automations can
use `set_heating_schedule_mode` with explicit values, revision and confirmation.

Existing heating/DHW period editing, backups, revision checks and bounded GET
readback are retained. No PUT is automatically replayed. DHW times follow the
app's 10-minute grid. Heating period edits retain a populated weekday and weekend
day; this minimum does not apply to native schedule On/Off.

See [editor guide](docs/SCHEDULES.md), [switch and sleep tests](docs/MODE_SWITCH_TEST_PLAN.md),
[sleep protocol](docs/SLEEP_PROTOCOL.md), and [validation](VALIDATION.md).
The requester verified heating/DHW schedule actions on 0.3.1 and the maintainer
reports successful Geofencing use. The requester's visual-editor/popup and
Geofencing/sleep paths were not tested; specific live sleep acceptance remains
unconfirmed. See [the evidence matrix](docs/TESTING_2026-10-27.md).

## Domestic hot water (Jasper / T6R)

Version **0.1.8** adds support for the nested `dhwZone` returned by the legacy
`api/v4/locations` response, as requested in issue #2. Only thermostats that
actually report this zone receive the additional entities. They are attached to
the existing thermostat device and use its shared account refresh.

- **Hot water** (`water_heater`): operating mode and control.
- **Hot water state** (`sensor`): the API's actual `dhwState` (`on` or `off`),
  including when a schedule is selected.

| Hot-water mode | Meaning |
| --- | --- |
| Follow schedule (`auto`) | Explicitly resume the existing hot-water schedule |
| Always on (`on`) | Permanent hot-water on command |
| Always off (`off`) | Permanent hot-water off command |
| Boost (`boost`) | Selecting this mode starts a 30-minute timed boost |

**Follow schedule is a mode, not an on/off reading.** For example, the water
heater can be in `auto` while the separate state sensor reports `off`. The state
sensor reports the cloud's hot-water state; it does not independently measure
whether the boiler is firing. Both entities expose `status`, `boost_duration`,
`vacation_hold_enabled`, `geo_boost_enabled`, `next_period_time`,
`schedule_day`, and `schedule_period` when the API supplies them. `boost_duration`
is the reported API field, not a locally calculated remaining-time countdown.
Unknown or vacation hold modes are not guessed; their reported status remains
visible in the attributes.

For a different boost duration, use **Developer Tools → Actions → Resideo Native:
Boost hot water**, target the hot-water entity and select **30, 60 or 90 minutes**.
The same action can be used in automations:

```yaml
action: resideo_native.boost_hot_water
target:
  entity_id: water_heater.your_thermostat_hot_water
data:
  duration: 60
```

Use your actual entity ID. **Cancel hot-water boost** sends the app's temporary
off command:

```yaml
action: resideo_native.cancel_hot_water_boost
target:
  entity_id: water_heater.your_thermostat_hot_water
```

To explicitly return to the schedule, choose **Follow schedule** in the entity,
or call:

```yaml
action: water_heater.set_operation_mode
target:
  entity_id: water_heater.your_thermostat_hot_water
data:
  operation_mode: auto
```

Turning the water-heater entity off sends **permanent off**, which is distinct
from canceling a boost. No DHW temperature reading, setpoint,
or vacation/geo-boost configuration is implemented: those measurements or
commands have not been established for this zone.

Commands were traced in the supplied Resideo Android **6.21.1** app; request
routes, JSON bodies, parent-device addressing and symbol references are in
[docs/HOT_WATER_PROTOCOL.md](docs/HOT_WATER_PROTOCOL.md). The requester confirmed DHW readings and on/off/auto against the app and
physical Jasper/T6R on HA 2026.10.4 with 0.1.8. The 0.3.1 report additionally
confirms a boost started from HA, auto/off and DHW schedule changes including
07:00 → 07:10, day clearing and restoration. Individual 30/60/90-minute durations
and explicit boost cancellation were not separately reported. Other model types
with a compatible nested zone are exposed for reading, with control disabled.
No commands are sent merely by installing this update or discovering a zone.

To install this update manually, replace the complete
`/config/custom_components/resideo_native/` folder and restart Home Assistant.
Your existing account entry and thermostat entities are retained; no new login
is required unless Resideo independently requires reauthentication.

## Requirements

| Requirement | Details |
| --- | --- |
| Home Assistant | 2026.10.0 or newer according to the HACS metadata; tested with 2026.10.2 |
| Resideo account | The account that already controls the thermostat in the official Resideo Smart Home app |
| Thermostat | Registered to that account and visible in the official app |
| Internet | Home Assistant must be able to reach Resideo's authentication and device services |
| Browser sign-in | A desktop browser; the instructions below use Google Chrome |

### Real-thermostat write verification

The maintainer reports having operated their own **Honeywell Home Lyric T6 Pro** thermostat (internally **Jasper**, **firmware 6.0.1.50**) using the
**Resideo Native** Home Assistant integration, confirming successful real-device
response to HVAC mode changes (`set_mode`), temperature setpoint changes
(`set_temperature`), and hold/preset controls (`set_hold`). These are the
three write paths called by the Home Assistant climate entity. The tested
thermostat appears as model **Jasper** in the Home Assistant device registry;
`sw_version` is **not provided by Home Assistant**, but the owner reports **firmware 6.0.1.50** from the thermostat.

This is **maintainer-reported physical testing**, not a simulation and not
proof that every model or firmware supports the same commands. The public
repository does not include recordings or device-side command logs of these
specific test operations. A reviewer may request further evidence, model
identifiers, firmware obtained from the official app, or a fresh demonstration.
See [VALIDATION.md](VALIDATION.md) for scope and limitations.

## Installation

### Manual installation

1. Download a release archive, or download this repository as a ZIP and extract it.
2. Copy the `custom_components/resideo_native` folder into Home Assistant's `custom_components` directory.
3. Confirm that this file exists:

   ```text
   /config/custom_components/resideo_native/manifest.json
   ```

4. Restart Home Assistant.
5. Open **Settings → Devices & services → Add integration** and search for **Resideo Native**.
6. Continue with one of the sign-in methods below.

Keep the integration's complete folder, including `protocol`, `translations`, and `brand`.

### HACS custom repository

If you use HACS, add this GitHub repository as a custom repository:

1. Open **HACS**, then its three-dot menu → **Custom repositories**.
2. Enter `https://github.com/Kosztyk/resideo_native` and select **Integration** as the type.
3. Add the repository and download **Resideo Native**.
4. Restart Home Assistant and add the integration under **Settings → Devices & services**.

Use the custom-repository installation until HACS maintainers approve inclusion in the default catalog. See the [HACS custom repository guide](https://www.hacs.xyz/docs/faq/custom_repositories/) for help.

## Sign-in

### Option 1: Email and password

1. Choose **Email and password**.
2. Enter the email address and password used in the official Resideo app.
3. Enter the app's two-letter country code, for example **RO** for Romania or **GB** for the United Kingdom.
4. Submit the form.

The integration uses the password for this sign-in request and does not save it. After successful setup, it stores access/refresh tokens and the country code.

If Resideo needs an additional interactive step, setup automatically continues to the browser form. This can happen even when the same credentials already work in the official app.

### Browser sign-in

Choose **Sign in in your browser**, or continue to this form when the email/password method redirects you there.

**You must copy the final app callback after signing in, not the initial HTTPS sign-in link.** Keep the Home Assistant setup form open throughout these steps.

#### A. Open the sign-in page and start recording

1. Open the **Resideo sign-in** link displayed in the current Home Assistant setup form. Use a separate desktop-browser tab and keep the Home Assistant tab open.
2. In the **Resideo sign-in tab**, open Chrome Developer Tools: press **Command + Option + J** on macOS, or **Ctrl + Shift + J** on Windows/Linux.
3. Select **Network**, choose **All** request types, and enable **Preserve log**. Do this **before signing in**. Developer Tools must stay attached to the tab where you sign in.
4. Sign in with your normal Resideo account and complete any verification or agreement prompts.
5. At the end, Chrome may report that it cannot open an application link or that no handler is registered. This is expected: the final link is intended for the native Resideo app.

#### B. Copy the final URL from Network

1. In **Network**, filter for:

   ```text
   oauth2redirect
   ```

2. Select the final request beginning with:

   ```text
   com.honeywell.acs.lyric.enterprise://oauth2redirect
   ```

   The request may be marked failed or blocked because Chrome cannot open the native app.

3. Open **Headers → General → Request URL** and copy the **entire URL**. You can also right-click the request and use **Copy → Copy URL** where available.
4. Return to the open Home Assistant form, paste it into **Complete Resideo redirect URL**, and click **Submit**.

Copy only the URL. Do not include the **Request URL** label, **Referrer policy**, surrounding quotes, or an error message. The URL can be very long; copy it completely without adding spaces or line breaks.

#### C. If the request is missing: use Console

Some browsers show the final app link only in **Console**:

1. Stay in the same Resideo tab and select **Console** in Developer Tools.
2. Find the message about failing to launch or open `com.honeywell.acs.lyric.enterprise://oauth2redirect`.
3. Copy the complete URL contained in that message, including its `state` and `code` query parameters. Exclude the surrounding message and quotes.
4. Paste that URL into Home Assistant's **Complete Resideo redirect URL** field and submit.

If neither panel contains it, repeat browser sign-in with the current setup link, opening Developer Tools and enabling **Preserve log** before submitting the login form.

Chrome's [Network panel guide](https://developer.chrome.com/docs/devtools/network) explains how to record requests and inspect their headers.

#### Which URL belongs in which place?

| URL | What to do with it |
| --- | --- |
| `https://lyricprod.b2clogin.com/.../authorize?...` | Open this link to start signing in. It is **not** the callback to paste into Home Assistant. |
| `com.honeywell.acs.lyric.enterprise://oauth2redirect/?state=...&code=...` | Copy this final URL after signing in and paste it into Home Assistant. |

Example callback shape — **the values below are placeholders**:

```text
com.honeywell.acs.lyric.enterprise://oauth2redirect/?state=EXAMPLE_STATE&code=EXAMPLE_CODE
```

A URL without the slash before `?` is also accepted:

```text
com.honeywell.acs.lyric.enterprise://oauth2redirect?state=EXAMPLE_STATE&code=EXAMPLE_CODE
```

The `code=` parameter is required. A starting sign-in link containing `code_challenge=` is not a substitute for the final callback.

#### Keep the same setup attempt

- Always use the sign-in link displayed by the **currently open** Home Assistant setup form.
- The callback contains a short-lived, single-use authorization code tied to that setup attempt.
- If setup displays a new sign-in link after a failed code exchange, sign in again using that new link.
- If Home Assistant restarts during an unfinished setup, start a new sign-in attempt.
- A locally rejected, malformed or mismatched callback does not change the current link; check that you copied the full callback from the matching attempt.
- Do not publish sign-in links, callback URLs, tokens, passwords, or authentication HAR captures in GitHub issues or logs.

After successful setup, tokens refresh automatically. You do not normally need Developer Tools again after each restart or routine integration update.

Browser sign-in uses the country selected in the email/password form when reached from that form. When opened directly from the menu, it uses Home Assistant's configured country, with **RO** as the fallback.

### Advanced: Existing refresh token

The **Refresh token (advanced)** method accepts an existing token issued to the specific legacy Resideo app client used by this integration. First Alert and developer-API tokens are not interchangeable with it. This option is not needed for normal setup.

## Using the thermostat

Each discovered thermostat appears as a Home Assistant `climate` entity. Its name comes from the Resideo account.

| Preset | Behavior |
| --- | --- |
| Follow schedule | Clears the hold so the existing thermostat schedule can resume |
| Temporary hold | Requests a temporary manual temperature override |
| Permanent hold | Requests a manual override that remains until cleared |

Manual temperature changes use **Temporary hold** by default. An active permanent hold remains permanent. Choose a different default under **Integration settings** on the schedule editor page.

In automatic heat/cool mode, set the low and high targets together. The integration validates device limits and deadband before sending them. When changing both HVAC mode and temperature, set the mode first, then set the temperature in a separate action.

### Temperature conversion

Jasper/T6 devices return Fahrenheit numeric values on their API even when their preferred display unit is Celsius. Version **0.1.2** converts readings, targets, and bounds to the preferred unit and converts commands back to the device's API encoding.

For example, API values of `78.8` and `73.4` correspond to **26 °C current temperature** and a **23 °C target**. Conversion follows the app's model-specific rules; it is not inferred from how large a reading looks.

### Options

Open **Settings → Devices & services → Resideo Native → Configure**, or
**Integration settings** on the editor page. These are Home Assistant account
options; saving them does not send a Resideo schedule command.

| Option | Default | Allowed values |
| --- | --- | --- |
| Refresh interval | 60 seconds | 30–600 seconds |
| Default hold for temperature changes | Temporary hold | Temporary or permanent hold |
| Show Resideo schedules in the sidebar | Off | On/off; also available through **Add scheduler to sidebar** in the editor |

Sidebar-only changes apply immediately without an integration reload. With
multiple accounts, one shared shortcut is visible while any account enables it.
The setting applies to Home Assistant users; it is not a per-browser preference.

One account poll serves all its thermostats. After a command, the integration requests a fresh server update rather than assuming that the command succeeded.

## Updating

For manual installations, replace `/config/custom_components/resideo_native/` with the complete folder from the new release and restart Home Assistant. For HACS installations, use HACS to download the update and restart Home Assistant.

The existing configured account is retained. Removing and re-adding the integration is not required for a routine update.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| The official app works, but setup asks for browser sign-in | Continue with the browser method. An interactive step does not by itself mean that the password is incorrect. |
| Callback rejected as incomplete or belonging to another attempt | Copy the complete native-app URL from the current setup's sign-in link, including `state` and `code`. |
| Authorization rejected or expired | Use the new sign-in link displayed by setup and retrieve a fresh callback. Authorization codes cannot be reused. |
| Cannot find `oauth2redirect` | Check Console, select all Network request types, clear unrelated filters, and keep Developer Tools open before signing in. |
| Sign-in succeeds but no thermostat is found | Confirm that the device is visible in the legacy Resideo Smart Home account. First Alert/Titan-only devices are outside this integration's scope. |
| Temperatures appear as `78.8 °C` or `73.4 °C` | Install version 0.1.2 or newer, replace the complete integration folder, and restart Home Assistant. |
| Thermostat is unavailable | Check the device in the official app, its connection, and Resideo service availability. |
| Requests are rate limited | Wait for the server's retry period rather than repeatedly attempting sign-in. |
| A command times out | Check the thermostat or official app before repeating it; a timed-out write may already have reached the device. |

For an issue report, include the integration version, Home Assistant version, thermostat model, country code, and the error text. Use **Download diagnostics** from the integration's menu when available. The diagnostic report deliberately omits account details, tokens, device/location names, addresses, MAC addresses, and device IDs.

## Current limitations

- Cloud polling; SignalR push updates are not implemented.
- No vacation creation, phone geofence setup, hot-water temperature controls, fan controls, or installer settings.
- No automatic browser callback helper or extension is included in the current release.
- The maintainer confirms physical command acceptance on their **Jasper** device; firmware `6.0.1.50` is reported by the owner, although the Home Assistant device registry does not expose it. Write behavior has not been individually verified on other models or firmware builds.
- Resideo service or authentication changes can require integration updates.

## Jasper/T6R hot-water hardware verification (user report)

The issue #2 requester reports installing **0.1.8 over 0.1.7**, restarting
**Home Assistant 2026.10.4**, and testing on **Jasper/T6R**. The integration
loaded without log errors. Both hot-water entities appeared, and state and
hold/boost/schedule attributes matched the raw `dhwZone` data.

| Command | User-confirmed result in Resideo app and physical thermostat |
| --- | --- |
| `on` | Hot water On, `PermanentHold`; always on |
| `off` | Hot water Off, `PermanentHold`; permanently off |
| `auto` | `NoHold`; schedule mode restored |

Home Assistant read each change back within a few seconds. This is the
requester's first-hand hardware report, supplied by the maintainer; it is
separate from automated tests. A later schedule report lists thermostat firmware
**6.0.1.50** and product code **T6H700RW4011**. On **0.3.1**, the same requester
confirmed a hot-water boost started from HA and ran normally, auto/off mode
changes, DHW schedule read/edit/clear/restore with verified readback, and real
HVAC Off on both heating zones. The reported boost duration was not specified;
the individual duration choices and explicit cancellation remain outside that
report. See the [full evidence matrix and source comments](docs/TESTING_2026-10-27.md).

## Frost protection

Resideo documents integral **5°C frost protection in Off mode** for European
T6/T6R thermostats. The T6H700RW4011 requester reports a fixed threshold, no
frost settings page in the app, and successful real Off commands on both zones.
The integration keeps the native Off command; it does not replace it with a
5°C heat hold or add a frost switch. No live frost-threshold reading or
activation test is claimed. See [Resideo's specification](https://homecomfort.resideo.com/sites/Romania/ro-RO/Pages/ProductGroup.aspx?cat=HW-TOEM&catpath=1.2.1.6.1&pid=Lyric+T6+Smart+Thermostat-18717%28HW-TOEM%29)
and [the requester's confirmation](https://github.com/Kosztyk/resideo_native/issues/4#issuecomment-6454440807).

## Development and validation

The included regression suite uses Home Assistant **2026.10.2** and Python
**3.14**. Editor logic and real-browser tests use Node **24** and Playwright
with a **synthetic** local HA API, without real thermostat commands.

```sh
python -m pip install -r requirements-test.txt
python -m pytest -q
python tools/check_repository.py
python -m compileall -q custom_components
npm ci
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

See [VALIDATION.md](VALIDATION.md) and [the 27 October test summary](docs/TESTING_2026-10-27.md)
for local results and separately attributed physical evidence. The
[validation workflow](https://github.com/Kosztyk/resideo_native/actions/workflows/validate.yml)
runs packaging, Python/HA, JavaScript/browser, HACS and Hassfest checks.
The release workflow publishes only after successful validation of the current
main commit; the release notes link the exact run and commit.

## License and attribution

See [LICENSE](LICENSE). Maintained by **Kosztyk**.

This project is not affiliated with Resideo or Honeywell. Product and brand names belong to their respective owners.
