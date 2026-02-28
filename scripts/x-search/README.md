# x-search

Search recent tweets/posts via Twitter/X API v2.

## Auth

The script uses either:

- `TWITTER_BEARER_TOKEN` env var (preferred in CI), or
- 1Password CLI:
  - default reference: `op://OpenClaw/X.com/Bearer Token`
  - override via `--token-ref`.

## Output modes

- default: Markdown summary (human-readable)
- `--json`: full normalized JSON (per keyword, includes tweet + author + public_metrics)
- `--ai-json`: minimal JSON optimized for LLM filtering (tweet text + url + key metrics)

## Examples

Search last 24h:

```bash
./scripts/x-search/x-search.js --keyword "RewriteBar" --since 24h --max 20
```

Exclude own accounts:

```bash
./scripts/x-search/x-search.js --keyword "RewriteBar" --since 24h --exclude-from "m91michel,rewritebar"
```

Multiple keywords:

```bash
./scripts/x-search/x-search.js --keywords "RewriteBar,Kerlig" --since 24h
```

AI-friendly JSON:

```bash
./scripts/x-search/x-search.js --keyword "RewriteBar" --since 24h --ai-json > ai.json
```

Notes:
- Twitter recent search endpoint only supports roughly the last 7 days.
- `--max` must be 10..100 for the recent search endpoint.
