/**
 * check-instances.js (straight checks, 3-term sequential)
 *
 * - No typing mimic.
 * - For suggestions and search: pick 3 random terms and fetch each in sequence.
 * - If ALL suggestion requests fail, instance is skipped. Same for search.
 * - Retry once on 5xx responses per request.
 * - Timeout = 10s. Verbose per-request logging preserved.
 * - Metrics include combined_latency_ms for sorting.
 */
const fs = require('fs').promises;
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
const semver = require('semver');

const RAW_WIKI_URL = process.env.RAW_WIKI_URL || 'https://raw.githubusercontent.com/TeamPiped/documentation/refs/heads/main/content/docs/public-instances/index.md';
const OUTPUT = process.env.OUTPUT_PATH || 'public/piped-instances.json';

const REQUEST_TIMEOUT_MS = 10000;
const REQUEST_RETRY_ON_5XX_MS = 300;
const PREFLIGHT_RETRY_DELAY_MS = 3000;

const SUGGEST_PATHS = ['/suggestions'];
const SEARCH_PATHS = ['/search'];
const VERSION_PATHS = ['/version'];

const SEARCH_TERMS = [
  'Never Gonna Give You Up',
  'rick astley',
  'erika',
  'союз советский социалистических республик',
  'ado',
  'iris out',
  'imagine dragons'
];

const FILTERS = [
  'all',
  'music_songs',
  'music_videos',
  'music_albums',
  'music_artists',
  'music_playlists'
];

// how many random terms to pick per type
const TERM_COUNT = 3;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(label, msg) {
  const time = new Date().toISOString().split('T')[1].replace('Z', '');
  console.log(`[${time}] [${label}] ${msg}`);
}

function normalizeApiUrl(u) {
  if (!u) return null;
  u = u.trim();
  const m = u.match(/https?:\/\/[^\s)"]+/);
  if (!m) return null;
  try {
    const url = new URL(m[0]);
    return (url.origin + (url.pathname && url.pathname !== '/' ? url.pathname.replace(/\/+$/, '') : '')).replace(/\/+$/, '');
  } catch (e) {
    return null;
  }
}

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: { 'User-Agent': 'github-actions/piped-inst-checker/1.1', ...opts.headers }
    });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

async function fetchText(url) {
  const r = await fetchWithTimeout(url);
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
  return await r.text();
}

async function fetchJsonMaybe(url, opts = {}) {
  try {
    log('HTTP', `GET ${url}`);
    const start = Date.now();
    const r = await fetchWithTimeout(url, { redirect: 'follow', ...opts });
    const time = Date.now() - start;
    let text = '';
    try { text = await r.text(); } catch (e) { /* ignore */ }
    log('HTTP', `Result ${r.status} in ${time}ms for ${url} (len=${(text||'').length})`);
    try {
      return { ok: r.ok, status: r.status, json: JSON.parse(text), text, time_ms: time };
    } catch (e) {
      return { ok: r.ok, status: r.status, text, time_ms: time };
    }
  } catch (e) {
    log('HTTP', `Error fetching ${url}: ${String(e)}`);
    return { ok: false, err: String(e) };
  }
}

/* simplified version probe: GET /version and return trimmed body if 2xx */
async function probeVersion(instance) {
  for (const p of VERSION_PATHS) {
    const url = `${instance.api_url.replace(/\/+$/, '')}${p}`;
    try {
      log('PROBE', `Probing version at ${url}`);
      const start = Date.now();
      const r = await fetchWithTimeout(url, { redirect: 'follow' });
      const time = Date.now() - start;
      let txt = '';
      try { txt = await r.text(); } catch (e) { txt = ''; }
      log('PROBE', `Probe ${r.status} in ${time}ms for ${url} (len=${(txt||'').length})`);
      if (r.ok) {
        const v = (txt || '').trim();
        return { url, ok: true, status: r.status, version_raw: v || null };
      }
    } catch (e) {
      log('PROBE', `Error probing ${url}: ${String(e)}`);
    }
  }
  return { ok: false };
}

/**
 * Basic single-request handler with retry-on-5xx (returns object or null)
 */
