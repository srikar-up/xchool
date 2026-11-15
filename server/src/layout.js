/**
 * Shared database layout.
 *
 * The API keeps the whole school in memory and persists it to D1 as:
 *
 *   meta fields                    one row each
 *   every collection               one row per record
 *
 * D1 limits a single SQL statement to ~100 KB. Storing a whole `exams` or
 * `timetable` array in one row breaks that limit at school scale, so every
 * collection is now split into per-record rows.
 *
 * `RECORD_COLLECTIONS` still means "grows with every school day or exam" for
 * delta sync and for the slices a client fetches; it no longer selects the
 * storage shape.
 */
export const COLLECTION_KEYS = [
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

/**
 * Collections that grow with every school day or exam. Clients fetch these as
 * separate slices, and a mutation usually touches a handful of rows.
 */
export const RECORD_COLLECTIONS = [
  'students',
  'testRecords',
  'attendanceSessions',
  'staffAttendance',
];

export const CONFIG_COLLECTIONS = COLLECTION_KEYS.filter(
  (key) => !RECORD_COLLECTIONS.includes(key)
);

/** Layout 3 stores every collection as one row per record. */
export const LAYOUT_VERSION = 3;

/**
 * D1 rejects a SQL statement over ~100 KB. A record is written as one INSERT,
 * so keep the JSON well below that (quotes are escaped in the statement).
 */
export const MAX_DOCUMENT_BYTES = 80 * 1024;

export function documentBytes(value) {
  const text = JSON.stringify(value);
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(text, 'utf8');
  return new TextEncoder().encode(text).length;
}

export function assertDocumentSize(label, value) {
  const bytes = documentBytes(value);
  if (bytes > MAX_DOCUMENT_BYTES) {
    const mib = (bytes / (1024 * 1024)).toFixed(2);
    throw new Error(
      `${label} is ${mib} MiB, over the ${(MAX_DOCUMENT_BYTES / (1024 * 1024)).toFixed(
        2
      )} MiB safety limit. Split this collection into per-record rows.`
    );
  }
  return bytes;
}
