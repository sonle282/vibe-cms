# Security

## Reporting a vulnerability

Please **do not open a public issue** for a security problem in Vibe CMS.

Report it privately instead:

- GitHub: **Security → Report a vulnerability** on this repository (private advisory), or
- email the maintainer at the address on the [sonle282](https://github.com/sonle282) GitHub profile.

Include what you found, the steps to reproduce it, the version (release tag or commit), and the impact you expect. You
will get an answer within 7 days. A fix is released as a patch version and the advisory is published after sites have
had time to update.

## Scope

- The package code in this repository (`src/`, the Astro routes it injects, the CLI once it exists).
- Not in scope: the demo site's invented content, or a site's own code and Cloudflare / GitHub configuration.

## What this repository never contains

Secrets, tokens, `.env` / `.dev.vars` files, or any customer site's data. CI scans the whole git history for secrets
(gitleaks) on every push and pull request. If you spot something that looks like a secret, report it as above — a
leaked secret is revoked and replaced, not only deleted from the repository.
