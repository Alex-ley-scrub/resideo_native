# Resideo Native v0.3.2 — changed files

Prepared on **2 November 2026** from the uploaded `resideo_native.zip`.
All non-cache integration files in that upload matched the published v0.3.1
tag byte for byte before modification. Tests and supporting source files were
restored from the same tag. No v0.3.2 changes from the earlier discarded
experiment were reused.

The changes incorporate [Alex-ley-scrub's PR #6](https://github.com/Kosztyk/resideo_native/pull/6),
with the reviewed corrections. This is a local package; GitHub was not modified.

## Integration files — 6 modified

Paths below are relative to `custom_components/resideo_native/`.

| File | Change |
| --- | --- |
| `coordinator.py` | Optional bounded command verification; three follow-up GETs; independent task keys per zone; same-zone supersession; fresh successful-response checks; stop on rate limit/reauthentication; unload cleanup. Heating commands retain one immediate read. |
| `water_heater.py` | Supply confirmation checks and zone-specific task keys for on/off/auto, boost and boost cancellation. Require an online zone and a known operation mode. |
| `const.py` | Change integration/diagnostics/frontend version to `0.3.2`. |
| `manifest.json` | Change integration version to `0.3.2`. |
| `www/schedule-editor.js` | Change the editor's displayed version and custom-element version to `0.3.2`. No schedule behavior change. |
| `www/schedule-entity.js` | Change popup version caption and imported versioned editor URL to `0.3.2`. |

The account poll interval, per-minute schedule-mode reads, protocol routes and
payloads, and failed-poll availability behavior remain as in v0.3.1.

## Tests — 4 modified

| File | Change |
| --- | --- |
| `tests/test_hot_water_homeassistant.py` | Add the contribution's three command-readback tests and regressions for heating request counts, overlapping commands, two DHW zones, fresh reads, network/rate/auth failures, unknown/offline states, normal polls and unloading. Update the diagnostics version assertion. |
| `tests/test_homeassistant.py` | Update the expected diagnostics version. |
| `tests/test_packaging.py` | Update the expected release version. |
| `tests/test_review_evidence.py` | Update the expected release version. |

## Build and release metadata — 4 modified

| File | Change |
| --- | --- |
| `package.json` | Align frontend test package version with `0.3.2`. |
| `package-lock.json` | Align root package versions; dependency versions stay unchanged. |
| `tools/check_repository.py` | Validate the prepared `0.3.2` version. |
| `.github/workflows/release.yml` | Align the future validated-release gate and labels with `0.3.2`; no workflow was triggered. |

## Documentation — 5 modified, 2 added

| File | Change |
| --- | --- |
| `README.md` | Document bounded hot-water readbacks, request budget and limitations; update active editor version and link. |
| `CHANGELOG.md` | Add the 0.3.2 entry and contributor attribution. |
| `START_HERE.md` | Update manual-install and version guidance; explain this build and the new readback behavior. |
| `VALIDATION.md` | Record input provenance, tests, current results, browser executable used and limitations; retain historical 0.3.1 hardware evidence. |
| `HACS_PUBLISHING.md` | Describe the prepared 0.3.2 source and future gated publication without claiming it has been published. |
| `RELEASE_NOTES_0.3.2.md` **(new)** | Describe this release, corrections, validation and installation. |
| `CHANGED_FILES.md` **(new)** | This complete list. |

**Total: 19 modified files and 2 added files.** All other source files match
the v0.3.1 baseline. Python caches, local environments, installed test packages,
browser downloads, screenshots and Git metadata are excluded from the archive.

## Validation

- **252 Python/HA tests passed, plus 55 subtests.**
- **36 JavaScript tests passed.**
- **49 Chromium browser acceptance checks passed.**
- Packaging, compilation, changed-module Ruff checks and whitespace checks passed.
- No live thermostat test or remote HACS/Hassfest result is claimed for this build.

## Installation

Copy the complete archive folder `custom_components/resideo_native/` into
Home Assistant's `/config/custom_components/resideo_native/`, restart Home
Assistant and refresh the browser. Keep the existing account and options.
The editor caption should show **Editor 0.3.2**.
