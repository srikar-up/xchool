/**
 * Student portal end-to-end.
 *
 *   node --env-file-if-exists=server/.env server/test/student-portal.e2e.mjs
 *
 * Creates two temporary Firebase Auth users, links them to two seeded students
 * through the admin API, proves cross-student isolation, then drives the real
 * student PWA through every screen. The users are deleted afterwards and the
 * API runs on a temporary JSON database; live Firestore is never touched.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { adminAuth } from '../src/firebase.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER_DIR = path.join(ROOT, 'server');
const STUDENT_DIR = path.join(ROOT, 'student-app');
const API_PORT = 4108;
const UI_PORT = 5176;
const API = `http://127.0.0.1:${API_PORT}`;
const UI = `http://127.0.0.1:${UI_PORT}`;
const API_KEY = process.env.FIREBASE_API_KEY;
const CHROME = path.join(
  process.env.LOCALAPPDATA || '',
  'ms-playwright',
  'chromium-1254',
  'chrome-win',
  'chrome.exe'
);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xchool-student-portal-'));
const children = [];
const createdUsers = [];
const results = [];

function start(command, args, options = {}) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  children.push(child);
  return child;
}

function stop(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

async function waitFor(url, attempts = 100) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
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
  if (!body.idToken) throw new Error(body.error?.message || `sign-in failed for ${email}`);
  return body.idToken;
}

async function call(token, method, route, body) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}

try {
  if (!API_KEY) throw new Error('FIREBASE_API_KEY is missing; run with server/.env.');

  start(process.execPath, ['src/index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      DATA_BACKEND: 'json',
      DATA_DIR: dataDir,
      RUNTIME: '',
      NODE_ENV: 'development',
    },
  });
  await waitFor(`${API}/api/health`);

  /* ---------------------------------------------------------------- */
  /* Admin links two students to temporary Firebase accounts           */
  /* ---------------------------------------------------------------- */

  const adminToken = await signIn('admin@nawazschool.edu', 'admin123');
  const state = (await call(adminToken, 'GET', '/api/state')).body;
  const [studentA, studentB] = state.students;
  if (!studentA || !studentB) throw new Error('The seed needs at least two students.');

  const stamp = Date.now();
  const created = [];
  for (const student of [studentA, studentB]) {
    const email = `portal.${student.id}.${stamp}@example.com`;
    const response = await call(adminToken, 'POST', `/api/students/${student.id}/login`, { email });
    if (response.status !== 201 || !response.body?.login?.password) {
      throw new Error(
        `Could not create a login for ${student.id}: ${response.status} ${
          response.body?.error || ''
        }`
      );
    }
    createdUsers.push(response.body.login.uid);
    created.push({ student, email, password: response.body.login.password, uid: response.body.login.uid });
  }
  const [loginA, loginB] = created;

  results.push(['admin can create a student login', created.length === 2]);
  results.push([
    'the generated password is returned once',
    Boolean(loginA.password && loginA.password.length >= 12),
  ]);

  const tokenA = await signIn(loginA.email, loginA.password);
  const tokenB = await signIn(loginB.email, loginB.password);

  /* ---------------------------------------------------------------- */
  /* Cross-student isolation                                           */
  /* ---------------------------------------------------------------- */

  const meA = await call(tokenA, 'GET', '/api/student/me');
  results.push(['a student resolves to their own record', meA.body?.student?.id === studentA.id]);

  const bootstrapA = await call(tokenA, 'GET', `/api/student/bootstrap?studentId=${studentB.id}`);
  const payloadA = bootstrapA.body;
  const jsonA = JSON.stringify(payloadA);
  results.push(['the scoped bootstrap succeeds', bootstrapA.status === 200]);
  results.push([
    'a query parameter cannot widen the student scope',
    payloadA?.student?.id === studentA.id && !jsonA.includes(studentB.id),
  ]);
  results.push([
    'another student name never appears',
    !jsonA.includes(studentB.name),
  ]);

  const bRecordIds = state.testRecords
    .filter((record) => record.studentId === studentB.id)
    .map((record) => record.id);
  results.push([
    'another student marks never appear',
    bRecordIds.every((id) => !jsonA.includes(id)),
  ]);
  results.push([
    'attendance carries no roster entries',
    Array.isArray(payloadA.attendance) && payloadA.attendance.every((entry) => !('studentId' in entry)),
  ]);
  results.push([
    'the bootstrap has no auth plumbing',
    !jsonA.includes('authUid'),
  ]);

  const staffRoutes = ['/api/state', '/api/bootstrap', '/api/students', '/api/changes', '/api/events'];
  for (const route of staffRoutes) {
    const response = await call(tokenA, 'GET', route);
    results.push([`a student token is rejected on ${route}`, response.status === 403]);
  }
  const staffOnPortal = await call(adminToken, 'GET', '/api/student/bootstrap');
  results.push(['a staff token is rejected on the student portal', staffOnPortal.status === 403]);

  const bootstrapB = await call(tokenB, 'GET', '/api/student/bootstrap');
  const jsonB = JSON.stringify(bootstrapB.body);
  results.push(['the second student gets their own snapshot', bootstrapB.body?.student?.id === studentB.id]);
  results.push(['the second student cannot see the first', !jsonB.includes(studentA.id) && !jsonB.includes(studentA.name)]);

  /* ---------------------------------------------------------------- */
  /* Disable / re-enable                                               */
  /* ---------------------------------------------------------------- */

  const disabled = await call(adminToken, 'DELETE', `/api/students/${studentA.id}/login`);
  const afterDisable = await call(tokenA, 'GET', '/api/student/bootstrap');
  results.push(['an administrator can disable a login', disabled.status === 200]);
  results.push(['a disabled student is rejected', afterDisable.status === 403]);

  const enabled = await call(adminToken, 'PATCH', `/api/students/${studentA.id}`, {
    authDisabled: false,
  });
  const afterEnable = await call(tokenA, 'GET', '/api/student/bootstrap');
  results.push(['an administrator can re-enable a login', enabled.status === 200]);
  results.push(['the student works again after re-enabling', afterEnable.status === 200]);

  const staffEmail = await call(adminToken, 'POST', `/api/students/${studentB.id}/login`, {
    email: 'admin@nawazschool.edu',
  });
  results.push([
    'a student login cannot reuse a staff email',
    staffEmail.status === 409,
  ]);

  /* ---------------------------------------------------------------- */
  /* Browser: sign in and load every screen                            */
  /* ---------------------------------------------------------------- */

  start(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port',
      String(UI_PORT),
      '--strictPort',
      '--host',
      '127.0.0.1',
    ],
    {
      cwd: STUDENT_DIR,
      env: {
        ...process.env,
        VITE_API_URL: API,
        VITE_FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,
        VITE_FIREBASE_AUTH_DOMAIN: process.env.FIREBASE_AUTH_DOMAIN,
        VITE_FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
        VITE_FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET,
        VITE_FIREBASE_MESSAGING_SENDER_ID: process.env.FIREBASE_MESSAGING_SENDER_ID,
        VITE_FIREBASE_APP_ID: process.env.FIREBASE_APP_ID,
        VITE_FIREBASE_MEASUREMENT_ID: process.env.FIREBASE_MEASUREMENT_ID,
      },
    }
  );
  await waitFor(UI);

  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });

    await page.goto(UI, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[type="email"]', { timeout: 40000 });
    await page.fill('input[type="email"]', loginA.email);
    await page.fill('input[type="password"]', loginA.password);
    await page.click('button[type="submit"]');
    const loginOutcome = await Promise.race([
      page
        .waitForFunction(() => Boolean(localStorage.getItem('xchool.student.session.v1')), null, {
          timeout: 45000,
        })
        .then(() => 'ok'),
      page
        .waitForSelector('.form-error', { timeout: 45000 })
        .then(async (element) => `error: ${await element.innerText()}`),
    ]).catch((error) => `timeout: ${error.message}`);
    if (loginOutcome !== 'ok') {
      throw new Error(`Student sign-in failed (${loginOutcome})`);
    }
    await page.getByText(studentA.name, { exact: false }).first().waitFor({ timeout: 30000 });
    results.push(['the student signs in through the real UI', true]);

    const homeHtml = await page.content();
    results.push(['the dashboard never renders another student', !homeHtml.includes(studentB.name)]);

    const routes = [
      ['/timetable', 'Timetable'],
      ['/attendance', 'Attendance'],
      ['/results', 'Results'],
      ['/syllabus', 'Syllabus'],
      ['/notices', 'Notices'],
      ['/report-card', 'Report card'],
      ['/profile', 'Profile'],
      ['/more', 'More'],
    ];
    for (const [route, heading] of routes) {
      await page.goto(`${UI}${route}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: heading, exact: true }).first().waitFor({
        timeout: 30000,
      });
      const html = await page.content();
      results.push([
        `${route} loads for the student`,
        html.includes(heading) && !html.includes(studentB.name),
      ]);
    }

    results.push(['the student UI has no page errors', pageErrors.length === 0]);
    if (pageErrors.length) console.log('PAGE ERRORS:', pageErrors.slice(0, 5));
    await page.close();
  } finally {
    await browser.close();
  }
} finally {
  for (const child of children) stop(child);
  for (const uid of createdUsers) {
    await adminAuth().deleteUser(uid).catch(() => {});
  }
  await new Promise((resolve) => setTimeout(resolve, 800));
  fs.rmSync(dataDir, { recursive: true, force: true });
}

let pass = true;
for (const [label, ok] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) pass = false;
}
console.log(`RESULT: ${JSON.stringify({ pass, checks: results.length })}`);
process.exit(pass ? 0 : 1);
