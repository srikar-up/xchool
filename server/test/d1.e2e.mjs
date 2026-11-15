/**
 * D1 persistence test.
 *
 * Runs the real Worker (`wrangler dev`, local D1 in a temporary directory) and
 * checks the whole storage path:
 *
 *   - a fresh database seeds itself
 *   - Firebase ID tokens still authenticate against the API
 *   - a mutation is written to D1 and survives a Worker restart
 *
 * Unlike the old Firestore suite this spends no quota and needs no emulator;
 * `wrangler dev` keeps the D1 database in the local state directory.
 *
 *   npm run test:db
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER_DIR = path.join(ROOT, 'server');
const WRANGLER = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const PORT = process.env.TEST_PORT || '4110';
const API = `http://127.0.0.1:${PORT}`;
const PERSIST = fs.mkdtempSync(path.join(os.tmpdir(), 'xchool-d1-'));
const IS_WINDOWS = process.platform === 'win32';

const API_KEY = fs.existsSync(path.join(SERVER_DIR, '.env'))
  ? fs
      .readFileSync(path.join(SERVER_DIR, '.env'), 'utf8')
      .split(/\r?\n/)
      .find((line) => line.startsWith('FIREBASE_API_KEY='))
      ?.slice('FIREBASE_API_KEY='.length)
  : '';

let worker = null;
let output = '';

function startWorker() {
  output = '';
  worker = spawn(
    process.execPath,
    [
      WRANGLER,
      'dev',
      '--port',
      PORT,
      '--ip',
      '127.0.0.1',
      '--persist-to',
      PERSIST,
    ],
    {
      cwd: SERVER_DIR,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const collect = (chunk) => {
    output += chunk.toString();
    if (output.length > 60_000) output = output.slice(-40_000);
  };
  worker.stdout.on('data', collect);
  worker.stderr.on('data', collect);
}

function stopWorker() {
  if (!worker) return;
  if (IS_WINDOWS) {
    spawnSync('taskkill', ['/pid', String(worker.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    worker.kill('SIGTERM');
  }
  worker = null;
}

async function waitForApi(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${API}/api/health`);
      if (response.ok) return response.json();
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(`Worker did not start.\n${output.slice(-4000)}`);
}

async function waitForPortFree(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(1000) });
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function signIn(email, password) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
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

async function call(pathname, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}

let passed = 0;
function check(label, condition, detail = '') {
  if (!condition) {
    console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
    console.error(output.slice(-3000));
    process.exitCode = 1;
    throw new Error(label);
  }
  passed += 1;
  console.log(`ok ${passed} - ${label}`);
}

try {
  console.log('Starting the Worker against a temporary D1 database...');
  startWorker();
  const health = await waitForApi();

  check('mode is d1', health.mode === 'd1', health.mode);
  check('fresh database seeded', health.layoutVersion === 3);
  const seededRevision = health.revision;

  if (API_KEY) {
    const token = await signIn('admin@nawazschool.edu', 'admin123');

    const state = await call('/api/state', { token });
    check('Firebase token authenticates', state.status === 200, String(state.status));
    check('seeded 56 students', state.body.students?.length === 56, String(state.body.students?.length));
    check('seeded 12 staff', state.body.staff?.length === 12, String(state.body.staff?.length));

    const updated = await call('/api/meta', {
      method: 'PATCH',
      token,
      body: { tagline: 'D1 persistence probe' },
    });
    check('mutation accepted', updated.status === 200, String(updated.status));
    check('revision advanced', updated.body.meta?.revision === seededRevision + 1);

    stopWorker();
    await waitForPortFree();

    startWorker();
    const restarted = await waitForApi();
    check('restart loads instead of reseeding', restarted.revision === seededRevision + 1);
    check('restart keeps the meta edit', restarted.school === 'Xchool');

    const token2 = await signIn('admin@nawazschool.edu', 'admin123');
    const after = await call('/api/state', { token: token2 });
    check('edit survived the restart', after.body.meta?.tagline === 'D1 persistence probe');
  } else {
    console.log('skipping authenticated checks: FIREBASE_API_KEY is not set');
  }
} finally {
  stopWorker();
  // workerd may still be releasing the SQLite file; cleanup is best-effort.
  try {
    fs.rmSync(PERSIST, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch {
    console.warn(`Could not remove ${PERSIST}; the temporary directory can be deleted later.`);
  }
}

console.log(`\n${passed} checks passed`);
