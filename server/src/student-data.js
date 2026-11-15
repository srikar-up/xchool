/**
 * Scoped read model for the student portal.
 *
 * Everything here is derived from one student record. No function accepts a
 * second student id, and the route always passes the id from the verified
 * token, so a caller cannot widen the result by changing a parameter.
 */
import { gradeOfClassId } from './curriculum.js';

const ATTENDANCE_WEIGHTS = { present: 1, late: 0.5, excused: 0, absent: 0 };

export function publicStudent(student) {
  if (!student) return null;
  const copy = { ...student };
  // Server-owned auth plumbing is not useful in the browser.
  delete copy.authUid;
  delete copy.authCreatedBy;
  delete copy.authCreatedAt;
  delete copy.legacyIds;
  return copy;
}

function sessionDate(session) {
  return String(session?.date || '');
}

function sortAttendance(a, b) {
  return (
    String(b.date).localeCompare(String(a.date)) ||
    String(a.sessionType || '').localeCompare(String(b.sessionType || ''))
  );
}

/**
 * Builds the complete student-facing snapshot.
 *
 * @param {object} db
 * @param {string} studentId the id from the verified token
 * @returns {object|null}
 */
export function buildStudentBootstrap(db, studentId) {
  const student = (db.students || []).find((entry) => entry.id === studentId);
  if (!student) return null;

  const classRecord = (db.classes || []).find((cls) => cls.id === student.classIdSection) || null;
  const grade = gradeOfClassId(student.classIdSection) ?? Number(classRecord?.gradeLevel) ?? null;

  const subjects = (db.subjects || [])
    .filter((subject) => subject.classIdSection === student.classIdSection)
    .map((subject) => ({
      id: subject.id,
      subjectCode: subject.subjectCode,
      subjectName: subject.subjectName,
      isLab: Boolean(subject.isLab),
      assignedTeacherName: subject.assignedTeacherName || 'Unassigned',
      chapters: (subject.chapters || []).map((chapter) => ({
        title: chapter.title,
        status: chapter.status,
      })),
      updatedAt: subject.updatedAt || null,
    }));

  const timetable = (db.timetable || [])
    .filter((period) => period.classIdSection === student.classIdSection)
    .map((period) => ({
      id: period.id,
      dayOfWeek: period.dayOfWeek,
      dayName: period.dayName,
      periodNumber: period.periodNumber,
      startTime: period.startTime,
      endTime: period.endTime,
      subject: period.subject,
      subjectCode: period.subjectCode,
      teacherName: period.teacherName,
      room: period.room,
      isLab: Boolean(period.isLab),
    }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.periodNumber - b.periodNumber);

  const exams = (db.exams || [])
    .filter((exam) => exam.classIdSection === student.classIdSection)
    .map((exam) => ({
      id: exam.id,
      title: exam.title,
      subject: exam.subject,
      category: exam.category,
      date: exam.date,
      startTime: exam.startTime,
      endTime: exam.endTime,
      maxMarks: exam.maxMarks,
      marksStatus: exam.marksStatus,
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const examById = new Map(exams.map((exam) => [exam.id, exam]));
  const results = (db.testRecords || [])
    .filter(
      (record) =>
        record.studentId === student.id && examById.has(record.examId)
    )
    .map((record) => {
      const exam = examById.get(record.examId);
      const maxMarks = Number(record.maxMarks ?? exam?.maxMarks ?? 0);
      const obtained = Number(record.marksObtained ?? 0);
      return {
        id: record.id,
        examId: record.examId,
        title: exam?.title || record.examTitle || 'Assessment',
        subject: exam?.subject || record.subject || '',
        category: exam?.category || record.category || '',
        date: exam?.date || '',
        marksObtained: obtained,
        maxMarks,
        percentage: maxMarks ? Math.round((obtained / maxMarks) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const attendance = (db.attendanceSessions || [])
    .filter((session) => session.classIdSection === student.classIdSection)
    .map((session) => {
      const entry = (session.entries || []).find((row) => row.studentId === student.id);
      if (!entry) return null;
      return {
        id: session.id,
        date: session.date,
        sessionType: session.sessionType,
        periodNumber: session.periodNumber ?? null,
        status: entry.status,
        remarks: entry.remarks || '',
        submittedAt: session.submittedAt || null,
      };
    })
    .filter(Boolean)
    .sort(sortAttendance);

  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  attendance.forEach((entry) => {
    if (counts[entry.status] !== undefined) counts[entry.status] += 1;
  });
  const total = counts.present + counts.absent + counts.late + counts.excused;
  const weighted = Object.entries(counts).reduce(
    (sum, [status, value]) => sum + value * ATTENDANCE_WEIGHTS[status],
    0
  );
  const attendanceSummary = {
    ...counts,
    total,
    rate: total ? Math.round((weighted / total) * 1000) / 10 : null,
  };

  const announcements = (db.announcements || [])
    .filter((notice) => notice.audience !== 'TeachersOnly')
    .map((notice) => ({
      id: notice.id,
      title: notice.title,
      body: notice.body,
      importance: notice.importance,
      audience: notice.audience,
      isPinned: Boolean(notice.isPinned),
      publisherName: notice.publisherName,
      createdAt: notice.createdAt,
    }))
    .sort(
      (a, b) =>
        Number(b.isPinned) - Number(a.isPinned) ||
        String(b.createdAt).localeCompare(String(a.createdAt))
    );

  const curricula =
    grade === null
      ? []
      : (db.curricula || [])
          .filter((entry) => Number(entry.gradeLevel) === Number(grade))
          .map((entry) => ({
            id: entry.id,
            gradeLevel: entry.gradeLevel,
            subjectName: entry.subjectName,
            chapters: (entry.chapters || []).map((chapter) => ({
              title: chapter.title,
              status: chapter.status,
            })),
          }));

  const incharge = (db.classIncharges || []).find(
    (entry) => entry.classIdSection === student.classIdSection
  );
  const inchargeStaff = incharge
    ? (db.staff || []).find((member) => member.id === incharge.activeStaffId)
    : null;

  const meta = db.meta || {};

  return {
    revision: Number(meta.revision || 0),
    updatedAt: meta.updatedAt || null,
    now: new Date().toISOString(),
    meta: {
      schoolName: meta.schoolName || '',
      shortName: meta.shortName || meta.schoolName || '',
      tagline: meta.tagline || '',
      academicYear: meta.academicYear || '',
      attendanceMode: meta.attendanceMode || 'twoSessions',
      address: meta.address || '',
      phone: meta.phone || '',
      email: meta.email || '',
      principalName: meta.principalName || '',
      today: meta.today || '',
      todayName: meta.todayName || '',
      timetableDays: Array.isArray(meta.timetableDays) ? meta.timetableDays : [1, 2, 3, 4, 5],
      timetablePeriods: Array.isArray(meta.timetablePeriods) ? meta.timetablePeriods : [],
    },
    student: publicStudent(student),
    class: classRecord
      ? {
          id: classRecord.id,
          displayName: classRecord.displayName,
          gradeLevel: classRecord.gradeLevel,
          section: classRecord.section,
          room: classRecord.room,
        }
      : null,
    classIncharge: inchargeStaff
      ? { name: inchargeStaff.name, email: inchargeStaff.email }
      : null,
    subjects,
    curricula,
    timetable,
    exams,
    results,
    attendance,
    attendanceSummary,
    announcements,
  };
}

/**
 * True when a staff change event can affect this student's snapshot.
 *
 * Record collections are filtered by class or student id so an unrelated
 * register submission does not wake every student device.
 */
export function studentChangeRelevant(db, student, event) {
  if (!student) return false;
  if (event?.full) return true;

  const changed = new Set([
    ...(event?.collections ? Object.keys(event.collections) : []),
    ...(event?.upserts ? Object.keys(event.upserts) : []),
    ...(event?.deletes ? Object.keys(event.deletes) : []),
  ]);
  if (!changed.size) return true;

  const classCollections = new Set([
    'classes',
    'subjects',
    'curricula',
    'timetable',
    'exams',
    'announcements',
    'classIncharges',
    'meta',
  ]);
  if ([...changed].some((key) => classCollections.has(key))) return true;

  if (changed.has('students')) {
    const rows = event.upserts?.students || [];
    if (rows.some((row) => row.id === student.id)) return true;
    const deleted = event.deletes?.students || [];
    if (deleted.includes(student.id)) return true;
  }

  const attendanceRows = event.upserts?.attendanceSessions || [];
  if (attendanceRows.some((row) => row.classIdSection === student.classIdSection)) return true;
  if ((event.deletes?.attendanceSessions || []).length) return true;

  const recordRows = event.upserts?.testRecords || [];
  if (
    recordRows.some(
      (row) => row.studentId === student.id || row.classIdSection === student.classIdSection
    )
  ) {
    return true;
  }
  if ((event.deletes?.testRecords || []).length) return true;

  return false;
}
