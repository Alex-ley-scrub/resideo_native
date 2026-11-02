# Resideo Native — publication and HACS checks

The prepared version is **v0.3.2**. Its integration is based on the supplied
0.3.1 archive plus PR #6's bounded command readback and the reviewed corrections.
The integration version, frontend asset version and package metadata agree.
This local package has not been pushed, tagged or released on GitHub.
The steps below describe a later publication, not an already completed one.

1. Run repository packaging, Python/HA, JavaScript and browser checks.
2. Push the reviewed source to main. The Validate Resideo Native workflow runs
   five jobs: packaging/compilation, Python/HA, editor/browser, HACS and Hassfest.
   There are no HACS ignores or disabled checks.
3. Publication is gated on a successful push validation of the current main
   commit. A stale commit is skipped. The release workflow is restricted to the
   authorized 0.3.2 version and never replaces an existing release.
4. The workflow creates the v0.3.2 tag/full GitHub Release from that exact commit,
   uses RELEASE_NOTES_0.3.2.md, and attaches a source ZIP plus SHA256. Its release
   body links the successful validation run and commit.
5. Verify the release tag, commit, assets and completed HACS/Hassfest jobs. HACS
   downloads the integration from the normal repository release source;
   zip_release remains disabled.
6. Install/update through HACS Custom repositories, category Integration,
   using https://github.com/Kosztyk/resideo_native, then restart Home Assistant.

Historical HACS catalog PR [#12444](https://github.com/hacs/default/pull/12444)
was closed before this release. Publishing this version and running its checks
does not itself add the integration to the default catalog or reopen that PR.
Any later catalog submission should use the new release, exact passing run and
[scoped hardware evidence](docs/TESTING_2026-10-27.md).

[Validation workflow](https://github.com/Kosztyk/resideo_native/actions/workflows/validate.yml)
· [HACS requirements](https://www.hacs.xyz/docs/publish/include/)
