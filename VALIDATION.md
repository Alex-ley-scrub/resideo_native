# Validation — Resideo Native 0.3.2

## Current build — 2 November 2026

The uploaded `resideo_native.zip` reports version 0.3.1. Every non-cache
integration file was compared byte for byte with the v0.3.1 tag
(`12f6a39a14cdb50746aff1e2d30ff94203de951e`) and matched. That upload is the
runtime baseline for this build. Repository tests and historical documentation
come from the same tag.

The command-readback idea and original three regressions come from
[Alex-ley-scrub's PR #6](https://github.com/Kosztyk/resideo_native/pull/6),
head `fbb22945450843ed2f522a84501379275595fc27`. Corrections keep heating commands
at one refresh, track independent hot-water zones, guard out-of-order service
completion, cancel on unload, require successful post-command reads and reject
offline/unknown modes as confirmation. Rate limits and authentication failures
stop follow-up GETs. No command is replayed.

The new tests run against real Home Assistant 2026.10.2 / Python 3.14.8 with
synthetic devices and responses. They cover early success, delayed success,
bounded failure, heating request counts, rapid commands, two DHW zones,
transient failures, rate limiting, reauthentication, unknown/offline states,
pre-command in-flight reads, unloading and confirmation by a normal poll.

Current automated results are recorded in [the release notes](RELEASE_NOTES_0.3.2.md).
The completed local runs passed 252 Python/HA tests and 55 subtests, 36
JavaScript tests and 49 Chromium browser checks, plus packaging, compilation
and lint checks for the changed modules. The existing 29 restricted IPv6
loopback warnings remain. Browser checks used Chromium Headless Shell
141.0.7390.37 through the existing executable override because the pinned
browser download returned an invalid archive. No project dependency was changed.
No new live hardware commands, Home Assistant deployment or restart were
performed. The contributor's reported hardware timing is evidence for their
original PR build, not an independent hardware test of this corrected package.
The existing availability policy and polling intervals are unchanged.

HACS/Hassfest remote checks remain part of the included validation workflow;
local packaging checks alone are not a claim that those remote jobs passed.
This build has not been pushed or released on GitHub.

## Historical v0.3.1 baseline evidence

This release consolidates the schedule work developed on **27 October 2026**.
The runtime comes from the supplied `resideo-native-0.3.1-sleep-payload-fix.zip`.
[The complete implementation and test summary](docs/TESTING_2026-10-27.md) separates
reported physical tests, local automated checks and remaining gaps.

## Physical-device evidence

| Owner / environment | Hardware | Confirmed scope |
| --- | --- | --- |
| Maintainer | Owner-described Lyric T6 Pro, internally Jasper; owner-reported firmware 6.0.1.50 | HVAC mode, temperature and hold/preset operation; earlier heating schedule edit visible in the official app; later Geofencing use reported in issue #4 |
| ryanpalfrey, UK/EMEA, HA OS 2026.10.4 | Two Honeywell Home Lyric T6R T6H700RW4011 thermostats, Jasper, firmware 6.0.1.50, gas heating, one heat stage / no cooling | Both heating-zone reads; schedule row/day deletion and restoration with whole-week comparison; verified 0.3.1 writes; real HVAC Off accepted/reported on both zones |
| Same requester/account | Actual nested DHW zone on the downstairs system | State and on/off/auto, HA-started boost, schedule time edit on the 10-minute grid, day clearing/restoration and verified 0.3.1 readback |

The exact retail product code is established for the requester's thermostats.
Home Assistant's registry does not expose firmware (`sw_version` was null in the
maintainer inspection); firmware above is owner/app-reported, not invented from
that registry. These reports do not establish behavior on every Jasper variant.

Source comments: [0.3.1 retest](https://github.com/Kosztyk/resideo_native/issues/4#issuecomment-6451958914),
[hardware and DHW evidence](https://github.com/Kosztyk/resideo_native/issues/4#issuecomment-6452463318),
[product code and Off](https://github.com/Kosztyk/resideo_native/issues/4#issuecomment-6454440807),
and [maintainer Geofencing report](https://github.com/Kosztyk/resideo_native/issues/4#issuecomment-6452157609).

The original maintainer command evidence covers `set_mode`, `set_temperature`
and `set_hold`. The requester's later feedback reports that a temperature edit
can replace a permanent hold with a temporary one; their working order is
**temperature first, then Permanent hold**. No new live fix for that observation
is claimed in this release.

## Automated checks

The 0.3.1 source passed **230 Python/HA tests plus 55 subtests**, **36 JavaScript
tests** and **49 Chromium browser checks**. The Python harness is pinned to
Home Assistant 2026.10.2 / Python 3.14; the local run uses Python 3.14.8. There
are 29 existing IPv6 loopback warnings from the restricted test socket fixture.

The protocol tests use synthetic accounts and a localhost HTTP server. Browser
checks run the actual local JavaScript in Chromium against a synthetic HA API
and simulated native entity rows. They do not contact a real thermostat.

Coverage includes OAuth/session handling, Celsius/Fahrenheit conversion,
command validation, exact routes/bodies, parent DHW addressing, entity and
account lifecycle, diagnostics redaction, revision conflicts, untouched-day
preservation, EMEA field filtering, empty-day validation, DHW time increments,
bounded GET readback, no repeated PUT, visible switches, review/cancel flows,
sidebar preferences, backups, sleep creation/edit/removal and mobile layout.

The sleep regression first failed against 0.3.0's flat payload, then passed
against the app's final `sleepMode.triggers` serializer with all seven days.
Day order and time formatting may differ without causing a false mismatch;
missing/subset days or different values cannot confirm a new sleep write.
See [the APK trace](docs/SLEEP_PROTOCOL.md).

## HACS, Hassfest and publication

[Validate Resideo Native](https://github.com/Kosztyk/resideo_native/actions/workflows/validate.yml)
runs five independent jobs: packaging/Python compilation, the Python/HA suite,
JavaScript/browser checks, **HACS Validation** and **Hassfest Validation**.
No HACS checks are ignored. The release workflow publishes v0.3.2 only when all
jobs succeed on a push to the current main commit. Its release body records the
exact validated commit and workflow-run link. The CI checks on that commit are
the authoritative remote result, rather than a local packaging check alone.

## Limits and frost protection

The requester did not test the visual editor or either mode popup, Geofencing,
sleep, or first-time creation/conversion. The maintainer reports Geofencing
works, but specific live sleep acceptance and a complete current popup/Timed
conversion test are not established. Individual boost durations and explicit
boost cancellation were not separately reported. Native schedule On/Off is
separate from HVAC Off and holds; a full hardware Off-to-On cycle is not
established by the requester's HVAC Off test.

Resideo documents integral 5°C frost protection in Off mode for European
T6/T6R. The requester confirms their fixed setting/no app page and real Off
command acceptance. No cooling-to-threshold test or live cloud frost sensor is
claimed. No frost switch or raw-response export is added.

No new live heating commands, Home Assistant installation or restart are part
of publishing this release. Existing owner test reports supply hardware evidence.
