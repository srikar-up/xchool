/**
 * School identity numbers.
 *
 * Every person gets a six-digit number:
 *
 *   Student  260001   2026 intake, first student  (YY + 4-digit serial)
 *   Staff    900001   first staff member          (9 + 5-digit serial)
 *
 * The student prefix is the last two digits of the admission year, so the card
 * tells you when the student joined and each intake year has room for 9,999
 * students. Students only use prefixes 00-89; 90-99 is the staff range, which
 * makes a student/staff collision impossible.
 *
 * `migrateIdentity` upgrades a database that still uses the old readable ids
 * (STU-10A-01, STF-001). It rewrites every reference - attendance entries,
 * marks, assigned teachers, class incharges, report remarks, the audit log -
 * and keeps the previous value in `legacyIds`. Staff legacy ids also keep the
 * existing Firebase password accounts working, because those tokens still
 * carry the old uid.
 *
 * The migration is deterministic (same input, same numbers) and idempotent
 * (guarded by `meta.identityVersion`), so it is safe to run at boot in more
 * than one Worker isolate.
 */

export const IDENTITY_VERSION = 1;
export const IDENTITY_SCHEME = 'students:YY####,staff:9#####';
export const STAFF_ID_PREFIX = '9';
export const MAX_STUDENT_SERIAL = 9999;
export const MAX_STAFF_SERIAL = 99999;
/** Student year prefixes 90-99 are reserved for the staff range. */
export const MAX_STUDENT_YEAR_PREFIX = 89;

const STUDENT_ID_PATTERN = /^(\d{2})(\d{4})$/;
const STAFF_ID_PATTERN = /^9(\d{5})$/;
const LEGACY_STAFF_PATTERN = /^STF-(\d+)$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

function pad(value, size) {
  return String(value).padStart(size, '0');
}

function appendUnique(list, value) {
  const next = Array.isArray(list) ? list.map(String) : [];
  if (!next.includes(String(value))) next.push(String(value));
  return next;
}

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), 'en', { numeric: true });
}

