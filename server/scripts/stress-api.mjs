/**
 * HTTP stress test for the live API.
 *
 *   npm run test:stress -- --requests 120 --concurrency 12
 *   npm run test:stress -- --path /api/student/bootstrap --email 170001@students.xchool.edu.in --password Xchool@123
 *
 * It signs in with Firebase (API key from server/.env) and then hammers a mix
 * of read endpoints, reporting latency percentiles, throughput and failures.
 *
 * A cold Worker isolate reads the whole school from D1, so the first requests
 * are the expensive ones; the test warms up first and reports them separately.
 * On the Workers/D1 free tiers keep runs modest: about 100k requests/day and
 * 5M rows read/day.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const valueOf = (name, fallback = '') => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};

const base = (valueOf('base') || process.env.STRESS_BASE || 'https://xchool-api.srikarsensai.workers.dev').replace(/\/$/, '');
const email = valueOf('email', 'admin@nawazschool.edu');
const password = valueOf('password', 'admin123');
// `npm run ... -- --requests 24` loses the flag on Windows; accept positional
// numbers and env vars as well.
const positional = args.filter((arg) => /^\d+$/.test(arg));
const requests = Math.max(
  Number(valueOf('requests') || process.env.REQUESTS || positional[0] || '120') || 120,
  1
);
const concurrency = Math.max(
  Number(valueOf('concurrency') || process.env.CONCURRENCY || positional[1] || '12') || 12,
  1
);
const json = args.includes('--json');

const explicitPaths = args
  .map((arg, index) => (arg === '--path' ? args[index + 1] : null))
  .filter(Boolean);
const paths = explicitPaths.length
  ? explicitPaths
  : ['/api/health', '/api/bootstrap', '/api/students?limit=100'];

let apiKey = valueOf('api-key') || process.env.FIREBASE_API_KEY || '';
if (!apiKey) {
  const envFile = path.join(ROOT, 'server', '.env');
  if (fs.existsSync(envFile)) {
    apiKey =
      fs
        .readFileSync(envFile, 'utf8')
        .split(/\r?\n/)
        .find((line) => line.startsWith('FIREBASE_API_KEY='))
        ?.slice('FIREBASE_API_KEY='.length)
        .trim() || '';
  }
}
if (!apiKey) {
  console.error('Set FIREBASE_API_KEY in server/.env or pass --api-key.');
  process.exit(1);
}

async function signIn() {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const body = await response.json();
  if (!body.idToken) throw new Error(body.error?.message || 'Firebase sign-in failed');
  return body.idToken;
}

const token = await signIn();
console.log(`Target ${base}`);
console.log(`${requests} requests · concurrency ${concurrency} · ${paths.join(', ')}\n`);

async function hit(pathname) {
  const started = performance.now();
  const headers = { Accept: 'application/json' };
  if (pathname.startsWith('/api/student/')) headers.Authorization = `Bearer ${token}`;
  else if (pathname !== '/api/health' && pathname !== '/api/public/config') {
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    const response = await fetch(`${base}${pathname}`, { headers, cache: 'no-store' });
    await response.arrayBuffer();
    return { ms: performance.now() - started, status: response.status, bytes: null, path: pathname };
  } catch (error) {
    return {
      ms: performance.now() - started,
      status: 0,
      error: error.message,
      path: pathname,
    };
  }
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index];
}

function summarise(label, results) {
  const sorted = results.map((row) => row.ms).sort((a, b) => a - b);
  const failures = results.filter((row) => row.status === 0 || row.status >= 500);
  const duration = results.reduce((sum, row) => sum + row.ms, 0);
  const summary = {
    label,
    requests: results.length,
    failures: failures.length,
    statuses: Object.fromEntries(
      [...new Set(results.map((row) => row.status))].map((status) => [
        status,
        results.filter((row) => row.status === status).length,
      ])
    ),
    p50: Math.round(percentile(sorted, 0.5)),
    p95: Math.round(percentile(sorted, 0.95)),
    p99: Math.round(percentile(sorted, 0.99)),
    max: Math.round(sorted.at(-1) || 0),
    mean: Math.round(duration / Math.max(results.length, 1)),
  };
  if (json) {
    console.log(JSON.stringify(summary));
  } else {
    console.log(
      `${label.padEnd(8)} ${String(summary.requests).padStart(5)} req · ` +
        `p50 ${String(summary.p50).padStart(4)} ms · p95 ${String(summary.p95).padStart(4)} ms · ` +
        `p99 ${String(summary.p99).padStart(4)} ms · max ${String(summary.max).padStart(5)} ms · ` +
        `mean ${String(summary.mean).padStart(4)} ms · failures ${summary.failures}`
    );
    if (summary.failures) console.log(`         statuses ${JSON.stringify(summary.statuses)}`);
  }
  return summary;
}

// Warm up the isolate so cold-start reads are reported separately.
const warmup = [];
for (let index = 0; index < Math.min(paths.length * 3, 12); index += 1) {
  warmup.push(await hit(paths[index % paths.length]));
}
summarise('warmup', warmup);

const started = performance.now();
const results = [];
let nextIndex = 0;

async function worker() {
  for (;;) {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= requests) return;
    results.push(await hit(paths[index % paths.length]));
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
const elapsed = (performance.now() - started) / 1000;
const summary = summarise('load', results);

if (!json) {
  console.log(
    `\n${summary.requests} requests in ${elapsed.toFixed(1)} s · ` +
      `${(summary.requests / elapsed).toFixed(1)} req/s · failures ${summary.failures}`
  );
  const byPath = paths.map((pathname) => {
    const rows = results.filter((row) => row.path === pathname);
    return {
      path: pathname,
      requests: rows.length,
      failures: rows.filter((row) => row.status === 0 || row.status >= 500).length,
      p95: Math.round(
        percentile(
          rows.map((row) => row.ms).sort((a, b) => a - b),
          0.95
        )
      ),
    };
  });
  for (const row of byPath) {
    console.log(
      `  ${row.path.padEnd(34)} ${String(row.requests).padStart(4)} req · p95 ${row.p95} ms · failures ${row.failures}`
    );
  }
}
