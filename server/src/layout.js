/**
 * Shared database layout.
 *
 * The API keeps the whole school in memory and persists it as:
 *
 *   meta fields                    one row each
 *   small collections              one row each (the array)
 *   high-growth collections        one row per record
 *
 * The same shape is used by the D1 backend. The old Firestore backend (being
 * removed) also used it, so the constants live here instead of in a storage
 * driver.
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
 * Collections that grow with every school day or exam. These are stored as one
 * row per record so a single register or mark never bloats a collection row.
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

export const LAYOUT_VERSION = 2;

/** A stored row must stay well under D1's practical response limits. */
export const MAX_DOCUMENT_BYTES = 900 * 1024;

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
