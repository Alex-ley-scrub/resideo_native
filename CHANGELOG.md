# Changelog

## 0.3.2 — Confirm hot-water modes after delayed cloud updates

- Incorporate the bounded command readback proposed by Alex-ley-scrub in
  [PR #6](https://github.com/Kosztyk/resideo_native/pull/6): one immediate read,
  then up to three GETs separated by 5, 10 and 15 seconds, stopping on confirmation.
- Keep commands without a confirmation check, including heating temperature,
  HVAC mode and hold commands, at one immediate refresh.
- Track hot-water verification separately per device. Supersede only the same
  zone's accepted command, protect against out-of-order service completion and
  cancel tasks on account unload/reload.
- Require a successful response from a request started after the command,
  plus a known mode on an online DHW zone. Unknown mode cannot confirm boost
  cancellation; failed reads cannot reuse stale data as proof of success.
- Reuse confirmation supplied by a normal poll; stop extra reads on rate
  limiting or reauthentication. Never repeat the write.
- Update integration/editor versions, release metadata, documentation and the
  HA regression suite. The configured account and schedule polling intervals,
  availability behavior, and schedule protocol remain as in 0.3.1.
- Built from the supplied 0.3.1 integration. Local package only; no GitHub
  publication or live heating commands were performed for this build.

## 0.3.1 — Cloud schedules, visual editor and verified Jasper/DHW results

First published release after 0.1.8, consolidating the local schedule builds
developed on 27 October 2026:

- Import/edit heating and hot-water schedules using response actions and a
  visual editor, with per-day merging, backups, copying and reviewed saves.
- Support individual row/day deletion, native schedule On/Off, visible editor
  entities, a Geofencing left/right switch with setup/review popups and an
  optional sidebar switch (Off by default).
- Validate EMEA write fields and the DHW 10-minute grid; retry readback GETs
  without replaying PUTs or treating accepted delivery as confirmed application.
- Record the requester's verified 0.3.1 heating/DHW schedule and Off tests on
  T6H700RW4011 / firmware 6.0.1.50 / HA OS 2026.10.4, plus a working DHW boost.
- Document native Off frost protection without adding a frost control.
- Declare the HTTP component used by the editor's static asset registration,
  correcting the dependency issue detected by the release's Hassfest run.

- Follow the Android app's final legacy serializer: `sleepMode.triggers` contains
  the sleep start/end and all seven native day names. 0.3.0 incorrectly sent the
  internal model's flat start/end fields.
- Check sleep day coverage during readback while allowing harmless day ordering
  and time formatting differences. Uncertain readback never repeats the PUT.
- Add an independent wire fixture for the reported 25/25/23°C, 22:00–09:00 case
  and regression coverage for creation, editing and incomplete readback.
- Include all Python/HA, JavaScript and browser regression tests and gate
  publication on HACS, Hassfest and the full validation workflow. The maintainer
  reports working Geofencing; specific sleep-write acceptance remains unconfirmed.

The entries below describe historical local iterations, not separate published
GitHub releases. Their original testing limitations are superseded where the
0.3.1 evidence matrix records a later successful test.

## 0.3.0 — Geofencing mode switch, popup flows and sleep settings

- Replace the Geofencing Press button with a genuine left/right switch.
- On opens Home/Away setup; Off opens timed-week setup, over the current HA page.
- Both flows have a separate review/confirmation step and Save. Cancel leaves
  the observed cloud mode unchanged; no optimistic mode is published.
- Add create/edit/remove sleep settings to the popup and existing editor, with
  overnight start/end times, temperature validation and native app request shape.
- Read mode at startup, once per minute and after schedule action readback.
- Remove only the obsolete Geofencing button registry entries during upgrade.
- Local archive only; no live deployment or GitHub publication.

## 0.2.9 — Geofencing Press opens the Home/Away form

- Route the native device-page Geofencing Press control to the selected
  thermostat's profile form, using the existing reviewed editor flow.
- Opening setup sends no command and does not invent missing temperatures.
- Direct service calls with no profile create an actionable setup notification
  and expose setup_required instead of raising the old missing-profile error.
- Leave unrelated/disabled button rows unchanged and avoid patching HA services.
- Verify Press → setup → reviewed Save in the local browser harness.
- Local archive only; no live deployment or GitHub publication.

## 0.2.8 — Sidebar and Geofencing controls on thermostat devices

- Add a visible Add scheduler to sidebar switch beside Heating schedule.
  Persist the same account option and synchronize all its thermostat switches.
- Add a native Switch to Geofencing button. Press reuses a returned native
  Home/Away profile with fresh revision checking and bounded readback.
- Do not write when profile values are missing. Clicking the button entity's
  name opens its scoped Geofence draft for owner-entered values and review.
- Handle climate registration/renaming when building the button's editor link.
- Add English/Romanian names, device/service/navigation regression coverage.
- Local archive only; no live deployment or GitHub publication.

## 0.2.7 — Add scheduler to sidebar

- Add a visible **Add scheduler to sidebar** toggle at the top of the editor,
  Off by default, with persisted account state and removal through the same toggle.
- Use fresh HA options to preserve the account's polling/default-hold settings.
- Apply sidebar-only changes without reloading thermostat controls.
- Preserve the shared sidebar lifecycle across accounts and protect unsaved drafts.
- Local archive only; no live deployment or GitHub publication.

## 0.2.6 — Resume inactive routines and expose Geofencing buttons

- Remove timed-period coverage validation from native On/Off; accept recognized
  inactive None responses without creating/replacing a routine.
- Refresh the routine after native status readback, retaining confirmed status
  success if routine refresh fails and requiring reload before editing.
- Add explicit Switch to Geofencing / Switch to timed schedule buttons opening
  the existing reviewed mode-change draft.
- Include bounded server validation details for the native status endpoint.
- Record the live 0.2.5 inspection without claiming an Off → On reproduction.
- Local archive only; full live retest of the correction remains pending.


## 0.2.5 — Visible editor entities, native schedule On/Off and delayed readback

- Add a Schedule editor entity opening the selected thermostat/account.
- Add Heating schedule switches using the app's dedicated Schedule/Status API;
  remove the hold-command substitute. Keep native HA Configure options.
- Derive enabled state from native scheduleStatus; missing status is unknown.
- Retry GET verification after accepted writes; never retry the write.
- Return persistent discrepancies as readback_unconfirmed with observed/requested
  values; retain the draft and require reload before another save.
- Match the app's 10-minute DHW time grid and update the invalid 07:05 test to 07:10.
- Record the requester's 0.2.3 deletion/restoration evidence without claiming
  visual-editor or DHW time-edit success.
- Local-only archive; no GitHub publication. New flows need live acceptance.


## 0.2.4 — Integration access and heating schedule controls

- Open the editor from the integration Configure gear or device configuration
  link, scoped to its account. Hide the sidebar by default; make it optional.
- Keep polling/default-hold settings accessible through HA's native options flow.
- Require a populated weekday and weekend day for heating saves/resume, following
  the maintainer's native-app observation; allow other days to be empty.
- Add reviewed pause/resume using PermanentHold/NoHold without deleting periods
  or changing HVAC mode.
- Add explicit Timed/Geofence selection with user Home/Away temperatures, unit
  conversion, returned sleep preservation, revision checks and readback.
- Require a backup or owner-entered routine when the cloud omits inactive timed
  data; leave phone geofence setup and sleep editing in the official app.
- Add protocol, HA HTTP/options, logic and browser coverage plus device-specific
  Markdown test guides. New controls still require live acceptance.
- Local test build only; no GitHub push or release publication.


## 0.2.3 — Keep empty Timed routines editable and identify the loaded editor

- Treat an existing heating `Timed` routine as editable even when its entire
  week is empty; permit restoring one day without requiring seven filled days.
- Keep explicit no-schedule creation and geofence conversion validation.
- Serve the sidebar module through a versioned filename and use a versioned
  custom-element name so an already-imported older class cannot own the sidebar.
- Show the actual frontend build as **Editor 0.2.3** in the heading.
- Add protocol/UI regressions for the empty-week cycle and an older registered
  editor, and keep local/remote evidence distinct.

## 0.2.2 — Delete the last period of an existing schedule day

- Allow explicit empty day lists when editing an existing heating or DHW routine.
- Preserve all other days, including existing empty days, without adding defaults.
- Show cleared days explicitly in review; sending still requires Save and readback.
- Permit empty days in copied drafts and imported backups of existing routines.
- Retain creation/conversion validation and revision checks; these are deferred
  from current live testing.
- Add protocol and browser regressions for deleting one of several periods,
  deleting the last period, conflicts and failed readback.

## 0.2.1 — Preserve EMEA periods and untouched empty days

- Remove cancellation filtering and whole-week empty-day rejection from EMEA
  serialization; preserve native period data and unchanged empty cloud days.
- Keep edited-day and full-week creation/conversion validation.
- Distinguish pre-write validation errors in the editor from uncertain delivery.
- Add regressions for cancellation metadata, empty days and frontend saves.


## 0.2.0 — Visual editor and explicit schedule creation/conversion

- Add an admin sidebar editor and optional HA dashboard card for heating/DHW.
- Support blank-week creation and explicit, revision-checked geofence conversion.
- Add daily editing, copying, review, backups, local drafts and conflict handling.
- Preserve the live-verified EMEA write-schema correction from 0.1.14.
- Add frontend lifecycle, browser and conversion regression coverage.
- Heating schedule HA/app synchronization was confirmed by the maintainer on
  0.1.14; new DHW schedule/creation/conversion hardware checks remain pending.


## 0.1.9 — Cloud schedule actions (local test build)

- Add heating and DHW schedule GET/SET actions, per-device targeting, partial
  week updates, revision conflict checks and post-write readback.
- Support full-week creation when the cloud reports no timed schedule.
- Validate ordered times, displayed-unit temperatures and limited Jasper scope.
- No automatic schedule writes, default routines or GitHub publication.
- Live schedule import, editing and app synchronization await tester confirmation.


## 0.1.8 — Jasper/T6R domestic hot water

- Discover nested `dhwZone` data and add a hot-water entity plus an on/off state sensor to the parent thermostat device.
- Add follow schedule, permanent on/off and 30/60/90-minute boost/cancel commands traced in Resideo Android 6.21.1.
- Use the parent thermostat ID for the mobile API DHW routes; keep all thermostat climate behavior and shared polling.
- Expose the reported hold, boost, vacation, geo-boost and schedule fields without inventing water temperatures or optimistic command results.
- Disable DHW writes for untraced models; reject missing or offline zones and unsupported durations before sending.
- Restore the earlier protocol/HA regression tests and add DHW protocol, service, discovery and lifecycle tests.
- Align the diagnostic version constant with the manifest.
- User confirms DHW readings and on/off/auto against the app and physical
  Jasper/T6R on HA 2026.10.4; boost and cancellation await hardware testing.

## 0.1.7 — HACS physical-write verification documentation

- Document maintainer-confirmed real-device command acceptance on a physical
  Lyric T6 Pro thermostat (internal model Jasper, owner-reported firmware 6.0.1.50) for HVAC mode, target setpoint and hold/preset controls.
- Explicitly distinguish **Jasper** hardware evidence from unverified other
  devices and firmware builds; firmware 6.0.1.50 is owner-reported and not surfaced by HA.
- Remove obsolete claims that **no** real thermostat command testing exists.
- Preserve existing climate/protocol code; no changes to motor, heating,
  login, setpoint, schedule or other runtime behavior.
- Refresh documentation and version metadata for HACS PR #12444.

## 0.1.6 — HACS publication readiness

- Add HACS and Home Assistant Hassfest validation workflows.
- Add static repository checks and Python packaging tests.
- Add a guarded GitHub release workflow that runs only after the main branch
  has passed validation.
- Correct the HACS display name and link the integration documentation and
  issue tracker to its repository.
- Canonicalize the MIT license file name and clarify README testing scope.
- Keep integration version metadata consistent with the release number.

**Thermostat control, authentication and Resideo network protocol behavior are unchanged.**

## 0.1.5

Previous published release. See the repository's GitHub Releases for its history.