/** Four-digit year of an ISO date/time, or null when it is not usable. */
export function yearFromDate(value) {
  const match = DATE_PATTERN.exec(String(value ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1900 && year <= 2099 ? year : null;
}

export function isStudentId(value) {
  const match = STUDENT_ID_PATTERN.exec(String(value ?? '').trim());
  return Boolean(match) && Number(match[1]) <= MAX_STUDENT_YEAR_PREFIX;
}

export function isStaffId(value) {
  return STAFF_ID_PATTERN.test(String(value ?? '').trim());
}

/** Admission year encoded in a student id: 260001 -> 2026. */
export function yearOfStudentId(value) {
  const match = STUDENT_ID_PATTERN.exec(String(value ?? '').trim());
  if (!match || Number(match[1]) > MAX_STUDENT_YEAR_PREFIX) return null;
  return 2000 + Number(match[1]);
}

export function studentYearPrefix(year) {
  const prefix = ((Number(year) % 100) + 100) % 100;
  if (!Number.isFinite(prefix) || prefix > MAX_STUDENT_YEAR_PREFIX) {
    throw new Error(`Student ids do not support the year ${year}.`);
  }
  return pad(prefix, 2);
}

/**
 * Checks a hand-written student id against the admission year.
 * Returns a human-readable problem, or null when the id is fine.
 */
export function studentCodeProblem(code, admissionDate) {
  const value = String(code ?? '').trim();
  if (!isStudentId(value)) {
    return 'Student IDs are six digits: the last two digits of the admission year plus a 4-digit serial, for example 260001.';
  }
  const year = yearFromDate(admissionDate);
  if (year && Number(value.slice(0, 2)) !== year % 100) {
    return `Student ID ${value} does not match the ${year} admission year. Use ${studentYearPrefix(
      year
    )}xxxx.`;
  }
  return null;
}

function intakeYear(student, fallbackYear) {
  return (
    yearFromDate(student?.admissionDate) ||
    yearFromDate(student?.createdAt) ||
    fallbackYear
  );
}

function parsedStaffSerial(member) {
  const id = String(member?.id ?? '').trim();
  const modern = STAFF_ID_PATTERN.exec(id);
  if (modern) return Number(modern[1]);
  const legacy = LEGACY_STAFF_PATTERN.exec(id);
  if (legacy) return Number(legacy[1]);
  return null;
}

function staffSerial(member) {
  return parsedStaffSerial(member) ?? Number.MAX_SAFE_INTEGER;
}

function studentOrder(a, b) {
  return (
    String(a?.admissionDate ?? '').localeCompare(String(b?.admissionDate ?? '')) ||
    String(a?.createdAt ?? '').localeCompare(String(b?.createdAt ?? '')) ||
    naturalCompare(a?.id, b?.id)
  );
}

function remapField(rows, field, map) {
  if (!Array.isArray(rows) || !map.size) return false;
  let changed = false;
  for (const row of rows) {
    const current = row?.[field];
    if (current === undefined || current === null || current === '') continue;
    const next = map.get(String(current));
    if (next && next !== current) {
      row[field] = next;
      changed = true;
    }
  }
  return changed;
}

function remapReportRemarks(students, staffMap) {
  if (!staffMap.size) return false;
  let changed = false;
  for (const student of students) {
    const remarks = student?.reportRemarks;
    if (!remarks || typeof remarks !== 'object' || Array.isArray(remarks)) continue;
    const next = {};
    for (const [staffId, remark] of Object.entries(remarks)) {
      const mappedId = staffMap.get(String(staffId)) || staffId;
      const mappedRemark =
        remark && typeof remark === 'object'
          ? {
              ...remark,
              updatedBy: staffMap.get(String(remark.updatedBy ?? '')) || remark.updatedBy,
            }
          : remark;
      next[mappedId] = mappedRemark;
      if (mappedId !== staffId || mappedRemark !== remark) changed = true;
    }
    student.reportRemarks = next;
  }
  return changed;
}

/** True when any staff or student row still carries a pre-numeric id. */
export function needsIdentityMigration(database) {
  const staff = Array.isArray(database?.staff) ? database.staff : [];
  const students = Array.isArray(database?.students) ? database.students : [];
  return (
    staff.some((member) => member?.id && !isStaffId(member.id)) ||
    students.some((student) => student?.id && !isStudentId(student.id))
  );
}

/**
 * Renumbers a database in place and rewrites every reference.
 *
 * @param {object} database
 * @param {{ force?: boolean, now?: Date, fallbackYear?: number }} options
 *   `force` renumbers even when `meta.identityVersion` is current; the CSV
 *   import uses it for bundles exported before numeric ids existed.
 * @returns {{ changed: boolean, staffMap: Map<string,string>, studentMap: Map<string,string>, staff: number, students: number }}
 */
export function migrateIdentity(database, options = {}) {
  const { force = false, now = new Date(), fallbackYear = now.getFullYear() } = options;
  const result = {
    changed: false,
    staffMap: new Map(),
    studentMap: new Map(),
    staff: 0,
    students: 0,
  };
  if (!database || typeof database !== 'object') return result;

  const staff = Array.isArray(database.staff) ? database.staff : [];
  const students = Array.isArray(database.students) ? database.students : [];
  const version = Number(database.meta?.identityVersion || 0);
  if (!force && version >= IDENTITY_VERSION) return result;
  if (!staff.length && !students.length && version >= IDENTITY_VERSION) return result;

  let changed = false;

  /* ---------------------------------------------------------------- */
  /* Staff: 900001, 900002 ...                                         */
  /* ---------------------------------------------------------------- */

  const orderedStaff = staff
    .map((member, index) => ({ member, index }))
    .sort(
      (a, b) =>
        staffSerial(a.member) - staffSerial(b.member) ||
        String(a.member?.joinedOn ?? '').localeCompare(String(b.member?.joinedOn ?? '')) ||
        naturalCompare(a.member?.id, b.member?.id) ||
        a.index - b.index
    );

  orderedStaff.forEach(({ member }, position) => {
    const oldId = String(member?.id ?? '').trim();
    if (!oldId) return;
    const serial = position + 1;
    if (serial > MAX_STAFF_SERIAL) {
      throw new Error('The staff table is full: 99,999 numbers have been used.');
    }
    const target = `${STAFF_ID_PREFIX}${pad(serial, 5)}`;
    if (oldId !== target) {
      result.staffMap.set(oldId, target);
      member.legacyIds = appendUnique(member.legacyIds, oldId);
      member.id = target;
      member.code = target;
      changed = true;
      result.staff += 1;
    } else if (member.code !== target) {
      member.code = target;
      changed = true;
    }
  });

  /* ---------------------------------------------------------------- */
  /* Students: YY + #### within each intake year                       */
  /* ---------------------------------------------------------------- */

  const byYear = new Map();
  for (const student of students) {
    if (!student?.id) continue;
    const year = intakeYear(student, fallbackYear);
    if (!Number.isFinite(year)) {
      throw new Error(
        `Cannot build a student id for ${student.name || student.id}: no usable admission year.`
      );
    }
    const list = byYear.get(year) || [];
    list.push(student);
    byYear.set(year, list);
  }

  for (const [year, list] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    const prefix = studentYearPrefix(year);
    list.sort(studentOrder).forEach((student, index) => {
      const serial = index + 1;
      if (serial > MAX_STUDENT_SERIAL) {
        throw new Error(
          `The ${year} intake has more than ${MAX_STUDENT_SERIAL} students; the id format is full.`
        );
      }
      const oldId = String(student.id).trim();
      const target = `${prefix}${pad(serial, 4)}`;
      if (oldId !== target) {
        result.studentMap.set(oldId, target);
        student.legacyIds = appendUnique(student.legacyIds, oldId);
        student.id = target;
        student.code = target;
        changed = true;
        result.students += 1;
      } else if (student.code !== target) {
        student.code = target;
        changed = true;
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* References                                                        */
  /* ---------------------------------------------------------------- */

  const staffFields = [
    ['subjects', 'assignedStaffId'],
    ['timetable', 'teacherStaffId'],
    ['exams', 'assignedStaffId'],
    ['assignments', 'createdByStaffId'],
    ['classIncharges', 'defaultStaffId'],
    ['classIncharges', 'activeStaffId'],
    ['rmsTickets', 'senderStaffId'],
    ['staffAttendance', 'staffId'],
    ['testRecords', 'enteredByStaffId'],
    ['classes', 'classTeacherId'],
    ['attendanceSessions', 'submittedByStaffId'],
    ['attendanceSessions', 'updatedByStaffId'],
  ];
  for (const [collection, field] of staffFields) {
    if (remapField(database[collection], field, result.staffMap)) changed = true;
  }

  for (const session of database.attendanceSessions || []) {
    if (!Array.isArray(session?.entries)) continue;
    for (const entry of session.entries) {
      if (!entry?.studentId) continue;
      const next = result.studentMap.get(String(entry.studentId));
      if (next) {
        entry.studentId = next;
        changed = true;
      }
    }
  }

  for (const record of database.testRecords || []) {
    const next = result.studentMap.get(String(record?.studentId ?? ''));
    if (!next) continue;
    record.studentId = next;
    if (record.examId) record.id = `TR-${record.examId}-${next}`;
    changed = true;
  }

  for (const activity of database.activities || []) {
    if (!activity) continue;
    const actor = result.staffMap.get(String(activity.actorId ?? ''));
    if (actor) {
      activity.actorId = actor;
      changed = true;
    }
    if (!activity.entityId) continue;
    if (activity.entity === 'Staff') {
      const entity = result.staffMap.get(String(activity.entityId));
      if (entity) {
        activity.entityId = entity;
        changed = true;
      }
    } else if (activity.entity === 'Student') {
      const entity = result.studentMap.get(String(activity.entityId));
      if (entity) {
        activity.entityId = entity;
        changed = true;
      }
    }
  }

  if (remapReportRemarks(students, result.staffMap)) changed = true;

  const lastImport = database.meta?.lastImport;
  if (lastImport?.by) {
    const mapped = result.staffMap.get(String(lastImport.by));
    if (mapped) {
      lastImport.by = mapped;
      changed = true;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Marker                                                            */
  /* ---------------------------------------------------------------- */

  const markerChanged =
    Number(database.meta?.identityVersion || 0) !== IDENTITY_VERSION ||
    database.meta?.idScheme !== IDENTITY_SCHEME;
  if (markerChanged) {
    database.meta = {
      ...(database.meta || {}),
      identityVersion: IDENTITY_VERSION,
      idScheme: IDENTITY_SCHEME,
    };
    changed = true;
  }

  if (changed) {
    database.meta.revision = Number(database.meta.revision || 0) + 1;
    database.meta.updatedAt = now.toISOString();
  }

  result.changed = changed;
  return result;
}

/**
 * Next student number for an admission date.
 * Uses the highest number in that intake year, so a deleted student's number is
 * never handed to somebody else.
 */
export function nextStudentId(database, admissionDate, fallbackYear = new Date().getFullYear()) {
  const year = yearFromDate(admissionDate) || fallbackYear;
  const prefix = studentYearPrefix(year);
  let highest = 0;
  for (const student of database?.students || []) {
    const match = STUDENT_ID_PATTERN.exec(String(student?.id ?? '').trim());
    if (!match || match[1] !== prefix) continue;
    highest = Math.max(highest, Number(match[2]));
  }
  const next = highest + 1;
  if (next > MAX_STUDENT_SERIAL) {
    throw new Error(`The ${year} intake has used all ${MAX_STUDENT_SERIAL} student numbers.`);
  }
  return `${prefix}${pad(next, 4)}`;
}

/** Next staff number: 900001, 900002 ... also honours legacy STF-### rows. */
export function nextStaffId(database) {
  let highest = 0;
  for (const member of database?.staff || []) {
    const serial = parsedStaffSerial(member);
    if (serial !== null) highest = Math.max(highest, serial);
  }
  const next = highest + 1;
  if (next > MAX_STAFF_SERIAL) {
    throw new Error('The staff table has used all 99,999 numbers.');
  }
  return `${STAFF_ID_PREFIX}${pad(next, 5)}`;
}
