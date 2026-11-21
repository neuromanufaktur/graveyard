# Deploy button (snippet)

The button clones the repository into the visitor's GitHub account and creates a Vercel project
for it. Without any environment variable the demo village is public and works as it is.

```md
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fneuromanufaktur%2Fgraveyard&project-name=graveyard&repository-name=graveyard)
```

Vercel only knows required variables for the button (`env=` in the URL): anything listed there
has to be filled in before the first deployment. That is why the snippet lists none. All of the
variables below are optional and are set later under Project Settings > Environment Variables.

| Variable | Needed for | Description |
| --- | --- | --- |
| `AUTH_SECRET` | sign-in (`auth.provider` in `graveyard.config.json`) | Random secret for the session cookies, for example from `openssl rand -base64 32`. |
| `AUTH_<PROVIDER>_ID`, `AUTH_<PROVIDER>_SECRET` | sign-in | Client id and secret of the OAuth app, `<PROVIDER>` in upper case with `_` for `-`: `AUTH_GITHUB_ID`, `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_GOOGLE_ID`, `AUTH_GITLAB_ID`. |
| `AUTH_<PROVIDER>_ISSUER` | sign-in, OIDC providers | Issuer URL, for example the tenant URL for Microsoft Entra ID. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | `storage: "upstash"` | Upstash Redis from the Vercel Marketplace (set automatically when the store is connected; `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` work as well). Multiplayer, shared flowers and candles, refresh on open. |
| `GITHUB_TOKEN` | refresh on open (with storage) | Read-only token that can see the repos of the owner in `graveyard.config.json`. |
| `ANTHROPIC_API_KEY` | inscriptions by Claude | Only repos with new commits get a new inscription; without the key they get a plain one from facts. |

Without storage the village is refreshed by the workflow `.github/workflows/update-world.yml`
instead; its secrets are described at the top of that file.

If a future version of the button learns optional variables, the URL would get
`&env=AUTH_SECRET,GITHUB_TOKEN,ANTHROPIC_API_KEY&envDescription=…&envLink=https%3A%2F%2Fgithub.com%2Fneuromanufaktur%2Fgraveyard%2Fblob%2Fmain%2Fdocs%2Fdeploy-button.md`;
today that would make all three required.
