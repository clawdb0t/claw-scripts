# x-search

Search recent tweets/posts via Twitter/X API v2.

## Auth

The script uses either:

- `TWITTER_BEARER_TOKEN` env var (preferred in CI), or
- 1Password CLI:
  - default reference: `op://OpenClaw/X.com/Bearer Token`
  - override via `--token-ref`.

## Examples

Search last 24h:

```bash
./scripts/x-search.js --keyword "RewriteBar" --since 24h --max 20 --lang de
```

Multiple keywords:

```bash
./scripts/x-search.js --keywords "RewriteBar,RedditRadar" --since 24h
```

JSON output:

```bash
./scripts/x-search.js --keyword "RewriteBar" --since 1h --json > out.json
```

Notes:
- Twitter recent search endpoint only supports roughly the last 7 days.
