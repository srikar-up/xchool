/**
 * Advanced settings: portal switches and per-account telemetry.
 *
 *   node --test server/test/advanced-settings.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSwitch,
  studentPortalEnabled,
  STUDENT_PORTAL_DISABLED_MESSAGE,
} from '../src/settings.js';
import { recordRequest, resetTelemetry, telemetrySnapshot } from '../src/telemetry.js';

test('the student portal is open unless an administrator closes it', () => {
  assert.equal(studentPortalEnabled({ meta: {} }), true);
  assert.equal(studentPortalEnabled({ meta: { studentPortalEnabled: true } }), true);
  assert.equal(studentPortalEnabled({ meta: { studentPortalEnabled: false } }), false);
  assert.equal(studentPortalEnabled({}), true);
  assert.match(STUDENT_PORTAL_DISABLED_MESSAGE, /switched off/i);
});

test('switches accept booleans and the strings a form sends', () => {
  assert.equal(parseSwitch(true), true);
  assert.equal(parseSwitch(false), false);
  assert.equal(parseSwitch('true'), true);
  assert.equal(parseSwitch('false'), false);
  assert.equal(parseSwitch(undefined), undefined);
  assert.equal(parseSwitch('yes'), undefined);
  assert.equal(parseSwitch(1), undefined);
});

test('telemetry counts calls per account', () => {
  resetTelemetry();
  const now = 1_700_000_000_000;
  for (let i = 0; i < 5; i += 1) {
    recordRequest(
      { kind: 'staff', id: '900001', name: 'Teacher', method: 'GET', path: '/api/state' },
      now + i * 1000
    );
  }
  recordRequest(
    { kind: 'student', id: '160001', name: 'Student', method: 'GET', path: '/api/student/changes' },
    now + 2000
  );

  const snapshot = telemetrySnapshot({ now: now + 3000 });
  assert.equal(snapshot.accountsTracked, 2);
  assert.equal(snapshot.trackedRequests, 6);
  assert.equal(snapshot.accounts[0].id, '900001');
  assert.equal(snapshot.accounts[0].requestsInWindow, 5);
  assert.equal(snapshot.accounts[0].lastPath, '/api/state');
  assert.equal(snapshot.accounts[1].kind, 'student');
  assert.equal(snapshot.accounts[1].requestsInWindow, 1);
});

test('a call older than the window stops counting as a rate', () => {
  resetTelemetry();
  const now = 1_700_000_000_000;
  recordRequest({ kind: 'staff', id: '900002', name: 'Old' }, now);
  recordRequest({ kind: 'staff', id: '900002', name: 'Old' }, now + 61_000);

  const snapshot = telemetrySnapshot({ now: now + 62_000 });
  const account = snapshot.accounts.find((entry) => entry.id === '900002');
  assert.equal(account.requestsInWindow, 1);
  assert.equal(account.total, 2);
});

test('the busiest account is first and the list is capped', () => {
  resetTelemetry();
  const now = 1_700_000_000_000;
  recordRequest({ kind: 'staff', id: 'quiet', name: 'Quiet' }, now);
  for (let i = 0; i < 30; i += 1) {
    recordRequest({ kind: 'student', id: 'noisy', name: 'Noisy' }, now + i);
  }

  const snapshot = telemetrySnapshot({ now: now + 5000, limit: 1 });
  assert.equal(snapshot.accounts.length, 1);
  assert.equal(snapshot.accounts[0].id, 'noisy');
  assert.equal(snapshot.requestsInWindow, 31);
});

test('anonymous or malformed entries are ignored', () => {
  resetTelemetry();
  recordRequest({ kind: 'staff', id: '' });
  recordRequest({ kind: 'staff' });
  assert.equal(telemetrySnapshot().accountsTracked, 0);
});
