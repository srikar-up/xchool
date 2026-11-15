/**
 * Cloudflare D1 persistence.
 *
 * Layout (same shape the app has always used):
 *
 *   documents('_meta',   <field>)   one row per `meta` field
 *   documents('_config', <key>)     one row per small collection (JSON array)
 *   documents(<key>,     <id>)      one row per record in a record collection
 *
 * `meta` fields are separate rows so two Worker isolates editing different
 * profile fields do not overwrite each other - the same reason the Firestore
 * driver merged meta with a field mask.
 *
 * Reads are paginated by id. A cold isolate reads the whole school once and
 * keeps it in memory, exactly like the JSON backend; D1's free tier allows
 * millions of rows a day, so the old Firestore quota problem is gone.
 */
import { getD1Binding } from './d1-binding.js';
import {
  COLLECTION_KEYS,
  assertDocumentSize,
} from './layout.js';

const PAGE_SIZE = 400;
/** D1 accepts 100 statements per batch; leave headroom. */
const BATCH_SIZE = 50;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS documents (
     collection TEXT NOT NULL,
     id TEXT NOT NULL,
     data TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (collection, id)
   )`,
  `CREATE INDEX IF NOT EXISTS documents_by_collection ON documents (collection)`,
];

let schemaReady = null;

function ensureSchema(d1) {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const sql of SCHEMA) await d1.prepare(sql).run();
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

export function isD1Enabled() {
  return String(process.env.DATA_BACKEND || '').toLowerCase() === 'd1';
}

async function all(d1, sql, ...params) {
  const statement = params.length ? d1.prepare(sql).bind(...params) : d1.prepare(sql);
  const result = await statement.all();
  return Array.isArray(result) ? result : result?.results || [];
}

async function run(d1, sql, ...params) {
  const statement = params.length ? d1.prepare(sql).bind(...params) : d1.prepare(sql);
  return statement.run();
}

function parseRows(rows, field = 'data') {
  return rows.map((row) => ({ id: row.id, value: JSON.parse(row[field]) }));
}

/**
 * Reads the whole database, or null when D1 has never been seeded.
 *
 * Record collections are read in id order in pages of `PAGE_SIZE`, which keeps
 * every response well under D1's limits even for a large attendance history.
 */
export async function loadDbFromD1() {
  const d1 = getD1Binding();
  await ensureSchema(d1);

  const metaRows = await all(d1, "SELECT id, data FROM documents WHERE collection = '_meta'");
  if (!metaRows.length) return null;

  const result = { meta: {} };
  for (const row of metaRows) result.meta[row.id] = JSON.parse(row.data);

  for (const key of COLLECTION_KEYS) result[key] = [];

  // Every collection is stored per record. A layout-v2 database still has one
  // `_config` row per small collection; those are used only when the per-record
  // rows are missing, and the next save rewrites them in layout v3.
  for (const key of COLLECTION_KEYS) {
    const records = [];
    let lastId = '';
    for (;;) {
      const rows = await all(
        d1,
        'SELECT id, data FROM documents WHERE collection = ? AND id > ? ORDER BY id LIMIT ?',
        key,
        lastId,
        PAGE_SIZE
      );
      rows.forEach((row) => records.push(JSON.parse(row.data)));
      if (rows.length < PAGE_SIZE) break;
      lastId = rows[rows.length - 1].id;
    }
    result[key] = records;
  }

  const legacyConfig = await all(
    d1,
    "SELECT id, data FROM documents WHERE collection = '_config'"
  );
  for (const row of legacyConfig) {
    if (Object.hasOwn(result, row.id) && result[row.id].length === 0) {
      result[row.id] = JSON.parse(row.data);
    }
  }

  return result;
}

function diffCollection(next, previous) {
  const upserts = [];
  const deletes = [];
  const previousById = new Map((previous || []).map((record) => [record.id, record]));
  const nextIds = new Set();

  for (const record of next || []) {
    nextIds.add(record.id);
    const before = previousById.get(record.id);
    if (!before || JSON.stringify(before) !== JSON.stringify(record)) upserts.push(record);
  }
  for (const record of previous || []) {
    if (!nextIds.has(record.id)) deletes.push(record.id);
  }
  return { upserts, deletes };
}

function mergeChangeSets(...sets) {
  const merged = { collections: new Set(), records: new Map(), full: false };
  for (const set of sets) {
    if (!set) continue;
    if (set.full) merged.full = true;
    (set.collections || []).forEach((key) => merged.collections.add(key));
    (set.records || new Map()).forEach((ids, key) => {
      let target = merged.records.get(key);
      if (!target) {
        target = new Map();
        merged.records.set(key, target);
      }
      ids.forEach((kind, id) => target.set(id, kind));
    });
  }
  return merged;
}

/**
 * Writes only what changed.
 *
 * Same contract as the old Firestore writer: pass `previous` (the last synced
 * snapshot) and the tracked `changes`, or omit `changes` to diff everything.
 */
export async function saveDbToD1(db, previous, changes = null) {
  const d1 = getD1Binding();
  await ensureSchema(d1);

  const writeEverything = !previous;
  const changeSet = mergeChangeSets(
    changes,
    writeEverything ? { full: true, collections: COLLECTION_KEYS, records: new Map() } : null
  );

  const statements = [];
  const touched = new Set();
  const now = Date.now();
  let writeCount = 0;
  let deleteCount = 0;

  const upsert = (collection, id, data) => {
    assertDocumentSize(`${collection}/${id}`, data);
    statements.push(
      d1
        .prepare(
          `INSERT INTO documents (collection, id, data, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(collection, id) DO UPDATE SET
             data = excluded.data,
             updated_at = excluded.updated_at`
        )
        .bind(collection, id, JSON.stringify(data), now)
    );
    writeCount += 1;
  };

  const remove = (collection, id) => {
    statements.push(
      d1.prepare('DELETE FROM documents WHERE collection = ? AND id = ?').bind(collection, id)
    );
    deleteCount += 1;
  };

  // Every collection: one row per record. Per-record rows keep each INSERT
  // under D1's statement limit even when a collection is large.
  for (const key of COLLECTION_KEYS) {
    const next = db[key] || [];
    const prev = previous?.[key];
    const hinted = changeSet.full || changeSet.collections.has(key);
    const specific = changeSet.records.get(key);

    let upserts = [];
    let deletes = [];
    if (writeEverything || hinted) {
      const diff = diffCollection(next, prev);
      upserts = diff.upserts;
      deletes = diff.deletes;
    } else if (specific) {
      const nextById = new Map(next.map((record) => [record.id, record]));
      for (const [id, kind] of specific) {
        if (kind === 'delete' || !nextById.has(id)) deletes.push(id);
        else upserts.push(nextById.get(id));
      }
    } else {
      continue;
    }

    if (!upserts.length && !deletes.length) continue;
    touched.add(key);
    for (const record of upserts) {
      if (!record?.id) {
        console.warn(`[d1] skipping a ${key} record without an id`);
        continue;
      }
      upsert(key, record.id, record);
    }
    for (const id of deletes) {
      if (!id) continue;
      remove(key, id);
    }
  }

  if (writeEverything) {
    // Layout v2 stored small collections as one row each; v3 does not.
    statements.push(d1.prepare("DELETE FROM documents WHERE collection = '_config'"));
  }

  // Meta: one row per field, so unrelated edits from another isolate survive.
  const metaChanged =
    writeEverything || !previous || JSON.stringify(db.meta) !== JSON.stringify(previous.meta);
  if (metaChanged) {
    const prevMeta = previous?.meta || {};
    for (const [key, value] of Object.entries(db.meta || {})) {
      if (writeEverything || JSON.stringify(value) !== JSON.stringify(prevMeta[key])) {
        upsert('_meta', key, value);
      }
    }
    if (!writeEverything && previous) {
      for (const key of Object.keys(prevMeta)) {
        if (!Object.hasOwn(db.meta || {}, key)) remove('_meta', key);
      }
    }
    touched.add('meta');
  }

  for (let offset = 0; offset < statements.length; offset += BATCH_SIZE) {
    await d1.batch(statements.slice(offset, offset + BATCH_SIZE));
  }

  return {
    writes: writeCount,
    deletes: deleteCount,
    collections: [...touched],
    migrated: false,
  };
}

/** Deletes every row the app owns. Used by the demo reset and the DB tests. */
export async function clearD1() {
  const d1 = getD1Binding();
  await ensureSchema(d1);
  await run(d1, 'DELETE FROM documents');
}

/** Row count per collection, for diagnostics. */
export async function d1Stats() {
  const d1 = getD1Binding();
  await ensureSchema(d1);
  return all(
    d1,
    'SELECT collection, COUNT(*) AS rows FROM documents GROUP BY collection ORDER BY collection'
  );
}
