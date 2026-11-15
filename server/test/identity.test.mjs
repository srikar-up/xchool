/**
 * Numeric school identity numbers.
 *
 *   node --test server/test/identity.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSeed } from '../src/seed.js';
import {
  IDENTITY_VERSION,
  isStaffId,
  isStudentId,
  migrateIdentity,
  needsIdentityMigration,
  nextStaffId,
  nextStudentId,
  studentCodeProblem,
} from '../src/identity.js';

test('the seed is born with six-digit numbers', () => {
  const db = buildSeed();
  assert.equal(db.meta.identityVersion, IDENTITY_VERSION);
  assert.ok(db.students.every((student) => isStudentId(student.id)));
  assert.ok(db.students.every((student) => student.code === student.id));
  assert.ok(db.staff.every((member) => isStaffId(member.id)));
  assert.ok(db.staff.every((member) => member.code === member.id));

  const all = new Set([...db.students, ...db.staff].map((entry) => entry.id));
  assert.equal(all.size, db.students.length + db.staff.length, 'ids must be unique');
});

test('student numbers carry their intake year', () => {
  const db = buildSeed();
  const intake2016 = db.students.filter((student) => student.admissionDate.startsWith('2016'));
  const intake2017 = db.students.filter((student) => student.admissionDate.startsWith('2017'));
  assert.ok(intake2016.length > 0);
  assert.ok(intake2017.length > 0);
  assert.ok(intake2016.every((student) => student.id.startsWith('16')));
  assert.ok(intake2017.every((student) => student.id.startsWith('17')));
});

function legacyDatabase() {
  return {
    meta: { revision: 5, lastImport: { by: 'STF-001', mode: 'merge' } },
    staff: [
      { id: 'STF-001', code: 'STF-001', name: 'Admin', email: 'admin@example.edu', isActive: true },
      { id: 'STF-002', code: 'STF-002', name: 'Teacher', email: 'teacher@example.edu', isActive: true },
    ],
    students: [
      {
        id: 'STU-10A-02',
        code: 'STU-10A-02',
        name: 'Second',
        admissionDate: '2026-04-15',
        createdAt: '2026-04-14T00:00:00.000Z',
      },
      {
        id: 'STU-10A-01',
        code: 'STU-10A-01',
        name: 'First',
        admissionDate: '2026-04-15',
        createdAt: '2026-04-14T00:00:00.000Z',
        reportRemarks: {
          'STF-002': { text: 'Good term', updatedBy: 'STF-002', updatedByName: 'Teacher' },
        },
      },
      {
        id: 'STU-9A-01',
        code: 'STU-9A-01',
        name: 'Older',
        admissionDate: '2025-04-15',
        createdAt: '2025-04-14T00:00:00.000Z',
      },
    ],
    classes: [{ id: '10-A', classTeacherId: 'STF-002' }],
    subjects: [{ id: 'sub', assignedStaffId: 'STF-002' }],
    timetable: [{ id: 'tt', teacherStaffId: 'STF-002' }],
    exams: [{ id: 'EX-1', assignedStaffId: 'STF-002' }],
    assignments: [{ id: 'as', createdByStaffId: 'STF-002' }],
    classIncharges: [{ id: 'ci', defaultStaffId: 'STF-002', activeStaffId: 'STF-002' }],
    rmsTickets: [{ id: 'rms', senderStaffId: 'STF-002' }],
    staffAttendance: [{ id: 'sa', staffId: 'STF-002' }],
    attendanceSessions: [
      {
        id: 'att',
        submittedByStaffId: 'STF-002',
        updatedByStaffId: 'STF-002',
        entries: [{ studentId: 'STU-10A-01', status: 'present' }],
      },
    ],
    testRecords: [
      {
        id: 'TR-EX-1-STU-10A-01',
        examId: 'EX-1',
        studentId: 'STU-10A-01',
        enteredByStaffId: 'STF-002',
      },
    ],
    activities: [
      { id: 'a1', actorId: 'STF-002', entity: 'Student', entityId: 'STU-10A-01' },
      { id: 'a2', actorId: 'STF-001', entity: 'Staff', entityId: 'STF-002' },
    ],
  };
}

test('legacy ids are renumbered deterministically', () => {
  const db = legacyDatabase();
  assert.equal(needsIdentityMigration(db), true);

  const result = migrateIdentity(db);
  assert.equal(result.changed, true);
  assert.equal(result.students, 3);
  assert.equal(result.staff, 2);

  assert.equal(db.staff[0].id, '900001');
  assert.equal(db.staff[1].id, '900002');
  assert.deepEqual(db.staff[1].legacyIds, ['STF-002']);

  // Same admission date + createdAt: natural id order decides the serial.
  const first = db.students.find((student) => student.name === 'First');
  const second = db.students.find((student) => student.name === 'Second');
  const older = db.students.find((student) => student.name === 'Older');
  assert.equal(first.id, '260001');
  assert.equal(second.id, '260002');
  assert.equal(older.id, '250001');
  assert.deepEqual(first.legacyIds, ['STU-10A-01']);

  assert.equal(db.meta.identityVersion, IDENTITY_VERSION);
  assert.equal(db.meta.revision, 6, 'a renumbering is a revision');
});

test('every reference follows the new numbers', () => {
  const db = legacyDatabase();
  migrateIdentity(db);

  assert.equal(db.classes[0].classTeacherId, '900002');
  assert.equal(db.subjects[0].assignedStaffId, '900002');
  assert.equal(db.timetable[0].teacherStaffId, '900002');
  assert.equal(db.exams[0].assignedStaffId, '900002');
  assert.equal(db.assignments[0].createdByStaffId, '900002');
  assert.equal(db.classIncharges[0].defaultStaffId, '900002');
  assert.equal(db.classIncharges[0].activeStaffId, '900002');
  assert.equal(db.rmsTickets[0].senderStaffId, '900002');
  assert.equal(db.staffAttendance[0].staffId, '900002');
  assert.equal(db.attendanceSessions[0].submittedByStaffId, '900002');
  assert.equal(db.attendanceSessions[0].updatedByStaffId, '900002');
  assert.equal(db.attendanceSessions[0].entries[0].studentId, '260001');
  assert.equal(db.testRecords[0].studentId, '260001');
  assert.equal(db.testRecords[0].enteredByStaffId, '900002');
  assert.equal(db.testRecords[0].id, 'TR-EX-1-260001');
  assert.equal(db.activities[0].actorId, '900002');
  assert.equal(db.activities[0].entityId, '260001');
  assert.equal(db.activities[1].actorId, '900001');
  assert.equal(db.activities[1].entityId, '900002');
  assert.equal(db.meta.lastImport.by, '900001');

  const remarks = db.students.find((student) => student.name === 'First').reportRemarks;
  assert.deepEqual(Object.keys(remarks), ['900002']);
  assert.equal(remarks['900002'].updatedBy, '900002');
  assert.equal(remarks['900002'].text, 'Good term');
});

test('the migration is idempotent', () => {
  const db = legacyDatabase();
  migrateIdentity(db);
  const snapshot = JSON.stringify(db);
  const again = migrateIdentity(db);
  assert.equal(again.changed, false);
  assert.equal(JSON.stringify(db), snapshot);
});

test('the next student number continues the intake year', () => {
  const db = {
    students: [{ id: '260001' }, { id: '260002' }, { id: '250009' }],
  };
  assert.equal(nextStudentId(db, '2026-04-01'), '260003');
  assert.equal(nextStudentId(db, '2025-04-01'), '250010');
  assert.equal(nextStudentId(db, '2027-04-01'), '270001');
});

test('the next staff number continues the 9 range', () => {
  assert.equal(nextStaffId({ staff: [{ id: '900012' }] }), '900013');
  assert.equal(nextStaffId({ staff: [{ id: 'STF-007' }] }), '900008');
  assert.equal(nextStaffId({ staff: [] }), '900001');
});

test('hand-written ids must match the admission year', () => {
  assert.equal(studentCodeProblem('260001', '2026-04-01'), null);
  assert.match(studentCodeProblem('900001', '2026-04-01'), /six digits/); // staff range
  assert.match(studentCodeProblem('STU-10A-01', '2026-04-01'), /six digits/);
  assert.match(studentCodeProblem('250001', '2026-04-01'), /admission year/);
  assert.equal(studentCodeProblem('270001', '2027-01-01'), null);
});
