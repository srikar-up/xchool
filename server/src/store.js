import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeed, SCHEMA_VERSION } from './seed.js';
import { buildCurriculaFromSubjects } from './curriculum.js';
import { migrateIdentity } from './identity.js';
import { isoDaysAgo, pruneAttendanceRecords } from './maintenance.js';
import {
  COLLECTION_KEYS,
  LAYOUT_VERSION,
  RECORD_COLLECTIONS,
} from './layout.js';
import { clearD1, isD1Enabled, loadDbFromD1, readRemoteRevision, saveDbToD1 } from './d1-store.js';

/* ------------------------------------------------------------------ */
/* Storage backends                                                    */
/* ------------------------------------------------------------------ */

/** Name shown in logs and `/api/health`. */
function remoteLabel() {
  return 'd1';
}

// import.meta.url is undefined in the Workers bundle; the directory is only
// used by the Node server (JSON cache and static app paths).
const __dirname = (() => {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return '/';
  }
})();
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../data');
const DATABASE_FILE = path.join(DATA_DIR, 'db.json');

/** How many recent mutation events are kept for `/api/changes`. */
const JOURNAL_LIMIT = Math.max(Number(process.env.CHANGE_JOURNAL_LIMIT) || 300, 20);
/** A whole collection larger than this is not pushed over SSE; clients refetch. */
const EVENT_RECORD_LIMIT = 250;
const EVENT_BYTES_LIMIT = 96 * 1024;

export const storeEvents = new EventEmitter();
storeEvents.setMaxListeners(50);

let db = null;
let lastSynced = null;
let syncQueue = Promise.resolve();
let lastSyncAt = null;
let lastSyncError = null;
let lastSyncResult = null;
let retryChanges = null;
let journal = [];
let changeSequence = 0;
let refreshing = null;
let lastRefreshAt = 0;

/** Minimum gap between two on-demand reloads in the same isolate. */
const REFRESH_COOLDOWN_MS = 5000;

/**
 * Local JSON mirror. Disabled on Workers (`DISABLE_FILE_CACHE=true`) where the
 * filesystem is read-only - the in-memory database is the working copy and D1
 * is the source of truth.
 */
const FILE_CACHE = String(process.env.DISABLE_FILE_CACHE || '').toLowerCase() !== 'true';