async function singleRequestWithRetry(url) {
  try {
    log('HTTP', `Attempting ${url}`);
    const start = Date.now();
    let res = await fetchWithTimeout(url, { redirect: 'follow' });
    const time = Date.now() - start;
    let text = '';
    try { text = await res.text(); } catch (e) { }
    log('HTTP', `Response ${res.status} in ${time}ms for ${url}`);
    if (res.ok) return { url, ok: true, status: res.status, time_ms: time, body_sample: (text||'').slice(0,320) };

    // retry once on 5xx
    if (res.status >= 500) {
      log('HTTP', `5xx ${res.status} from ${url}; retrying after ${REQUEST_RETRY_ON_5XX_MS}ms`);
      await sleep(REQUEST_RETRY_ON_5XX_MS);
      try {
        const start2 = Date.now();
        const res2 = await fetchWithTimeout(url, { redirect: 'follow' });
        const time2 = Date.now() - start2;
        let text2 = '';
        try { text2 = await res2.text(); } catch (e) { }
        log('HTTP', `Retry response ${res2.status} in ${time2}ms for ${url}`);
        if (res2.ok) return { url, ok: true, status: res2.status, time_ms: time2, body_sample: (text2||'').slice(0,320) };
        log('HTTP', `Retry failed (${res2.status}) for ${url}`);
        return { url, ok: false, status: res2.status, time_ms: time2, body_sample: (text2||'').slice(0,320) };
      } catch (e) {
        log('HTTP', `Retry error for ${url}: ${String(e)}`);
        return { url, ok: false, err: String(e) };
      }
    }

    // non-5xx non-ok
    return { url, ok: false, status: res.status, time_ms: time, body_sample: (text||'').slice(0,320) };
  } catch (e) {
    log('HTTP', `Network/timeout for ${url}: ${String(e)}`);
    return { url, ok: false, err: String(e) };
  }
}

/**
 * trySuggestTerms:
 * - terms: array of strings
 * - returns array of result objects for each term (success or failure info)
 * - performs requests sequentially
 */
async function trySuggestTerms(base, paths, terms) {
  const results = [];
  for (const term of terms) {
    // build URL(s) for each suggestion path and try each until success or all fail
    let success = null;
    for (const p of paths) {
      const url = `${base.replace(/\/+$/, '')}${p}${p.includes('?') ? '&' : '?'}query=${encodeURIComponent(term)}&music=true`;
      const res = await singleRequestWithRetry(url);
      results.push({ kind: 'suggest', term, path: p, ...res });
      if (res && res.ok) { success = res; break; }
      // continue to next path
    }
    // move to next term (we still record all attempts)
    // small jitter to avoid hammering, but very short
    await sleep(50);
  }
  return results;
}

/**
 * trySearchTerms:
 * - terms: array of strings
 * - returns array of result objects for each term (success or failure info)
 * - performs requests sequentially; rotates filters across terms
 */
async function trySearchTerms(base, paths, terms) {
  const results = [];
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    const filter = FILTERS[i % FILTERS.length] || 'all';
    for (const p of paths) {
      const url = `${base.replace(/\/+$/, '')}${p}${p.includes('?') ? '&' : '?'}q=${encodeURIComponent(term)}&filter=${encodeURIComponent(filter)}`;
      const res = await singleRequestWithRetry(url);
      results.push({ kind: 'search', term, filter, path: p, ...res });
      if (res && res.ok) break; // success for this term: move to next term
    }
    await sleep(50);
  }
  return results;
}

/**
 * Preflight HEAD check with single retry
 */
async function preflightCheck(instance) {
  const checkUrl = `${instance.api_url}/streams/dQw4w9WgXcQ`;
  const check = async () => {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 5000);
      log('PREFLIGHT', `HEAD ${checkUrl}`);
      const r = await fetch(checkUrl, { method: 'HEAD', signal: controller.signal });
      clearTimeout(id);
      log('PREFLIGHT', `HEAD ${r.status} for ${checkUrl}`);
      if (r.status >= 500) throw new Error(`Status ${r.status}`);
      return true;
    } catch (e) {
      log('PREFLIGHT', `PREFLIGHT error for ${instance.api_url}: ${String(e)}`);
      return false;
    }
  };

  if (await check()) return true;
  log(instance.name, `Initial preflight failed; retrying in ${PREFLIGHT_RETRY_DELAY_MS}ms`);
  await sleep(PREFLIGHT_RETRY_DELAY_MS);
  if (await check()) {
    log(instance.name, 'Recovered on second preflight attempt');
    return true;
  }
  log(instance.name, 'Preflight failed twice; marking dead');
  return false;
}

