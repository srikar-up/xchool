/**
 * Student portal read model: resolution and cross-student isolation.
 *
 *   node --test server/test/student-portal.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSeed } from '../src/seed.js';
import { resolveStaff, resolveStudent, studentPortalProblem } from '../src/auth.js';
import { buildStudentBootstrap, studentChangeRelevant } from '../src/student-data.js';

function linkedDb() {
  const db = buildSeed();
  const [first, second] = db.students;
  first.authUid = 'firebase-student-a';
  first.authEmail = 'student.a@xchool.test';
  second.authUid = 'firebase-student-b';
  second.authEmail = 'student.b@xchool.test';
  second.name = 'Zzz Isolation Student';
  return { db, first, second };
}

test('a student resolves by uid and by verified email', () => {
  const { db, first } = linkedDb();
  assert.equal(resolveStudent(db, { uid: 'firebase-student-a' }).id, first.id);
  assert.equal(
    resolveStudent(db, {
      uid: 'google-uid-not-linked',
      email: 'student.a@xchool.test',
      email_verified: true,
    }).id,
    first.id
  );
  assert.equal(
    resolveStudent(db, {
      uid: 'google-uid-not-linked',
      email: 'STUDENT.A@XCHOOL.TEST',
      email_verified: true,
    }).id,
    first.id,
    'email matching is case-insensitive'
  );
});

test('an unverified email never resolves a student', () => {
  const { db } = linkedDb();
  assert.equal(
    resolveStudent(db, {
      uid: 'google-uid-not-linked',
      email: 'student.a@xchool.test',
      email_verified: false,
    }),
    null
  );
  assert.equal(resolveStudent(db, { uid: 'nobody', email: 'nobody@xchool.test' }), null);
});

test('a student token is not a staff token', () => {
  const { db } = linkedDb();
  assert.equal(resolveStaff(db, { uid: 'firebase-student-a' }), null);
  assert.equal(
    resolveStaff(db, {
      uid: 'firebase-student-a',
      email: 'student.a@xchool.test',
      email_verified: true,
    }),
    null
  );
});

test('disabled or inactive students cannot use the portal', () => {
  const { db, first } = linkedDb();
  assert.equal(studentPortalProblem(first), null);
  first.authDisabled = true;
  assert.match(studentPortalProblem(first), /disabled/);
  first.authDisabled = false;
  first.status = 'Graduated';
  assert.match(studentPortalProblem(first), /not active/);
});

test('the bootstrap contains only the signed-in student', () => {
  const { db, first, second } = linkedDb();
  const snapshot = buildStudentBootstrap(db, first.id);

  assert.equal(snapshot.student.id, first.id);
  assert.equal(snapshot.student.authUid, undefined, 'auth plumbing stays server-side');
  assert.equal(snapshot.class.id, first.classIdSection);

  const json = JSON.stringify(snapshot);
  assert.equal(json.includes(second.id), false, 'other student id must not leak');
  assert.equal(json.includes(second.name), false, 'other student name must not leak');
  assert.equal(json.includes('authUid'), false);

  assert.ok(snapshot.subjects.length > 0);
  assert.ok(snapshot.subjects.every((subject) => subject.classIdSection === undefined));
  assert.ok(snapshot.timetable.length > 0);
  assert.ok(snapshot.timetable.every((period) => period.id.startsWith('TT-')));
  assert.ok(snapshot.results.every((result) => result.studentId === undefined));
  assert.ok(snapshot.attendance.every((entry) => entry.studentId === undefined));
  assert.ok(snapshot.announcements.every((notice) => notice.audience !== 'TeachersOnly'));
});

test('attendance and marks are limited to the signed-in student', () => {
  const { db, first, second } = linkedDb();
  const firstSnapshot = buildStudentBootstrap(db, first.id);
  const secondSnapshot = buildStudentBootstrap(db, second.id);

  const ownSessions = db.attendanceSessions.filter((session) =>
    (session.entries || []).some((entry) => entry.studentId === first.id)
  );
  assert.equal(firstSnapshot.attendance.length, ownSessions.length);

  const ownMarks = db.testRecords.filter((record) => record.studentId === first.id);
  assert.equal(firstSnapshot.results.length, ownMarks.length);

  assert.notEqual(firstSnapshot.student.id, secondSnapshot.student.id);
  const firstJson = JSON.stringify(firstSnapshot.results);
  const secondJson = JSON.stringify(secondSnapshot.results);
  const firstRecordIds = ownMarks.map((record) => record.id);
  assert.ok(firstRecordIds.every((id) => firstJson.includes(id)));
  assert.ok(
    firstRecordIds.every((id) => !secondJson.includes(id)),
    'a second student must not receive the first student marks'
  );
});

test('only relevant changes wake a student stream', () => {
  const { db, first, second } = linkedDb();

  assert.equal(
    studentChangeRelevant(db, first, {
      revision: 10,
      upserts: { students: [{ ...first, name: 'Updated' }] },
    }),
    true
  );
  assert.equal(
    studentChangeRelevant(db, first, {
      revision: 11,
      upserts: { students: [{ ...second }] },
    }),
    false
  );

  const otherClass = db.classes.find((cls) => cls.id !== first.classIdSection);
  assert.equal(
    studentChangeRelevant(db, first, {
      revision: 12,
      upserts: {
        attendanceSessions: [{ id: 'ATT-OTHER', classIdSection: otherClass.id }],
      },
    }),
    false
  );
  assert.equal(
    studentChangeRelevant(db, first, {
      revision: 13,
      upserts: {
        attendanceSessions: [{ id: 'ATT-OWN', classIdSection: first.classIdSection }],
      },
    }),
    true
  );
  assert.equal(
    studentChangeRelevant(db, first, { revision: 14, collections: { timetable: [] } }),
    true
  );
  assert.equal(
    studentChangeRelevant(db, first, { revision: 15, collections: { activities: [] } }),
    false
  );
});
