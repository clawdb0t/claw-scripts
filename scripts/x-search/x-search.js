#!/usr/bin/env node
/*
  X/Twitter recent search helper.

  - Fetches bearer token via 1Password op CLI by default.
  - Queries Twitter API v2 recent search endpoint.

  Notes:
  - recent search covers the last ~7 days max (Twitter API v2 limitation).
*/

const { execFileSync } = require('node:child_process');

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function parseDurationToMs(s) {
  // supports: 30m, 1h, 24h, 2d, 7d
  const m = String(s || '').trim().match(/^([0-9]+)\s*([mhd])$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unit === 'm') return n * 60 * 1000;
  if (unit === 'h') return n * 60 * 60 * 1000;
  if (unit === 'd') return n * 24 * 60 * 60 * 1000;
  return null;
}

function parseArgs(argv) {
  // Twitter/X API v2 recent search only supports a limited time window (commonly up to ~7 days).
  // Enforce this client-side to avoid unnecessary API calls.
  const MAX_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

  const args = {
    keyword: [],
    keywords: null,
    since: '24h',
    max: 20,
    lang: null,
    includeRetweets: false,
    excludeFrom: [],
    json: false,
    tokenRef: 'op://OpenClaw/X.com/Bearer Token',
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) die(`Missing value for ${a}`);
      return argv[++i];
    };

    if (a === '--keyword' || a === '-k') args.keyword.push(next());
    else if (a === '--keywords') args.keywords = next();
    else if (a === '--since') args.since = next();
    else if (a === '--max') args.max = Number(next());
    else if (a === '--lang') args.lang = next();
    else if (a === '--include-retweets') args.includeRetweets = true;
    else if (a === '--exclude-from') args.excludeFrom = String(next()).split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--json') args.json = true;
    else if (a === '--token-ref') args.tokenRef = next();
    else if (a === '--help' || a === '-h') {
      console.log(`Usage:
  scripts/x-search.js [options]

Options:
  -k, --keyword <q>         Keyword/query (repeatable)
      --keywords <a,b,c>    Comma-separated keywords
      --since <dur>         Timeframe: 30m | 1h | 24h | 2d (default: 24h)
      --max <n>             Max results per keyword (1..100, default: 20)
      --lang <code>         Filter by tweet language (e.g. de, en)
      --include-retweets      Include retweets (default: exclude)
      --exclude-from <a,b,c>  Exclude tweets authored by these usernames (uses -from:username)
      --json                  Output JSON instead of markdown
      --token-ref <op://..>   1Password reference (default: op://OpenClaw/X.com/Bearer Token)

Auth:
  - If TWITTER_BEARER_TOKEN is set, it will be used.
  - Otherwise, the script runs: op read "<token-ref>".

Filtering:
  - --exclude-from adds -from:<username> terms to the query.
`);
      process.exit(0);
    } else {
      die(`Unknown arg: ${a}`);
    }
  }

  const list = [];
  if (args.keywords) {
    for (const part of args.keywords.split(',')) {
      const t = part.trim();
      if (t) list.push(t);
    }
  }
  for (const k of args.keyword) {
    const t = String(k).trim();
    if (t) list.push(t);
  }

  if (list.length === 0) {
    die('No keywords provided. Use --keyword or --keywords.');
  }

  const ms = parseDurationToMs(args.since);
  if (!ms) die(`Invalid --since duration: ${args.since} (expected e.g. 24h, 1h, 30m, 2d)`);

  if (ms > MAX_RECENT_WINDOW_MS) {
    die(
      `Invalid --since: ${args.since}. Twitter/X recent search only supports up to 7d. ` +
        `Use --since 7d (or less) or switch to a different endpoint/plan for longer timeframes.`
    );
  }

  if (!Number.isFinite(args.max) || args.max < 1 || args.max > 100) {
    die(`Invalid --max: ${args.max} (must be 1..100)`);
  }

  return { ...args, list, sinceMs: ms };
}

