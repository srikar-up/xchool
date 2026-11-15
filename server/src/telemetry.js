/**
 * Per-account request telemetry.
 *
 * The admin console uses this to spot an account that is hammering the API
 * (a tab left open on a short poll, a broken retry loop, a script) before it
 * adds load to D1. Counters are kept in the isolate's memory: they are a
 * live operational signal, not an audit trail, and they reset whenever the
 * Worker is recycled.
 *
 * Storage is deliberately bounded: a fixed number of accounts and a one-minute
 * sliding window split into ten-second buckets, so memory cannot grow with
 * traffic or with the number of historical accounts.
 */

const WINDOW_MS = 60_000;
const BUCKET_MS = 10_000;
const BUCKET_COUNT = WINDOW_MS / BUCKET_MS;
const MAX_ACCOUNTS = 500;
/** Accounts idle for longer than this are forgotten. */
const IDLE_MS = 30 * 60_000;

/** @type {Map<string, object>} */
const accounts = new Map();
let totalRequests = 0;

function bucketOf(now) {
  return Math.floor(now / BUCKET_MS);
}

function trim(account, now) {
  const oldest = bucketOf(now) - BUCKET_COUNT;
  for (const key of account.buckets.keys()) {
    if (key <= oldest) account.buckets.delete(key);
  }
}

function evictIdle(now) {
  if (accounts.size <= MAX_ACCOUNTS) return;
  const entries = [...accounts.entries()].sort(
    (a, b) => Date.parse(a[1].lastSeen) - Date.parse(b[1].lastSeen)
  );
  const overflow = accounts.size - MAX_ACCOUNTS;
  for (let i = 0; i < overflow; i += 1) {
    accounts.delete(entries[i][0]);
  }
  // A very old account is noise even when the map is small.
  for (const [key, account] of accounts) {
    if (now - Date.parse(account.lastSeen) > IDLE_MS) accounts.delete(key);
  }
}

/**
 * Records one authenticated API call.
 *
 * @param {{kind:'staff'|'student', id:string, name?:string, method?:string, path?:string, status?:number}} entry
 * @param {number} [now]
 */
export function recordRequest(entry, now = Date.now()) {
  const kind = entry.kind === 'student' ? 'student' : 'staff';
  const id = String(entry.id || '').trim();
  if (!id) return;

  const key = `${kind}:${id}`;
  let account = accounts.get(key);
  if (!account) {
    account = {
      key,
      kind,
      id,
      name: entry.name || '',
      buckets: new Map(),
      total: 0,
      firstSeen: new Date(now).toISOString(),
      lastSeen: new Date(now).toISOString(),
      lastPath: '',
      lastMethod: '',
      lastStatus: 0,
    };
    accounts.set(key, account);
  }

  if (entry.name) account.name = entry.name;
  const bucket = bucketOf(now);
  account.buckets.set(bucket, (account.buckets.get(bucket) || 0) + 1);
  account.total += 1;
  account.lastSeen = new Date(now).toISOString();
  if (entry.path) account.lastPath = entry.path;
  if (entry.method) account.lastMethod = entry.method;
  if (entry.status) account.lastStatus = entry.status;
  totalRequests += 1;

  trim(account, now);
  evictIdle(now);
}

/**
 * Snapshot for the developer console, busiest account first.
 *
 * @param {{limit?:number, now?:number}} [options]
 */
export function telemetrySnapshot({ limit = 50, now = Date.now() } = {}) {
  const rows = [];
  let windowTotal = 0;

  for (const account of accounts.values()) {
    trim(account, now);
    const recent = [...account.buckets.values()].reduce((sum, count) => sum + count, 0);
    windowTotal += recent;
    rows.push({
      kind: account.kind,
      id: account.id,
      name: account.name,
      requestsInWindow: recent,
      perMinute: recent,
      total: account.total,
      firstSeen: account.firstSeen,
      lastSeen: account.lastSeen,
      lastPath: account.lastPath,
      lastMethod: account.lastMethod,
      lastStatus: account.lastStatus,
    });
  }

  rows.sort(
    (a, b) =>
      b.requestsInWindow - a.requestsInWindow ||
      b.total - a.total ||
      Date.parse(b.lastSeen) - Date.parse(a.lastSeen)
  );

  return {
    windowSeconds: WINDOW_MS / 1000,
    accountsTracked: rows.length,
    trackedRequests: totalRequests,
    requestsInWindow: windowTotal,
    accounts: rows.slice(0, Math.max(1, Math.min(Number(limit) || 50, 500))),
  };
}

/** Test hook: forget every counter. */
export function resetTelemetry() {
  accounts.clear();
  totalRequests = 0;
}
