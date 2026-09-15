# @cegaana/cmailer

Command-line interface for [`@cegaana/simple-mailer`](https://www.npmjs.com/package/@cegaana/simple-mailer) —
create templates and campaigns, load recipients from CSV, and dispatch mail
through a local-file transport (no credentials, writes inspectable files) or
a real Google Workspace Gmail account.

This is the CLI half of [simple-mailer](https://github.com/cegaana/simple-mailer).
Built and maintained by [CEGAANA](https://cegaana.org).

## Install

```bash
npm install -g @cegaana/cmailer
```

## Quick start

```bash
cmailer template create --slug speaker-invite --name "Speaker invite" \
  --subject "Invitation for {{ first_name }}" --html ./body.html --text ./body.txt

cmailer campaign create --name "Alumni Meet 2026" \
  --subject "Speaker briefing for {{ first_name }}" --template speaker-invite

cmailer campaign enqueue <campaign-id> --csv ./recipients.csv

cmailer dispatch <campaign-id>   # writes real files under ./data/outbox/, no credentials needed
```

Run `cmailer --help` or `cmailer help <command>` for the full command
reference, or see the
**[CLI Testing Guide](https://github.com/cegaana/simple-mailer/blob/main/docs/cli-testing-guide.md)**
for a copy-pasteable, start-to-finish tour.

## Documentation

Full docs — CLI walkthroughs, Google Workspace setup, architecture — live in
the repository root:
[github.com/cegaana/simple-mailer](https://github.com/cegaana/simple-mailer#readme).

## License

Apache License 2.0 — see [LICENSE](https://github.com/cegaana/simple-mailer/blob/main/LICENSE) and [NOTICE](https://github.com/cegaana/simple-mailer/blob/main/NOTICE).