function getBearerToken(tokenRef) {
  const env = process.env.TWITTER_BEARER_TOKEN;
  if (env && env.trim()) return env.trim();

  try {
    const out = execFileSync('op', ['read', tokenRef], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    const t = out.trim();
    if (!t) die('Bearer token read from op was empty');
    return t;
  } catch (e) {
    die(`Failed to read bearer token via 1Password op CLI (${tokenRef}).\n${String(e.stderr || e.message || e)}`);
  }
}

function buildQuery(keyword, { includeRetweets, lang, excludeFrom }) {
  let q = keyword;
  if (!includeRetweets) q = `(${q}) -is:retweet`;
  if (lang) q = `(${q}) lang:${lang}`;
  if (excludeFrom?.length) {
    const terms = excludeFrom.map((u) => `-from:${u}`).join(' ');
    q = `(${q}) ${terms}`;
  }
  return q;
}

async function twitterRecentSearch({ bearer, query, max, startTimeIso }) {
  const base = 'https://api.twitter.com/2/tweets/search/recent';
  const params = new URLSearchParams({
    query,
    max_results: String(max),
    'tweet.fields': 'created_at,public_metrics,lang,author_id',
    expansions: 'author_id',
    'user.fields': 'username,name',
    start_time: startTimeIso,
  });

  const res = await fetch(`${base}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      'User-Agent': 'claw-scripts/x-search',
    },
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Twitter API returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = json?.detail || json?.title || JSON.stringify(json);
    throw new Error(`Twitter API error (status ${res.status}): ${msg}`);
  }

  const usersById = new Map();
  for (const u of json?.includes?.users || []) usersById.set(u.id, u);

  const tweets = (json?.data || []).map((t) => {
    const u = usersById.get(t.author_id);
    const username = u?.username || null;
    const url = username ? `https://x.com/${username}/status/${t.id}` : `https://x.com/i/web/status/${t.id}`;
    return {
      id: t.id,
      created_at: t.created_at,
      lang: t.lang,
      text: t.text,
      author: username ? { id: t.author_id, username, name: u?.name || null } : { id: t.author_id },
      public_metrics: t.public_metrics,
      url,
    };
  });

  return { meta: json.meta || {}, tweets };
}

function toMarkdown(keyword, result, opts) {
  const lines = [];
  lines.push(`\n${keyword}`);
  if (!result.tweets.length) {
    lines.push(`- No recent results found in the last ${opts.since} (${opts.lang ? `lang: ${opts.lang}, ` : ''}${opts.includeRetweets ? 'including retweets' : 'excluding retweets'}).`);
    return lines.join('\n');
  }

  for (const t of result.tweets.slice(0, Math.min(result.tweets.length, 10))) {
    const u = t.author?.username ? `@${t.author.username}` : '(unknown)';
    const dt = t.created_at ? t.created_at.replace('T', ' ').replace('Z', 'Z') : '';
    const snippet = String(t.text || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    lines.push(`- ${u} — ${snippet}${snippet.length === 180 ? '…' : ''} (<${t.url}>)${dt ? ` — ${dt}` : ''}`);
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const bearer = getBearerToken(args.tokenRef);

  const now = Date.now();
  const start = new Date(now - args.sinceMs);
  const startTimeIso = start.toISOString();

  const out = {
    generated_at: new Date().toISOString(),
    since: args.since,
    start_time: startTimeIso,
    max: args.max,
    lang: args.lang,
    include_retweets: args.includeRetweets,
    exclude_from: args.excludeFrom,
    results: {},
  };

  for (const keyword of args.list) {
    const q = buildQuery(keyword, { includeRetweets: args.includeRetweets, lang: args.lang, excludeFrom: args.excludeFrom });
    const result = await twitterRecentSearch({ bearer, query: q, max: args.max, startTimeIso });
    out.results[keyword] = { query: q, ...result };
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(out, null, 2));
    process.stdout.write('\n');
    return;
  }

  const md = [];
  md.push(`Twitter/X keyword research`);
  md.push(`- since: ${args.since} (start_time: ${startTimeIso})`);
  md.push(`- max per keyword: ${args.max}`);
  md.push(`- lang: ${args.lang || 'any'}`);
  md.push(`- retweets: ${args.includeRetweets ? 'included' : 'excluded'}`);
  md.push(`- exclude from: ${args.excludeFrom.length ? args.excludeFrom.join(', ') : 'none'}`);

  for (const keyword of args.list) {
    md.push(toMarkdown(keyword, out.results[keyword], args));
  }

  process.stdout.write(md.join('\n'));
  process.stdout.write('\n');
}

main().catch((e) => {
  die(String(e?.stack || e?.message || e));
});
