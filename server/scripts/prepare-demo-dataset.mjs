/**
 * Prepares a realistic demo/stress-test database from a CSV bundle export.
 *
 * The source is the Indian sample school (`test db/nawaz-school-data-indian.zip`,
 * `data.json`). This script:
 *
 *   1. rebrands the school as Xchool (the sample still says "Opinawaz ...")
 *   2. renumbers students/staff to the school scheme (260001, 900001, ...) and
 *      rewrites every reference (attendance, marks, teachers, audit log)
 *   3. tops up attendance and staff attendance for the school days after the
 *      export's last date, so the demo is current
 *   4. adds a recent announcement
 *   5. sets layout v3 and bumps the revision
 *
 *   node server/scripts/prepare-demo-dataset.mjs \
 *     --data path/to/data.json --out path/to/import-ready.json
 *
 * Then import it:
 *   npm run import:d1 -- --data path/to/import-ready.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { migrateIdentity } from '../src/identity.js';
import { LAYOUT_VERSION } from '../src/layout.js';

const args = process.argv.slice(2);
const valueOf = (name, fallback = '') => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};

const source = valueOf('data');
if (!source) {
  console.error('Usage: node server/scripts/prepare-demo-dataset.mjs --data <data.json> [--out <file>]');
  process.exit(1);
}

const output =
  valueOf('out') ||
  path.join(path.dirname(path.resolve(source)), 'xchool-import-ready.json');

const db = JSON.parse(fs.readFileSync(path.resolve(source), 'utf8'));
if (!Array.isArray(db.students) || !Array.isArray(db.staff)) {
  throw new Error('The source is not a full database export.');
}

const original = {
  students: db.students.length,
  staff: db.staff.length,
  classes: db.classes?.length || 0,
  exams: db.exams?.length || 0,
  marks: db.testRecords?.length || 0,
  attendance: db.attendanceSessions?.length || 0,
};

/* ------------------------------------------------------------------ */
/* 1. Xchool profile                                                   */
/* ------------------------------------------------------------------ */

const principal =
  (db.staff || []).find((member) => member.accessLevel === 'SuperAdmin') || db.staff[0];

db.meta = {
  ...db.meta,
  schoolName: 'Xchool',
  shortName: 'Xchool',
  tagline: 'Learn. Grow. Lead.',
  academicYear: '2026–2027',
  address: '12-B Vaishali Nagar, Jaipur, Rajasthan, India',
  phone: '+91 141 401 2200',
  email: 'office@xchool.edu.in',
  principalName: principal?.name || db.meta.principalName || 'Principal',
  studentPortalEnabled: true,
  schemaVersion: Number(db.meta.schemaVersion) || 1,
};

/* ------------------------------------------------------------------ */
/* 2. Numeric identity numbers and all references                      */
/* ------------------------------------------------------------------ */

const identity = migrateIdentity(db);
console.log(
  `Renumbered ${identity.students} student(s) and ${identity.staff} staff member(s).`
);

/* ------------------------------------------------------------------ */
/* 3. Current attendance                                               */
/* ------------------------------------------------------------------ */

const iso = (date) => date.toISOString().slice(0, 10);
const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};
const weekdayName = (date) =>
  date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

const dates = (db.attendanceSessions || []).map((session) => session.date).filter(Boolean).sort();
const lastDate = dates.at(-1);
const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
const sessionsByKey = new Set(
  (db.attendanceSessions || []).map((s) => `${s.classIdSection}|${s.date}|${s.sessionType}`)
);
const inchargeByClass = new Map(
  (db.classIncharges || []).map((entry) => [entry.classIdSection, entry.activeStaffId])
);
const sessionTypes =
  db.meta.attendanceMode === 'fullDay' ? ['FullDay'] : ['Morning', 'Afternoon'];

let addedSessions = 0;
let addedEntries = 0;

