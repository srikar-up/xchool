/**
 * School-wide access switches.
 *
 * These are stored on `meta` so every isolate sees them with the rest of the
 * database, and so the admin console can flip them without a deploy.
 */

export const STUDENT_PORTAL_DISABLED_MESSAGE =
  'The student portal is switched off by the school. Ask the office to enable it.';

/** The portal is on unless an administrator explicitly turned it off. */
export function studentPortalEnabled(db) {
  return db?.meta?.studentPortalEnabled !== false;
}

/** Normalises the admin payload; `undefined` means "leave unchanged". */
export function parseSwitch(value) {
  if (value === undefined || value === null) return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}
