import { adminAuth } from './firebase.js';
import { getDb, refreshStoreAsync } from './store.js';
import { STUDENT_PORTAL_DISABLED_MESSAGE, studentPortalEnabled } from './settings.js';

const CHECK_REVOKED = String(process.env.AUTH_CHECK_REVOKED || '').toLowerCase() === 'true';

/**
 * Extracts an ID token from the Authorization header.
 *
 * Tokens are intentionally never accepted from the query string: URLs end up
 * in proxy logs, browser history and referrers.
 */
export function extractBearer(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

export async function verifyIdToken(token) {
  return adminAuth().verifyIdToken(token, CHECK_REVOKED);
}

/**
 * Verifies the request token once and writes the standard 401 response when it
 * is missing or invalid. Returns the decoded claims, or null when the caller
 * must stop.
 */
async function authenticate(req, res) {
  const token = extractBearer(req);

  if (!token) {
    res.status(401).json({ error: 'Sign-in required.' });
    return null;
  }

  try {
    return await verifyIdToken(token);
  } catch (error) {
    const expired = error?.code === 'auth/id-token-expired';
    res
      .status(401)
      .json({ error: expired ? 'Your session expired. Sign in again.' : 'Invalid sign-in token.' });
    return null;
  }
}

/**
 * Resolves the staff record a verified token belongs to.
 *
 * Password accounts were created with uid === staff id. Google sign-in creates
 * a Firebase user whose uid is Google's, so the verified email is the fallback.
 * An unverified email is never trusted for that mapping.
 *
 * Accounts created before the numeric id migration keep the old uid
 * (STF-001); `legacyIds` keeps those working without recreating the user.
 */
export function resolveStaff(db, decoded) {
  const direct = db.staff.find((member) => member.id === decoded?.uid);
  if (direct) return direct;

  const uid = String(decoded?.uid || '').trim();
  if (uid) {
    const legacy = db.staff.find(
      (member) => Array.isArray(member.legacyIds) && member.legacyIds.map(String).includes(uid)
    );
    if (legacy) return legacy;
  }

  const email = String(decoded?.email || '').trim().toLowerCase();
  if (!decoded?.email_verified || !email) return null;

  return (
    db.staff.find((member) => String(member.email || '').trim().toLowerCase() === email) || null
  );
}

/**
 * Resolves the student record a verified token belongs to.
 *
 * The uid is the primary link (`student.authUid`). The verified email is the
 * fallback for Google sign-in and for school-issued password accounts, which
 * are created with `emailVerified: true`. An unverified email is never trusted.
 */
export function resolveStudent(db, decoded) {
  const uid = String(decoded?.uid || '').trim();
  if (uid) {
    const byUid = (db.students || []).find(
      (student) => student.authUid && String(student.authUid) === uid
    );
    if (byUid) return byUid;
  }

  const email = String(decoded?.email || '').trim().toLowerCase();
  if (!decoded?.email_verified || !email) return null;

  return (
    (db.students || []).find(
      (student) => String(student.authEmail || '').trim().toLowerCase() === email
    ) || null
  );
}

/** A student may use the portal only while the login is enabled and active. */
export function studentPortalProblem(student) {
  if (!student) return 'No student profile is linked to this account. Ask the school office.';
  if (student.authDisabled) return 'Student portal access is disabled for this account.';
  if (String(student.status || 'Active').trim().toLowerCase() !== 'active') {
    return 'This student record is not active. Ask the school office.';
  }
  return null;
}

/**
 * Resolves the signed-in student, reloading Firestore when this isolate's copy
 * has no link for the account yet.
 *
 * Administrators provision a login through one Worker isolate; the student's
 * next request can land on another isolate that booted earlier and therefore
 * still holds the record without `authUid`. Without the reload that student is
 * refused with "no student profile is linked" even though Firestore has the
 * link. The reload happens only on a miss, so normal requests never pay for it.
 */
export async function resolveStudentForRequest(decoded) {
  const student = resolveStudent(getDb(), decoded);
  if (student || !decoded?.uid) return student;

  const refreshed = await refreshStoreAsync();
  return refreshed ? resolveStudent(getDb(), decoded) : null;
}

/**
 * Resolves the signed-in staff member, reloading Firestore when this isolate's
 * copy has no matching record yet.
 *
 * The same isolate-cache problem as students applies when an administrator
 * creates a staff login: the teacher's first request can land on an isolate
 * that booted before the record existed. The reload only runs on a miss.
 */
export async function resolveActorForRequest(decoded) {
  const actor = resolveStaff(getDb(), decoded);
  if (actor || !decoded?.uid) return actor;

  const refreshed = await refreshStoreAsync();
  return refreshed ? resolveStaff(getDb(), decoded) : null;
}

/**
 * Staff middleware. A student token resolves to no staff record, so it can
 * never satisfy a staff route.
 */
export async function requireActor(req, res, next) {
  const decoded = await authenticate(req, res);
  if (!decoded) return undefined;

  const actor = await resolveActorForRequest(decoded);

  if (!actor) {
    return res
      .status(403)
      .json({ error: 'No staff profile is linked to this account. Ask an administrator.' });
  }
  if (!actor.isActive) {
    return res.status(403).json({ error: 'This account has been deactivated.' });
  }
  if (actor.apiBlocked) {
    return res.status(403).json({
      error: 'This account is blocked by an administrator.',
      code: 'ACCOUNT_BLOCKED',
    });
  }

  req.actor = actor;
  req.auth = decoded;
  return next();
}

/**
 * Student middleware. Staff tokens are rejected explicitly: the student portal
 * has its own endpoints and must never inherit staff-wide reads.
 */
export async function requireStudent(req, res, next) {
  const decoded = await authenticate(req, res);
  if (!decoded) return undefined;

  const db = getDb();
  if (resolveStaff(db, decoded)) {
    return res
      .status(403)
      .json({ error: 'Staff accounts cannot use the student portal. Use the teacher or admin app.' });
  }
  if (!studentPortalEnabled(db)) {
    return res
      .status(503)
      .json({ error: STUDENT_PORTAL_DISABLED_MESSAGE, code: 'STUDENT_PORTAL_DISABLED' });
  }

  const student = await resolveStudentForRequest(decoded);
  const problem = studentPortalProblem(student);
  if (problem) return res.status(403).json({ error: problem });
  if (student.apiBlocked) {
    return res
      .status(403)
      .json({ error: 'This account is blocked by an administrator.', code: 'ACCOUNT_BLOCKED' });
  }

  req.student = student;
  req.auth = decoded;
  return next();
}

/**
 * Photo routes authenticate either kind of account, then apply a narrow policy.
 * Keeping this separate from `requireActor` means a student token can never
 * reach an ordinary staff endpoint.
 */
export async function requireActorOrStudent(req, res, next) {
  const decoded = await authenticate(req, res);
  if (!decoded) return undefined;

  let actor = resolveStaff(getDb(), decoded);
  let student = actor ? null : resolveStudent(getDb(), decoded);

  // A student photo request has no staff record by design, so only reload when
  // neither lookup matches: otherwise every upload would re-read Firestore.
  if (!actor && !student && decoded.uid) {
    const refreshed = await refreshStoreAsync();
    if (refreshed) {
      actor = resolveStaff(getDb(), decoded);
      student = actor ? null : resolveStudent(getDb(), decoded);
    }
  }

  if (actor) {
    if (!actor.isActive) {
      return res.status(403).json({ error: 'This account has been deactivated.' });
    }
    if (actor.apiBlocked) {
      return res
        .status(403)
        .json({ error: 'This account is blocked by an administrator.', code: 'ACCOUNT_BLOCKED' });
    }
    req.actor = actor;
    req.auth = decoded;
    return next();
  }

  if (!studentPortalEnabled(getDb())) {
    return res
      .status(503)
      .json({ error: STUDENT_PORTAL_DISABLED_MESSAGE, code: 'STUDENT_PORTAL_DISABLED' });
  }
  const problem = studentPortalProblem(student);
  if (problem) return res.status(403).json({ error: problem });
  if (student.apiBlocked) {
    return res
      .status(403)
      .json({ error: 'This account is blocked by an administrator.', code: 'ACCOUNT_BLOCKED' });
  }

  req.student = student;
  req.auth = decoded;
  return next();
}