if (lastDate) {
  for (let date = addDays(new Date(`${lastDate}T00:00:00Z`), 1); date <= today; date = addDays(date, 1)) {
    if (date.getUTCDay() === 0) continue; // Sunday
    const day = iso(date);

    for (const cls of db.classes || []) {
      const students = db.students.filter((student) => student.classIdSection === cls.id);
      if (!students.length) continue;

      for (const sessionType of sessionTypes) {
        const key = `${cls.id}|${day}|${sessionType}`;
        if (sessionsByKey.has(key)) continue;

        const entries = students.map((student, index) => {
          const seed = (Number(String(student.id).slice(-3)) + index + (sessionType === 'Morning' ? 0 : 7)) % 97;
          let status = 'present';
          let remarks = '';
          if (seed % 31 === 0) {
            status = 'absent';
            remarks = 'Family emergency — informed by guardian';
          } else if (seed % 29 === 0) {
            status = 'late';
          } else if (seed % 37 === 0) {
            status = 'excused';
            remarks = 'Medical appointment';
          }
          return { studentId: student.id, status, remarks };
        });

        db.attendanceSessions.push({
          id: `ATT-${cls.id}-${day}-${sessionType}`,
          classIdSection: cls.id,
          date: day,
          dayOfWeek: weekdayName(date),
          sessionType,
          periodNumber: null,
          submittedByStaffId: inchargeByClass.get(cls.id) || principal.id,
          submittedAt: `${day}T${sessionType === 'Morning' ? '08:15' : '12:45'}:00.000Z`,
          entries,
        });
        sessionsByKey.add(key);
        addedSessions += 1;
        addedEntries += entries.length;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 4. Staff attendance for the same days                               */
/* ------------------------------------------------------------------ */

const staffKeys = new Set((db.staffAttendance || []).map((row) => `${row.date}|${row.staffId}`));
let addedStaffAttendance = 0;
const workingDays = new Set(
  (db.attendanceSessions || [])
    .filter((session) => session.date > (lastDate || ''))
    .map((session) => session.date)
);
for (const day of [...workingDays].sort()) {
  (db.staff || []).forEach((member, index) => {
    if (!member.isActive) return;
    const key = `${day}|${member.id}`;
    if (staffKeys.has(key)) return;
    const onLeave = index % 19 === 0;
    db.staffAttendance.push({
      id: `SA-${day.replace(/-/g, '')}-${member.id}`,
      staffId: member.id,
      staffName: member.name,
      date: day,
      checkInTime: onLeave ? '' : '08:04',
      checkOutTime: onLeave ? '' : '14:18',
      status: onLeave ? 'Leave' : 'Present',
      leaveReason: onLeave ? 'Approved casual leave' : '',
    });
    addedStaffAttendance += 1;
  });
}

/* ------------------------------------------------------------------ */
/* 5. Recent announcement                                              */
/* ------------------------------------------------------------------ */

if (Array.isArray(db.announcements) && db.announcements.length) {
  const latest = db.announcements.map((row) => row.createdAt).sort().at(-1);
  db.announcements.unshift({
    id: `ANN-${String(db.announcements.length + 1).padStart(3, '0')}`,
    title: 'Annual Sports Day — Trials This Week',
    body:
      'Trials for the annual sports meet begin on Saturday. Students should report to the ground in their house colours with a water bottle. Class teachers will share the event list during the morning register.',
    importance: 'Important',
    audience: 'All',
    isPinned: false,
    publisherName: principal?.name || 'Principal',
    createdAt: new Date(Math.max(Date.now(), Date.parse(latest || '') + 60_000)).toISOString(),
  });
}

/* ------------------------------------------------------------------ */
/* 6. Final metadata                                                   */
/* ------------------------------------------------------------------ */

db.meta.layoutVersion = LAYOUT_VERSION;
db.meta.today = iso(today);
db.meta.todayName = weekdayName(today);
db.meta.revision = Number(db.meta.revision || 0) + 1;
db.meta.updatedAt = new Date().toISOString();

fs.writeFileSync(output, JSON.stringify(db, null, 2), 'utf8');

console.log('');
console.log(`Source:  ${original.students} students, ${original.staff} staff, ${original.exams} exams`);
console.log(`Output:  ${output}`);
console.log(
  `Now:     ${db.students.length} students, ${db.staff.length} staff, ${db.classes.length} classes, ` +
    `${db.exams.length} exams, ${db.testRecords.length} marks, ${db.attendanceSessions.length} attendance registers`
);
console.log(
  `Added:   ${addedSessions} attendance registers (${addedEntries} entries), ${addedStaffAttendance} staff attendance rows`
);
console.log(`IDs:     ${db.students[0].id} … ${db.staff[0].id} (scheme ${db.meta.idScheme})`);
