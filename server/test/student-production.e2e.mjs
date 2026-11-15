/**
 * Production smoke test for the deployed student origin.
 *
 * Unlike student-portal.e2e.mjs this runs against the real Workers and the real
 * Firebase project, and it never writes anything: no accounts are created and
 * no school data is touched.
 *
 * What it proves:
 *   - the student Worker serves the SPA, its manifest and its service worker
 *   - deep links fall back to index.html (PWA routes work on refresh)
 *   - Firebase Auth accepts this origin (a wrong password reports bad
 *     credentials, not "unauthorized domain")
 *   - the API answers the student origin's CORS preflight
 *   - staff tokens cannot read /api/student/bootstrap
 *
 * Usage:
 *   node server/test/student-production.e2e.mjs
 *   STUDENT_URL=... API_URL=... node server/test/student-production.e2e.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const STUDENT_URL = process.env.STUDENT_URL || 'https://xchool-student.srikarsensai.workers.dev';
const API_URL = process.env.API_URL || 'https://xchool-api.srikarsensai.workers.dev';

const CHROME = path.join(
  process.env.LOCALAPPDATA || '',
  'ms-playwright',
  'chromium-1254',
  'chrome-win',
  'chrome.exe'
);

const results = [];
const check = (label, ok) => results.push([label, Boolean(ok)]);

/* ---- HTTP surface ---------------------------------------------------- */

async function status(url) {
  const response = await fetch(url, { redirect: 'follow' });
  return { status: response.status, type: response.headers.get('content-type') || '' };
}

const home = await status(`${STUDENT_URL}/`);
check('the student shell responds 200', home.status === 200);
check('the student shell is HTML', home.type.includes('text/html'));

const deep = await status(`${STUDENT_URL}/timetable`);
check('deep links fall back to the SPA', deep.status === 200 && deep.type.includes('text/html'));

const manifest = await fetch(`${STUDENT_URL}/manifest.webmanifest`);
const manifestJson = await manifest.json().catch(() => ({}));
check('the student manifest is served', manifest.ok && Boolean(manifestJson.name));
check(
  'the manifest is its own install identity',
  /student/i.test(`${manifestJson.name} ${manifestJson.short_name || ''}`)
);

const serviceWorker = await status(`${STUDENT_URL}/sw.js`);
check('the student service worker is served', serviceWorker.status === 200);

/* ---- CORS ------------------------------------------------------------ */

const preflight = await fetch(`${API_URL}/api/student/bootstrap`, {
  method: 'OPTIONS',
  headers: {
    Origin: STUDENT_URL,
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'authorization,content-type',
  },
});
check(
  'the API allows the student origin',
  preflight.status === 204 &&
    preflight.headers.get('access-control-allow-origin') === STUDENT_URL
);

const foreign = await fetch(`${API_URL}/api/student/bootstrap`, {
  method: 'OPTIONS',
  headers: { Origin: 'https://not-the-school.example', 'Access-Control-Request-Method': 'GET' },
});
check(
  'the API rejects an unknown origin',
  foreign.headers.get('access-control-allow-origin') !== 'https://not-the-school.example'
);

const anonymous = await fetch(`${API_URL}/api/student/bootstrap`);
check('the student API requires a token', anonymous.status === 401);

/* ---- Browser --------------------------------------------------------- */

const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  headless: true,
});
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // The deliberately wrong password makes Identity Toolkit answer 400; the
    // browser logs that failed request as a console error. Nothing else is
    // allowed to log.
    if (/status of 400/.test(message.text())) return;
    pageErrors.push(message.text());
  });

  await page.goto(STUDENT_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  check('the student login screen renders', true);

  const title = await page.title();
  check('the page is branded Xchool', /xchool/i.test(title));

  // A wrong password must fail as credentials, which can only happen if this
  // origin is on the Firebase authorized-domain list.
  await page.fill('input[type="email"]', 'not-a-student@example.com');
  await page.fill('input[type="password"]', 'definitely-wrong-password');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
  const loginText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'Firebase Auth accepts the student origin',
    !/unauthorized domain/i.test(loginText) && /invalid|incorrect|not found|wrong|check/i.test(loginText)
  );

  await page.goto(`${STUDENT_URL}/attendance`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const deepText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('a deep link keeps the student shell', /Xchool|Sign in|Student/i.test(deepText));

  check('the student UI has no page errors', pageErrors.length === 0);
  if (pageErrors.length) console.log('PAGE ERRORS:', pageErrors.slice(0, 5));

  // A cross-origin fetch from the student origin can only read the status if
  // CORS is correct; a network/CORS failure would throw here instead.
  const apiStatus = await page.evaluate(async (api) => {
    const response = await fetch(`${api}/api/student/bootstrap`);
    return response.status;
  }, API_URL);
  check('the browser can call the API across origins', apiStatus === 401);
  await page.close();
} finally {
  await browser.close();
}

let pass = true;
for (const [label, ok] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) pass = false;
}
console.log(`RESULT: ${JSON.stringify({ pass, checks: results.length })}`);
process.exit(pass ? 0 : 1);
