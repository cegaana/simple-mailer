# Contributing

Thanks for considering a contribution. This repo is a small npm-workspaces
monorepo: the library (`simple-mailer/`, `@cegaana/simple-mailer`) and the CLI
built on top of it (`cmailer/`, `@cegaana/cmailer`).

## Getting set up

```bash
npm install     # installs dependencies and builds both workspaces
npm run typecheck && npm run lint && npm test
```

All three must be clean. See
[`docs/status-and-usage.md`](docs/status-and-usage.md) for the full test
inventory and [`docs/cli-testing-guide.md`](docs/cli-testing-guide.md) for a
copy-pasteable, start-to-finish tour of the CLI.

## Before opening a PR

```bash
npm run typecheck && npm run lint && npm test
```

Add or update tests alongside any behavior change — see `simple-mailer/tests/`
and `cmailer/tests/` for the existing patterns. In particular, the test suite
injects the clock and the sleep function rather than waiting on real timers;
see "Two techniques that make this suite fast" in
[`docs/status-and-usage.md`](docs/status-and-usage.md) before adding a test
that waits on time.

## Pull requests

Every PR to `main` needs approval from a listed owner before it can merge —
see [`.github/CODEOWNERS`](.github/CODEOWNERS). Open the PR against `main`
and wait for a review; direct pushes to `main` are not the normal path.

## Design context

[`docs/build-roadmap.md`](docs/build-roadmap.md) records the design decisions
made while building this, and why. Read it before changing core queue or
dispatch behavior, so a change doesn't quietly re-open a question that was
already settled for a specific reason.

## Releasing

`simple-mailer` and `cmailer` are versioned and published independently (each
has its own `package.json` version), but `cmailer` always declares a
dependency range on the `@cegaana/simple-mailer` version it was built and
tested against — the two must be kept in sync by hand:

1. Bump the version in the changed package's `package.json` (semver).
2. If `simple-mailer`'s version changed, update the dependency range in
   `cmailer/package.json` (`"@cegaana/simple-mailer": "^X.Y.Z"`) to match —
   this is the one step that's easy to forget and leaves the CLI pinned to a
   stale library range.
3. `npm run typecheck && npm run lint && npm test` — must be clean.
4. `npm run build`.
5. Add an entry to [`CHANGELOG.md`](CHANGELOG.md).
6. `npm publish --workspace simple-mailer` (if it changed), then
   `npm publish --workspace cmailer`. Both packages are scoped
   (`@cegaana/...`) and publish as public
   (`publishConfig.access: "public"` is already set in both).
7. Tag the release (`git tag simple-mailer@X.Y.Z` and/or `cmailer@X.Y.Z`) and
   push the tag(s) — `.github/workflows/release.yml` picks up a pushed
   `simple-mailer@*` or `cmailer@*` tag and creates the matching GitHub
   Release automatically; nothing else to do by hand.