/**
 * pickRandomTerms:
 * - picks up to count distinct random terms from SEARCH_TERMS
 */
function pickRandomTerms(count) {
  const pool = Array.from(SEARCH_TERMS);
  const picks = [];
  while (picks.length < count && pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
  return picks;
}

/**
 * Main per-instance check:
 * - preflight HEAD
 * - pick 3 random terms for suggestions -> fetch sequentially
 * - pick 3 random terms for search -> fetch sequentially (rotating filters)
 * - require at least one success in suggestions AND at least one success in search, otherwise skip
 */
async function checkInstance(instance) {
  const alive = await preflightCheck(instance);
  if (!alive) {
    log('SKIP', `${instance.api_url} preflight failed; excluding.`);
    return null;
  }

  log(instance.name, 'Picking random terms for suggestion and search');
  const suggestTerms = pickRandomTerms(TERM_COUNT);
  const searchTerms = pickRandomTerms(TERM_COUNT);

  log(instance.name, `Suggest terms: ${JSON.stringify(suggestTerms)}`);
  log(instance.name, `Search terms: ${JSON.stringify(searchTerms)}`);

  // run suggestions sequentially
  const suggestResults = await trySuggestTerms(instance.api_url, SUGGEST_PATHS, suggestTerms);

  // run searches sequentially
  const searchResults = await trySearchTerms(instance.api_url, SEARCH_PATHS, searchTerms);

  // determine if there's any 2xx success in each group
  const suggestSuccesses = suggestResults.filter(r => r && r.ok && r.status >= 200 && r.status < 300);
  const searchSuccesses = searchResults.filter(r => r && r.ok && r.status >= 200 && r.status < 300);

  if (!suggestSuccesses.length) {
    log('SKIP', `${instance.api_url} — all suggestion attempts failed; excluding.`);
    return null;
  }
  if (!searchSuccesses.length) {
    log('SKIP', `${instance.api_url} — all search attempts failed; excluding.`);
    return null;
  }

  // compute metrics
  const avgSuggestionMs = (suggestSuccesses.reduce((acc, r) => acc + (r.time_ms || 0), 0) / suggestSuccesses.length) || null;
  const avgSearchMs = (searchSuccesses.reduce((acc, r) => acc + (r.time_ms || 0), 0) / searchSuccesses.length) || null;

  const totalAttempts = suggestResults.length + searchResults.length;
  const successCount = suggestSuccesses.length + searchSuccesses.length;
  const combinedRate = successCount / Math.max(1, totalAttempts);

  const result = {
    name: instance.name,
    api_url: instance.api_url,
    cdn: instance.cdn || null,
    raw: instance.raw,
    suggestions: suggestResults,
    searches: searchResults,
    metrics: {
      suggestion_success_count: suggestSuccesses.length,
      search_success_count: searchSuccesses.length,
      suggestion_success_rate: suggestSuccesses.length / suggestResults.length,
      search_success_rate: searchSuccesses.length / searchResults.length,
      combined_success_rate: combinedRate,
      avg_suggestion_ms: Number.isFinite(avgSuggestionMs) ? Math.round(avgSuggestionMs) : null,
      avg_search_ms: Number.isFinite(avgSearchMs) ? Math.round(avgSearchMs) : null,
      combined_latency_ms: ((Number.isFinite(avgSuggestionMs) ? Math.round(avgSuggestionMs) : 0) + (Number.isFinite(avgSearchMs) ? Math.round(avgSearchMs) : 0))
    },
    checked_at: new Date().toISOString()
  };

  log(instance.name, `Finished checks. combined_success_rate=${(result.metrics.combined_success_rate*100).toFixed(0)}% combined_latency=${result.metrics.combined_latency_ms}ms`);
  return result;
}

/* sorting with latency consideration */
function sortInstances(items) {
  return items.sort((a, b) => {
    const aLatest = a.isLatest ? 1 : 0;
    const bLatest = b.isLatest ? 1 : 0;
    if (bLatest - aLatest) return bLatest - aLatest;

    const aCdn = a.cdn ? 1 : 0;
    const bCdn = b.cdn ? 1 : 0;
    if (bCdn - aCdn) return bCdn - aCdn;

    const aRate = a.metrics?.combined_success_rate ?? 0;
    const bRate = b.metrics?.combined_success_rate ?? 0;
    if (bRate - aRate) return bRate - aRate;

    const aLatency = a.metrics?.combined_latency_ms ?? 1e9;
    const bLatency = b.metrics?.combined_latency_ms ?? 1e9;
    if (aLatency - bLatency) return aLatency - bLatency;

    const aSrch = a.metrics?.avg_search_ms ?? 1e9;
    const bSrch = b.metrics?.avg_search_ms ?? 1e9;
    if (aSrch - bSrch) return aSrch - bSrch;

    return (a.api_url || '').localeCompare(b.api_url || '');
  });
}

(async function main() {
  try {
    log('INIT', `Fetching wiki list from ${RAW_WIKI_URL}`);
    const md = await fetchText(RAW_WIKI_URL);

    // parse markdown to API list
    const parsed = (function parseMarkdownToApis(md) {
      const lines = md.split('\n');
      const instances = [];
      for (const line of lines) {
        if (!line.includes('|')) continue;
        if (!/https?:\/\//.test(line)) continue;
        const urlMatch = line.match(/https?:\/\/[^\s|)]+/);
        if (!urlMatch) continue;
        const api = normalizeApiUrl(urlMatch[0]);
        if (!api) continue;
        const parts = line.split('|').map(s => s.trim());
        const name = parts[1] || api.replace(/^https?:\/\//, '');
        const cdn = parts.length >= 5 ? (parts[4] || null) : null;
        instances.push({ raw: line, api_url: api, name, cdn });
      }
      const seen = new Set();
      return instances.filter(i => {
        if (seen.has(i.api_url)) return false;
        seen.add(i.api_url);
        return true;
      });
    })(md);

    if (!parsed.length) {
      log('WARN', 'No instances parsed — wrote empty JSON');
      await fs.mkdir('public', { recursive: true });
      await fs.writeFile(OUTPUT, JSON.stringify({ generated_at: new Date().toISOString(), source: RAW_WIKI_URL, instances: [] }, null, 2));
      return;
    }

    log('INFO', `Found ${parsed.length} instances. Probing versions...`);

    // probe versions
    const versionPromises = parsed.map(async inst => {
      try {
        const vres = await probeVersion(inst);
        if (vres.ok) {
          const vraw = vres.version_raw;
          inst.version = vraw ? (semver.coerce(String(vraw)) ? semver.coerce(String(vraw)).version : String(vraw)) : null;
          inst.version_probe = vres;
        } else {
          inst.version = null;
          inst.version_probe = vres;
        }
      } catch (e) {
        inst.version = null;
        inst.version_probe = { ok: false, err: String(e) };
      }
      return inst;
    });

    const withVersions = await Promise.all(versionPromises);

    // find latest semver if possible
    const candidates = withVersions.map(i => i.version).filter(Boolean);
    let latest = null;
    if (candidates.length) {
      const vlist = candidates.map(v => semver.coerce(v)).filter(Boolean).map(v => v.version);
      if (vlist.length) latest = vlist.sort(semver.rcompare)[0];
    }

    if (latest) {
      log('INFO', `Detected latest backend version: ${latest}`);
      withVersions.forEach(i => {
        if (i.version) {
          const coerced = semver.coerce(i.version);
          i.isLatest = coerced ? semver.eq(coerced.version, latest) : false;
        } else i.isLatest = false;
      });
    } else {
      log('WARN', 'No version information detected; marking none as latest');
      withVersions.forEach(i => i.isLatest = false);
    }

    // main checks (sequential)
    const finalResults = [];
    for (const inst of withVersions) {
      try {
        const checked = await checkInstance(inst);
        if (checked) {
          checked.version = inst.version;
          checked.isLatest = inst.isLatest;
          finalResults.push(checked);
        } else {
          log('SKIP', `Excluding ${inst.api_url} from JSON due to preflight/no-success results.`);
        }
      } catch (e) {
        log('ERR', `Unexpected error checking ${inst.api_url}: ${e.message || String(e)}`);
      }
    }

    // sort & write
    const sorted = sortInstances(finalResults);
    const out = { generated_at: new Date().toISOString(), source: RAW_WIKI_URL, version_priority: latest || null, instances: sorted };

    await fs.mkdir('public', { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));
    log('DONE', `Wrote ${sorted.length} active instances to ${OUTPUT}`);

  } catch (err) {
    console.error('Fatal error', err);
    process.exit(2);
  }
})();