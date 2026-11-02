# Resideo Native 0.3.2 — bounded hot-water command readback

Based on the supplied v0.3.1 integration and
[Alex-ley-scrub's PR #6](https://github.com/Kosztyk/resideo_native/pull/6).

After a hot-water command, read immediately and, when needed, wait 5, then 10,
then 15 seconds between up to three follow-up GETs. Stop when a fresh response
confirms the requested mode. The command is sent once and no optimistic state
is published.

## Corrections included

- Heating commands without a confirmation keep their one immediate refresh.
- New accepted commands replace verification only for the same hot-water zone.
  Concurrent zones retain separate tasks; an older service completion cannot
  overwrite a newer request. Account unload cancels pending tasks.
- A failed response, retained data or a read started before the command cannot
  confirm success. The DHW zone must be online and have a recognized mode.
  Unknown mode cannot count as successful boost cancellation.
- A normal account poll can provide confirmation without another follow-up GET.
  Rate limiting or reauthentication stops the extra reads; existing protocol
  cooldown and sign-in handling remain in charge.
- Integration, diagnostics and editor versions consistently report 0.3.2.

The configured background account interval, once-per-minute schedule-mode reads,
schedule protocol and availability policy remain as in 0.3.1. This release
addresses delayed post-command mode updates, not issue #5's availability policy.

## Validation

Local results on 2 November 2026:

- **252 Python/HA tests passed, plus 55 subtests**, on Python 3.14.8 and
  Home Assistant 2026.10.2. The 29 existing restricted IPv6 loopback warnings
  remain; they did not fail tests.
- **36 JavaScript tests** and **49 Chromium browser acceptance checks passed**.
  Browser checks used the existing `RESIDEO_TEST_CHROMIUM` override with
  Chromium Headless Shell 141.0.7390.37. The pinned Playwright 1.62.1 package
  and project dependencies were not changed.
- Repository/HACS packaging checks, Python compilation, Ruff checks for the
  changed runtime/test modules and `git diff --check` passed.

The tests use synthetic accounts and device responses. No new live hardware
test, GitHub push, merge, tag, release or remote HACS/Hassfest run is claimed.

## Install

Replace `/config/custom_components/resideo_native/` with the complete
`custom_components/resideo_native/` folder from this archive. Restart Home
Assistant and refresh the browser; confirm **Editor 0.3.2**. Keep your existing
account entry and options. Omit Python cache files from the installation.

See [VALIDATION.md](VALIDATION.md) for provenance and earlier hardware evidence,
and [CHANGED_FILES.md](CHANGED_FILES.md) for every changed or added file.
