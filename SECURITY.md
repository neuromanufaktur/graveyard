# Security

## Reporting a vulnerability

Please report security problems privately through GitHub: open the **Security** tab of this
repository and choose **Report a vulnerability** (GitHub Security Advisories). Do not open a public
issue for it.

Include what you found, how to reproduce it and which version or commit you used. You will get an
answer in the advisory; once a fix is released the advisory is published.

## Scope

In scope: the gatekeeper and sign-in (`server/auth.js`, `server/gatekeeper.js`), the API routes,
the pipeline and anything that could expose data of a private village (repo names, commit messages,
READMEs) to people who are not signed in.

Out of scope: the content of your own `graveyard.config.json` and data files, and problems in
third-party services (GitHub, Vercel, Upstash, Anthropic); please report those to the provider.

## Supported versions

Only the latest release on the default branch gets fixes.
