/**
 * Copies the school database into Cloudflare D1.
 *
 *   npm run import:d1 -- --data path/to/data.json        # from a JSON bundle
 *   npm run import:d1                                    # from live Firestore
 *   npm run import:d1 -- --local                         # local `wrangler dev` D1
 *
 * The SQL is staged in a separate table and swapped in at the end, so a failed
 * import leaves the current database untouched.
 *
 * Firestore reads are only needed for the source; once the quota resets (or
 * when you pass `--data`), the import spends no Firebase reads.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_DIR = path.resolve(SERVER_DIR, '..');
const WRANGLER = path.join(ROOT_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const COLLECTION_KEYS = [
  'staff',
  'classes',
  'students',
  'subjects',
  'curricula',
  'timetable',
  'exams',
  'testRecords',
  'assignments',
  'attendanceSessions',
  'staffAttendance',
  'classIncharges',
  'announcements',
  'rmsTickets',
  'activities',
];

const RECORD_COLLECTIONS = [
  'students',
  'testRecords',
  'attendanceSessions',
  'staffAttendance',
];

const CONFIG_COLLECTIONS = COLLECTION_KEYS.filter((key) => !RECORD_COLLECTIONS.includes(key));
const ROOT = process.env.FIRESTORE_ROOT || 'school';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

const dataFile = valueOf('--data');
const local = flag('--local');
const dryRun = flag('--dry-run');
const database = valueOf('--database') || 'xchool-db';

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Source: a JSON bundle or live Firestore                            */
/* ------------------------------------------------------------------ */

async function readFirestore() {
  const { initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const fsSync = await import('node:fs');

  const keyFile =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(SERVER_DIR, 'serviceAccountKey.json');
  const credential = fsSync.existsSync(keyFile)
    ? cert(JSON.parse(fsSync.readFileSync(keyFile, 'utf8')))
    : applicationDefault();

  initializeApp({ credential });
  const firestore = getFirestore();
  const root = firestore.collection(ROOT);

  const metaSnap = await root.doc('meta').get();
  if (!metaSnap.exists) fail('Firestore has no school/meta document.');
  const meta = metaSnap.data() || {};

  const db = { meta: { ...meta, layoutVersion: 2 } };

  const legacy = Number(meta.layoutVersion || 1) < 2;
  if (legacy) {
    const snaps = await Promise.all(COLLECTION_KEYS.map((key) => root.doc(key).get()));
    COLLECTION_KEYS.forEach((key, index) => {
      db[key] = snaps[index].exists ? snaps[index].data().items || [] : [];
    });
    console.log('Source uses the legacy layout; it will be written as layout v2.');
    return db;
  }

  const configSnaps = await Promise.all(CONFIG_COLLECTIONS.map((key) => root.doc(key).get()));
  CONFIG_COLLECTIONS.forEach((key, index) => {
    db[key] = configSnaps[index].exists ? configSnaps[index].data().items || [] : [];
  });

  for (const key of RECORD_COLLECTIONS) {
    const records = [];
    let lastId = '';
    for (;;) {
      let query = root.doc('records').collection(key).orderBy('__name__').limit(300);
      if (lastId) query = query.startAfter(lastId);
      const snap = await query.get();
      snap.docs.forEach((doc) => {
        const data = doc.data();
        records.push({ ...data, id: data.id || doc.id });
      });
      if (snap.size < 300) break;
      lastId = snap.docs[snap.docs.length - 1].id;
    }
    db[key] = records;
  }
  return db;
}

/* ------------------------------------------------------------------ */
/* SQL                                                                 */
/* ------------------------------------------------------------------ */

function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildSql(db) {
  /** @type {string[]} */
  const lines = [];
  const now = Date.now();

  lines.push('DROP TABLE IF EXISTS documents_import;');
  lines.push(`CREATE TABLE documents_import (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (collection, id)
  );`);

  const insert = (collection, id, data) => {
    lines.push(
      `INSERT INTO documents_import (collection, id, data, updated_at) VALUES (${sqlText(
        collection
      )}, ${sqlText(id)}, ${sqlText(JSON.stringify(data))}, ${now});`
    );
  };

  for (const [key, value] of Object.entries(db.meta || {})) insert('_meta', key, value);
  for (const key of CONFIG_COLLECTIONS) insert('_config', key, db[key] || []);
  for (const key of RECORD_COLLECTIONS) {
    for (const record of db[key] || []) {
      if (!record?.id) continue;
      insert(key, record.id, record);
    }
  }

  lines.push('DROP TABLE IF EXISTS documents;');
  lines.push('ALTER TABLE documents_import RENAME TO documents;');
  lines.push(
    'CREATE INDEX IF NOT EXISTS documents_by_collection ON documents (collection);'
  );

  return `${lines.join('\n')}\n`;
}

function runWrangler(sqlFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        WRANGLER,
        'd1',
        'execute',
        database,
        local ? '--local' : '--remote',
        '--yes',
        '--config',
        path.join(SERVER_DIR, 'wrangler.jsonc'),
        '--file',
        sqlFile,
      ],
      { stdio: 'inherit' }
    );
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`wrangler exited with code ${code}`))
    );
  });
}

try {
  const db = dataFile
    ? JSON.parse(fs.readFileSync(path.resolve(dataFile), 'utf8'))
    : await readFirestore();

  const students = Array.isArray(db.students) ? db.students.length : 0;
  const staff = Array.isArray(db.staff) ? db.staff.length : 0;
  console.log(
    `Source: ${students} students, ${staff} staff, revision ${db.meta?.revision ?? '?'}`
  );
  if (!students) fail('Refusing to import a database with no students.');

  db.meta = {
    ...db.meta,
    layoutVersion: 2,
    // A new revision tells every client to drop its cache and refetch.
    revision: Number(db.meta?.revision || 0) + 1,
    updatedAt: new Date().toISOString(),
  };

  const sql = buildSql(db);
  const sqlFile = path.join(
    os.tmpdir(),
    `xchool-d1-import-${Date.now()}.sql`
  );
  fs.writeFileSync(sqlFile, sql, 'utf8');
  console.log(`SQL written to ${sqlFile} (${(sql.length / 1024 / 1024).toFixed(1)} MiB)`);

  if (dryRun) {
    console.log('Dry run: not touching D1.');
  } else {
    await runWrangler(sqlFile);
    console.log('D1 import complete. Restart/redeploy the API so isolated caches reload.');
  }
} catch (error) {
  fail(error.stack || error.message);
}