function persist() {
  if (!FILE_CACHE) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tempFile = `${DATABASE_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tempFile, DATABASE_FILE);
  } catch (error) {
    console.warn('[data] could not write the local cache:', error.message);
  }
}

function loadFromDisk() {
  try {
    if (!fs.existsSync(DATABASE_FILE)) return null;
    const raw = fs.readFileSync(DATABASE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.meta?.schemaVersion !== SCHEMA_VERSION) {
      console.log('[data] Schema changed - reseeding demo database.');
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('[data] Could not read db.json; reseeding.', error.message);
    return null;
  }
}

/**
 * One-time migration for databases created before curricula existed.
 * Derives one shared syllabus per grade + subject from the class offerings and
 * records a flag so a deliberately emptied curriculum list stays empty.
 */
function ensureCurricula(database) {
  if (database.meta?.curriculaSeeded) return false;
  if (!Array.isArray(database.curricula) || !database.curricula.length) {
    database.curricula = buildCurriculaFromSubjects(database.subjects || []);
  }
  database.meta = { ...(database.meta || {}), curriculaSeeded: true };
  return true;
}

/** Optional boot-time retention; disabled unless ATTENDANCE_RETENTION_DAYS > 0. */
function applyAttendanceRetention(database) {
  const days = Number(process.env.ATTENDANCE_RETENTION_DAYS || 0);
  if (!Number.isFinite(days) || days <= 0) return [];
  return pruneAttendanceRecords(database, isoDaysAgo(days));
}

/* ------------------------------------------------------------------ */
/* Mutation tracking                                                   */
/* ------------------------------------------------------------------ */

function emptyChanges() {
  return { full: false, collections: new Set(), records: new Map() };
}

let pendingChanges = null;

function currentTracking() {
  if (!pendingChanges) pendingChanges = emptyChanges();
  return pendingChanges;
}

/**
 * Marks one record as changed. Endpoints call this inside `mutate` so a
 * single attendance register or mark writes one D1 row, not the whole
 * collection.
 */
export function trackRecord(collection, id, kind = 'set') {
  if (!id || !COLLECTION_KEYS.includes(collection)) return;
  const changes = currentTracking();
  if (changes.collections.has(collection)) return;
  let ids = changes.records.get(collection);
  if (!ids) {
    ids = new Map();
    changes.records.set(collection, ids);
  }
  ids.set(String(id), kind === 'delete' ? 'delete' : 'set');
}

/** Marks a whole collection as changed. Used by imports and bulk operations. */
export function trackCollection(collection) {
  if (!COLLECTION_KEYS.includes(collection)) return;
  currentTracking().collections.add(collection);
}

function mergeChanges(target, source) {
  if (!target) return source;
  if (!source) return target;
  target.full = target.full || source.full;
  source.collections.forEach((key) => target.collections.add(key));
  source.records.forEach((ids, key) => {
    let existing = target.records.get(key);
    if (!existing) {
      existing = new Map();
      target.records.set(key, existing);
    }
    ids.forEach((kind, id) => {
      existing.set(id, kind);
      // A record that is part of a full collection does not need a specific
      // entry; the full diff will handle it.
    });
  });
  return target;
}

function summarizeChanges(changes) {
  const records = [...changes.records.values()].reduce((sum, ids) => sum + ids.size, 0);
  return {
    full: Boolean(changes.full),
    collections: [...changes.collections],
    records,
  };
}

/**
 * Builds the patch sent over SSE and served by `/api/changes`.
 *
 * Small changes travel as records (`upserts`/`deletes`). A large change - an
 * import, a reset, or a bulk roster operation - is marked `full` so clients
 * refetch once instead of receiving a multi-megabyte event.
 */
function buildChangeEvent(database, changes) {
  const event = {
    revision: database.meta.revision,
    updatedAt: database.meta.updatedAt,
    full: Boolean(changes.full),
  };
  let recordCount = 0;

  if (changes.collections.has('meta') || event.full) {
    event.meta = { ...database.meta };
  }

  for (const key of changes.collections) {
    if (key === 'meta') continue;
    // The audit log is capped and paginated by the dashboard. Sending all 150
    // rows with every mutation would dwarf the actual change; screens reload
    // it when they open or on focus.
    if (key === 'activities') continue;
    const items = database[key] || [];
    const isLargeRecordSet = RECORD_COLLECTIONS.includes(key) && items.length > 60;
    if (isLargeRecordSet || items.length > EVENT_RECORD_LIMIT) {
      event.full = true;
      continue;
    }
    event.collections = event.collections || {};
    event.collections[key] = items;
    recordCount += items.length;
  }

  if (!event.full) {
    // Small config collections travel whole so their order stays exact and a
    // new row (announcement, ticket) lands where the server put it.
    for (const key of changes.records.keys()) {
      if (
        changes.collections.has(key) ||
        RECORD_COLLECTIONS.includes(key) ||
        key === 'activities'
      ) {
        continue;
      }
      const items = database[key] || [];
      if (items.length > EVENT_RECORD_LIMIT) {
        event.full = true;
        break;
      }
      event.collections = event.collections || {};
      event.collections[key] = items;
      recordCount += items.length;
    }
  }

  if (!event.full) {
    for (const [key, ids] of changes.records) {
      if (changes.collections.has(key)) continue;
      if (!RECORD_COLLECTIONS.includes(key)) continue;
      const byId = new Map((database[key] || []).map((record) => [record.id, record]));
      const upserts = [];
      const deletes = [];
      for (const [id, kind] of ids) {
        const record = byId.get(id);
        if (kind === 'delete' || !record) deletes.push(id);
        else upserts.push(record);
      }
      if (upserts.length) {
        event.upserts = event.upserts || {};
        event.upserts[key] = upserts;
      }
      if (deletes.length) {
        event.deletes = event.deletes || {};
        event.deletes[key] = deletes;
      }
      recordCount += upserts.length + deletes.length;
    }
  }

  if (!event.full && recordCount > EVENT_RECORD_LIMIT) event.full = true;
  if (!event.full) {
    const bytes = JSON.stringify(event).length;
    if (bytes > EVENT_BYTES_LIMIT) event.full = true;
  }
  if (event.full) {
    delete event.collections;
    delete event.upserts;
    delete event.deletes;
  }
  return event;
}

function rememberEvent(event) {
  journal.push(event);
  if (journal.length > JOURNAL_LIMIT) journal = journal.slice(-JOURNAL_LIMIT);
}

/** Recent mutations for `/api/changes`; null when the gap is too old. */
export function getChangesSince(sinceRevision) {
  const currentRevision = getRevision();
  const since = Number(sinceRevision);
  if (!Number.isFinite(since) || since < 0) return { full: true, revision: currentRevision };
  if (since >= currentRevision) return { revision: currentRevision, unchanged: true };
  if (!journal.length) return { full: true, revision: currentRevision };

  const first = journal[0]?.revision;
  if (since < first - 1) return { full: true, revision: currentRevision };

  const merged = { revision: currentRevision, meta: null, collections: {}, upserts: {}, deletes: {} };
  let found = false;

  for (const event of journal) {
    if (event.revision <= since) continue;
    found = true;
    if (event.full) return { full: true, revision: currentRevision, updatedAt: event.updatedAt };
    if (event.meta) merged.meta = event.meta;
    if (event.collections) {
      Object.entries(event.collections).forEach(([key, items]) => {
        merged.collections[key] = items;
        delete merged.upserts[key];
        delete merged.deletes[key];
      });
    }
    if (event.upserts) {
      Object.entries(event.upserts).forEach(([key, rows]) => {
        if (merged.collections[key]) return;
        const map = new Map((merged.upserts[key] || []).map((row) => [row.id, row]));
        rows.forEach((row) => map.set(row.id, row));
        merged.upserts[key] = [...map.values()];
        if (merged.deletes[key]) {
          merged.deletes[key] = merged.deletes[key].filter((id) => !map.has(id));
        }
      });
    }
    if (event.deletes) {
      Object.entries(event.deletes).forEach(([key, ids]) => {
        if (merged.collections[key]) return;
        const set = new Set(merged.deletes[key] || []);
        ids.forEach((id) => set.add(id));
        if (merged.upserts[key]) {
          merged.upserts[key] = merged.upserts[key].filter((row) => !set.has(row.id));
        }
        merged.deletes[key] = [...set];
      });
    }
  }

  if (!found) return { revision: currentRevision, unchanged: true };
  merged.updatedAt = getDb().meta.updatedAt;
  return merged;
}

export function getJournalBounds() {
  return {
    size: journal.length,
    limit: JOURNAL_LIMIT,
    oldestRevision: journal[0]?.revision ?? null,
    newestRevision: journal[journal.length - 1]?.revision ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

/**
 * Mirrors the in-memory database into D1.
 * Serialized through a promise chain so writes never overlap or arrive out of
 * order. Returns the queued promise so callers can await durability.
 */
function queueRemoteSync(changes = null) {
  if (!isD1Enabled()) return Promise.resolve();

  const snapshot = db;
  const queued = mergeChanges(
    retryChanges || (changes ? emptyChanges() : null),
    changes
  );
  retryChanges = null;
  changeSequence += 1;
  const sequence = changeSequence;
  const label = remoteLabel();

  syncQueue = syncQueue
    .then(async () => {
      // Several isolates can mutate between our last read and this write. Read
      // the remote revision once so a stale isolate still publishes a number
      // newer than the copy clients already have.
      try {
        const remoteRevision = await readRemoteRevision();
        if (remoteRevision !== null && remoteRevision >= db.meta.revision) {
          db.meta.revision = remoteRevision + 1;
          db.meta.updatedAt = new Date().toISOString();
        }
      } catch {
        /* The local revision advanced by one in mutate(); keep it. */
      }
      const result = await saveDbToD1(snapshot, lastSynced, queued);
      lastSynced = structuredClone(snapshot);
      lastSyncAt = new Date().toISOString();
      lastSyncError = null;
      lastSyncResult = result;
      if (result.writes || result.deletes) {
        console.log(
          `[${label}] saved ${result.writes} row(s)${
            result.deletes ? `, deleted ${result.deletes}` : ''
          }`
        );
      }
    })
    .catch((error) => {
      lastSyncError = error.message;
      // Keep the tracked changes so the next mutation retries them. The
      // in-memory state is still the source of truth for this isolate.
      retryChanges = mergeChanges(retryChanges || emptyChanges(), queued);
      console.error(`[${label}] sync failed:`, error.message);
    });

  return syncQueue;
}

/** Synchronous boot for the local JSON backend. */
export function initStore({ force = false } = {}) {
  if (force) db = null;
  else db = loadFromDisk();

  if (!db) {
    db = buildSeed();
    persist();
    console.log(`[data] Seeded ${db.students.length} students, ${db.staff.length} staff.`);
  } else {
    if (ensureCurricula(db)) {
      persist();
      console.log(`[data] Added ${db.curricula.length} grade curricula.`);
    }
    const identity = migrateIdentity(db);
    if (identity.changed) {
      persist();
      console.log(
        `[data] Renumbered ${identity.students} student(s) and ${identity.staff} staff member(s).`
      );
    }
  }
  const pruned = applyAttendanceRetention(db);
  if (pruned.length) {
    db.meta.revision += 1;
    db.meta.updatedAt = new Date().toISOString();
    persist();
    console.log(`[data] Retention removed ${pruned.length} old attendance register(s).`);
  }
  return db;
}

/**
 * Boot loader. Uses D1 when configured, otherwise the local JSON file. A
 * remote backend is never silently replaced by JSON: serving seed data from a
 * Worker would overwrite the real database on the first mutation.
 *
 * The initial seed upload is awaited: a process that exits right after seeding
 * must not lose the write.
 */
export async function initStoreAsync({ force = false } = {}) {
  if (!isD1Enabled()) return initStore({ force });

  const label = remoteLabel();
  try {
    const remote = force ? null : await loadDbFromD1();

    if (remote && remote.meta?.schemaVersion === SCHEMA_VERSION) {
      db = remote;
      lastSynced = structuredClone(db);
      const curriculaChanged = ensureCurricula(db);
      const identity = migrateIdentity(db);
      const needsLayoutMigration = Number(db.meta?.layoutVersion || 1) < LAYOUT_VERSION;

      if (needsLayoutMigration) {
        db.meta = { ...db.meta, layoutVersion: LAYOUT_VERSION };
        console.log(`[data] Migrating ${label} to per-record layout v${LAYOUT_VERSION}...`);
        await saveDbToD1(db, null);
        lastSynced = structuredClone(db);
        lastSyncAt = new Date().toISOString();
        lastSyncResult = { migrated: true };
      } else if (identity.changed) {
        // A full diff is required: every student/staff document gets a new
        // key, so the old documents have to be deleted as well as written.
        const changes = emptyChanges();
        changes.full = true;
        await saveDbToD1(db, lastSynced, changes);
        lastSynced = structuredClone(db);
        lastSyncAt = new Date().toISOString();
        lastSyncResult = { migrated: true, identity: true };
        console.log(
          `[data] Renumbered ${identity.students} student(s) and ${identity.staff} staff member(s) in ${label}.`
        );
      } else if (curriculaChanged) {
        const changes = emptyChanges();
        changes.collections.add('curricula');
        changes.collections.add('meta');
        await queueRemoteSync(changes);
      }

      const pruned = applyAttendanceRetention(db);
      if (pruned.length) {
        db.meta.revision += 1;
        db.meta.updatedAt = new Date().toISOString();
        const changes = emptyChanges();
        changes.collections.add('meta');
        const deleted = new Map();
        pruned.forEach((session) => deleted.set(session.id, 'delete'));
        changes.records.set('attendanceSessions', deleted);
        await saveDbToD1(db, lastSynced, changes);
        lastSynced = structuredClone(db);
        lastSyncAt = new Date().toISOString();
        console.log(
          `[data] Retention removed ${pruned.length} old attendance register(s).`
        );
      }

      console.log(
        `[data] Loaded from ${label} - revision ${db.meta.revision}, ${db.students.length} students.`
      );
      return db;
    }

    db = buildSeed();
    db.meta.layoutVersion = LAYOUT_VERSION;
    persist();
    console.log(
      `[data] Seeded ${label} - ${db.students.length} students, ${db.staff.length} staff.`
    );
    await saveDbToD1(db, null);
    lastSynced = structuredClone(db);
    lastSyncAt = new Date().toISOString();
    return db;
  } catch (error) {
    // Never serve seed data from the remote database: a mutation would then
    // overwrite the real school. Fail the request instead and let it retry.
    // D1 gets the same treatment: silently switching to JSON would make local
    // tests look like they persisted when they did not.
    if (String(process.env.RUNTIME || '') === 'workers' || isD1Enabled()) {
      throw new Error(`The ${label} database is unavailable: ${error.message}`);
    }
    console.warn(`[${label}] boot failed (${error.message}); falling back to local JSON.`);
    return initStore({ force });
  }
}

/**
 * Re-reads D1 into this isolate.
 *
 * A Worker isolate keeps one in-memory database for its whole lifetime, so an
 * isolate that booted before another isolate wrote a record keeps serving the
 * old copy. That is harmless for slowly changing data but not for a portal
 * login: an administrator provisions a student on one isolate and the student's
 * first request may land on another, which would refuse access even though the
 * link exists in D1.
 *
 * Call this when a lookup misses and the record may have been written remotely.
 * It is rare (once per isolate per changed login) and concurrent callers share
 * one reload. No-op on the JSON backend, where there is a single process.
 */
export function refreshStoreAsync({ force = false } = {}) {
  if (!isD1Enabled()) return Promise.resolve(false);
  if (refreshing) return refreshing;
  // A token with no linked record would otherwise trigger one full read per
  // request: bound the cost per isolate. Freshness checks pass `force` because
  // they have already confirmed that the remote revision moved.
  if (!force && Date.now() - lastRefreshAt < REFRESH_COOLDOWN_MS) return Promise.resolve(false);
  lastRefreshAt = Date.now();

  refreshing = (async () => {
    // Never reload over a mutation that has not reached the remote store yet.
    await syncQueue.catch(() => {});
    const remote = await loadDbFromD1();
    if (!remote || remote.meta?.schemaVersion !== SCHEMA_VERSION) return false;
    db = remote;
    lastSynced = structuredClone(remote);
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * Makes this isolate catch up with writes from other Worker isolates.
 *
 * Reads one meta row (not the whole school). The default cooldown keeps a busy
 * tab from turning every request into a D1 read; a real remote change triggers
 * one full reload shared by all concurrent callers.
 */
let freshnessCheckedAt = 0;
const FRESHNESS_CHECK_MS = 3000;

export async function ensureFreshStore() {
  if (!isD1Enabled()) return false;
  if (Date.now() - freshnessCheckedAt < FRESHNESS_CHECK_MS) return false;
  freshnessCheckedAt = Date.now();

  let remoteRevision = null;
  try {
    await syncQueue.catch(() => {});
    remoteRevision = await readRemoteRevision();
  } catch {
    return false;
  }
  if (remoteRevision === null) return false;
  if (remoteRevision <= getDb().meta.revision) return false;

  // Hold the window shut while the shared reload runs.
  freshnessCheckedAt = Date.now() + 1000;
  return refreshStoreAsync({ force: true });
}

export function getDb() {
  if (!db) initStore();
  return db;
}

export function getRevision() {
  return getDb().meta.revision;
}

export function mutate(mutator, { full = false } = {}) {
  const current = getDb();
  const before = new Map(
    COLLECTION_KEYS.map((key) => [
      key,
      { ref: current[key], length: Array.isArray(current[key]) ? current[key].length : 0 },
    ])
  );

  pendingChanges = emptyChanges();
  try {
    mutator(current);
  } catch (error) {
    pendingChanges = null;
    throw error;
  }

  current.meta.revision += 1;
  current.meta.updatedAt = new Date().toISOString();
  current.meta.layoutVersion = LAYOUT_VERSION;

  // Safety net: an endpoint that added/removed records but forgot to call
  // trackRecord would otherwise silently stay in memory. Detect array changes
  // and fall back to a full collection diff, with a warning so the gap can be
  // fixed. Config collections are small, so this is cheap for them.
  COLLECTION_KEYS.forEach((key) => {
    if (key === 'meta') return;
    const previous = before.get(key);
    if (!previous) return;
    const next = current[key];
    const changedRef = next !== previous.ref;
    const changedLength = Array.isArray(next) && next.length !== previous.length;
    if (!changedRef && !changedLength) return;
    if (pendingChanges.collections.has(key) || pendingChanges.records.has(key)) return;
    pendingChanges.collections.add(key);
    console.warn(
      `[store] ${key} changed without record tracking; writing a full collection diff.`
    );
  });

  pendingChanges.collections.add('meta');
  const changes = pendingChanges;
  changes.full = changes.full || full;
  pendingChanges = null;

  const event = buildChangeEvent(current, changes);
  rememberEvent(event);
  persist();
  queueRemoteSync(changes);
  storeEvents.emit('change', event);
  return current;
}

export function resetStore() {
  db = buildSeed();
  db.meta.revision += 1;
  db.meta.updatedAt = new Date().toISOString();
  db.meta.layoutVersion = LAYOUT_VERSION;
  persist();
  lastSynced = null;

  const event = {
    revision: db.meta.revision,
    updatedAt: db.meta.updatedAt,
    full: true,
    reset: true,
  };
  rememberEvent(event);

  if (isD1Enabled()) {
    const label = remoteLabel();
    syncQueue = syncQueue
      .then(async () => {
        await clearD1();
        const result = await saveDbToD1(db, null);
        lastSynced = structuredClone(db);
        lastSyncAt = new Date().toISOString();
        lastSyncError = null;
        lastSyncResult = result;
      })
      .catch((error) => {
        lastSyncError = error.message;
        retryChanges = emptyChanges();
        retryChanges.full = true;
        console.error(`[${label}] reset failed:`, error.message);
      });
  }

  storeEvents.emit('change', event);
  return db;
}

export function getDatabaseFile() {
  return isD1Enabled() ? 'd1://xchool-db' : DATABASE_FILE;
}

/** Name of the active persistence backend, for logs and /api/health. */
export function getBackendName() {
  return isD1Enabled() ? 'd1' : 'local-json';
}

/** Resolves once every queued remote write has settled. */
export function flushStore() {
  return syncQueue;
}

export function getSyncStatus() {
  return {
    backend: getBackendName(),
    lastSyncAt,
    lastSyncError,
    lastSync: lastSyncResult,
    journal: getJournalBounds(),
    retrying: retryChanges ? summarizeChanges(retryChanges) : null,
    layoutVersion: LAYOUT_VERSION,
  };
}
