# Changelog

Notable changes to this project, loosely following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `simple-mailer` and
`cmailer` are versioned and published independently — see
[`CONTRIBUTING.md`](CONTRIBUTING.md#releasing) for how a release is cut.

## [Unreleased]

## simple-mailer v2.0.0 / cmailer v2.0.0 — 2026-09 — Initial public release

First open-source release, covering the full v1 scope described in
[`docs/build-roadmap.md`](docs/build-roadmap.md), plus manifest-driven sends
and template validation added just before this cut:

- SQLite-backed queue engine — 6-state job machine, atomic claiming, lease-based
  crash recovery, exponential backoff, rate-limit abort handling
- Template engine — `{{ variable }}` interpolation, `| default(...)` fallbacks,
  HTML-entity escaping
- Delivery transports — `LocalFileTransport` (credential-free),
  `GoogleWorkspaceTransport` (real Gmail OAuth2 SMTP via nodemailer), and
  `MockTransport` for tests, all behind one `EmailTransport` seam
- `cmailer` CLI — `campaign`, `template`, `suppression`, `dispatch`, and the
  one-shot `send` command, plus an all-campaign stats overview with
  dry-run/live mode auditing
- **Manifest-driven campaigns:** `cmailer send --config <file> [--preset <key>]`
  reads template slug, subject, display name, and HTML/TXT body file paths from
  a central JSON manifest with alias resolution
- **Template validation:** `cmailer template check` (alias `template validate`)
  inspects template placeholders and validates them against CSV recipient
  columns; `cmailer send` runs the same check automatically before creating a
  campaign, with optional `--strict` enforcement
- **Placeholder inspection API:** `inspectVariables` in `@cegaana/simple-mailer`
  distinguishes required placeholders from those with `| default(...)`
  fallbacks; `MailerEngine.getTemplate(idOrSlug)` added alongside it
- 99 automated tests (75 library + 24 CLI), typecheck and lint clean

See [`docs/build-roadmap.md`](docs/build-roadmap.md) for the full phase-by-phase
decision log behind this release. Versioned 2.0.0 (not 1.0.0) to reflect that
this continues the internal 1.x line's design rather than starting fresh.
