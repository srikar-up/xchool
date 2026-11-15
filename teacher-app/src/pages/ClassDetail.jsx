import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BookOpen,
  ChevronRight,
  GraduationCap,
  MapPin,
  Pencil,
  Phone,
  Search,
  Send,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  Users,
} from 'lucide-react';
import { useAppData } from '../context/AppDataContext';
import { api } from '../lib/api';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import EmptyState from '../components/EmptyState';
import PageHead from '../components/PageHead';
import ProgressRing from '../components/ProgressRing';
import Sheet from '../components/Sheet';
import {
  attendanceStats,
  compareRoll,
  findSession,
  formatDate,
  getTeacherClasses,
  isStudentAtRisk,
  studentAttendance,
  studentAverage,
  studentScores,
  todayISO,
} from '../lib/format';

const REQUEST_FIELDS = [
  { value: 'name', label: 'Full name' },
  { value: 'classIdSection', label: 'Class & section' },
  { value: 'rollNumber', label: 'Roll number' },
  { value: 'status', label: 'Enrolment status' },
  { value: 'guardianName', label: 'Guardian name' },
  { value: 'parentPhone', label: 'Guardian phone' },
  { value: 'dateOfBirth', label: 'Date of birth' },
  { value: 'address', label: 'Home address' },
  { value: 'authEmail', label: 'Portal email' },
  { value: 'authDisabled', label: 'Portal access' },
];

export default function ClassDetail() {
  const { classId } = useParams();
  const { data, user, notify, refresh } = useAppData();
  const classes = getTeacherClasses(data, user.id);
  const cls = classes.find((entry) => entry.id === classId);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    guardianName: '',
    parentPhone: '',
    gender: 'Not specified',
    dateOfBirth: '',
    address: '',
  });
  const [saving, setSaving] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestForm, setRequestForm] = useState({ field: 'name', value: '', note: '' });
  const [requestBusy, setRequestBusy] = useState(false);

  if (!cls) {
    return (
      <div className="t-page">
        <PageHead backTo="/classes" title="Class not available" />
        <EmptyState
          icon={GraduationCap}
          title="This class is not assigned to you"
          message="Only classes on your timetable or subject list can be opened here."
        />
      </div>
    );
  }

  const roster = data.students
    .filter((student) => student.classIdSection === cls.id)
    .sort((a, b) => compareRoll(a.rollNumber, b.rollNumber));
  const session = findSession(data, cls.id, todayISO(), 'Morning');
  const stats = session ? attendanceStats(session.entries) : null;
  const visible = roster.filter(
    (student) =>
      !search.trim() ||
      student.name.toLowerCase().includes(search.toLowerCase()) ||
      student.rollNumber.includes(search.trim())
  );
  const selectedStudent = selected
    ? data.students.find((student) => student.id === selected)
    : null;
  const selectedAttendance = selectedStudent
    ? studentAttendance(data, selectedStudent.id)
    : null;
  const selectedScores = selectedStudent ? studentScores(data, selectedStudent.id) : [];
  const selectedAverage = selectedStudent ? studentAverage(data, selectedStudent.id) : null;

  const openStudent = (studentId) => {
    setSelected(studentId);
    setEditing(false);
    setRequestOpen(false);
  };

  const startEdit = () => {
    if (!selectedStudent) return;
    setEditForm({
      guardianName: selectedStudent.guardianName || '',
      parentPhone: selectedStudent.parentPhone || '',
      gender: selectedStudent.gender || 'Not specified',
      dateOfBirth: selectedStudent.dateOfBirth || '',
      address: selectedStudent.address || '',
    });
    setEditing(true);
    setRequestOpen(false);
  };

  const saveDetails = async (event) => {
    event.preventDefault();
    if (!selectedStudent) return;
    setSaving(true);
    try {
      await api.updateStudent(user.id, selectedStudent.id, {
        guardianName: editForm.guardianName.trim(),
        parentPhone: editForm.parentPhone.trim(),
        gender: editForm.gender,
        dateOfBirth: editForm.dateOfBirth,
        address: editForm.address.trim(),
      });
      await refresh({ silent: true });
      setEditing(false);
      notify(`${selectedStudent.name}'s contact details updated.`, 'success');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const openRequest = () => {
    if (!selectedStudent) return;
    setRequestForm({ field: 'name', value: '', note: '' });
    setRequestOpen(true);
    setEditing(false);
  };

  const changeRequestField = (field) => {
    if (!selectedStudent) return;
    const next =
      field === 'classIdSection'
        ? selectedStudent.classIdSection
        : field === 'status'
          ? selectedStudent.status || 'Active'
          : field === 'authDisabled'
            ? String(Boolean(selectedStudent.authDisabled))
            : field === 'authEmail'
              ? selectedStudent.authEmail || ''
              : String(selectedStudent[field] ?? '');
    setRequestForm((current) => ({ ...current, field, value: next }));
  };

  const submitRequest = async (event) => {
    event.preventDefault();
    if (!selectedStudent) return;
    setRequestBusy(true);
    try {
      const fieldMeta = REQUEST_FIELDS.find((entry) => entry.value === requestForm.field);
      const value =
        requestForm.field === 'authDisabled'
          ? requestForm.value === 'true'
          : requestForm.value.trim();
      await api.createRequest(user.id, {
        category: 'student',
        subject: `Student record change · ${selectedStudent.name}`,
        body: requestForm.note.trim(),
        studentId: selectedStudent.id,
        changes: { [requestForm.field]: value },
        priority: 'High',
      });
      await refresh({ silent: true });
      setRequestOpen(false);
      notify(
        `Request sent to the office: ${fieldMeta?.label || 'student record change'}.`,
        'success'
      );
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setRequestBusy(false);
    }
  };

  return (
    <div className="t-page">
      <PageHead
        backTo="/classes"
        eyebrow="Class roster"
        title={cls.displayName}
        subtitle={`${cls.room} · ${cls.academicYear}`}
        action={
          cls.isIncharge ? (
            <Badge tone="brand" icon={ShieldCheck}>
              Incharge
            </Badge>
          ) : null
        }
      />

      <section className="class-detail-hero">
        <div className="class-detail-hero-top">
          <span className="class-detail-icon">
            <GraduationCap size={28} />
          </span>
          <div>
            <h2>{cls.displayName}</h2>
            <p>
              <MapPin size={13} /> {cls.room}
            </p>
          </div>
        </div>
        <div className="class-detail-stats">
          <div>
            <strong>{roster.length}</strong>
            <span>Students</span>
          </div>
          <div>
            <strong>{stats ? `${stats.rate}%` : '—'}</strong>
            <span>Today</span>
          </div>
          <div>
            <strong>{cls.mySubjects.length}</strong>
            <span>My subjects</span>
          </div>
        </div>
        <div className="class-detail-subjects">
          {cls.mySubjects.map((subject) => (
            <span key={subject.id}>
              <BookOpen size={12} /> {subject.subjectName}
            </span>
          ))}
        </div>
      </section>

      <div className="search-input">
        <Search size={17} />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search roster"
          aria-label="Search students"
        />
      </div>

      <div className="student-directory">
        {visible.map((student) => {
          const history = studentAttendance(data, student.id);
          const average = studentAverage(data, student.id);
          const atRisk = isStudentAtRisk(data, student.id);
          return (
            <button
              type="button"
              className="directory-row"
              key={student.id}
              onClick={() => openStudent(student.id)}
            >
              <Avatar name={student.name} size={40} photo={student.photo} />
              <span className="directory-name">
                <strong>{student.name}</strong>
                <small>
                  Roll {student.rollNumber} · {history.rate}% attendance
                  {average !== null ? ` · ${Math.round(average)}% average` : ''}
                </small>
              </span>
              {atRisk ? (
                <Badge tone="danger" icon={TriangleAlert}>
                  Risk
                </Badge>
              ) : (
                <ChevronRight size={17} className="directory-chevron" />
              )}
            </button>
          );
        })}
        {!visible.length ? (
          <EmptyState icon={Users} title="No students found" message="Try a different search." />
        ) : null}
      </div>

      <Sheet
        open={Boolean(selectedStudent)}
        title={selectedStudent?.name}
        subtitle={`${cls.displayName} · Roll ${selectedStudent?.rollNumber}`}
        onClose={() => setSelected(null)}
        footer={
          selectedStudent ? (
            editing ? (
              <div className="sheet-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="student-details-form"
                  className="btn btn-primary"
                  disabled={saving}
                >
                  {saving ? <span className="btn-spinner" /> : <Pencil size={16} />}
                  {saving ? 'Saving…' : 'Save details'}
                </button>
              </div>
            ) : requestOpen ? (
              <div className="sheet-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setRequestOpen(false)}
                  disabled={requestBusy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="student-request-form"
                  className="btn btn-primary"
                  disabled={requestBusy}
                >
                  {requestBusy ? <span className="btn-spinner" /> : <Send size={16} />}
                  {requestBusy ? 'Sending…' : 'Send to office'}
                </button>
              </div>
            ) : (
              <div className="sheet-actions">
                <a className="btn btn-secondary" href={`tel:${selectedStudent.parentPhone}`}>
                  <Phone size={16} /> Call guardian
                </a>
                <Link
                  to={`/reports?student=${selectedStudent.id}`}
                  className="btn btn-primary"
                  onClick={() => setSelected(null)}
                >
                  <UserRound size={16} /> Progress report
                </Link>
              </div>
            )
          ) : null
        }
      >
        {selectedStudent ? (
          <div className="student-sheet">
            <div className="student-sheet-top">
              <ProgressRing
                value={selectedAttendance.rate}
                size={104}
                stroke={10}
                color={
                  selectedAttendance.rate >= 75 ? 'var(--success)' : 'var(--warning)'
                }
                track="var(--slate-100)"
              >
                <strong>{selectedAttendance.rate}%</strong>
                <span>attendance</span>
              </ProgressRing>
              <div className="student-sheet-stats">
                <div>
                  <span>Present</span>
                  <strong>{selectedAttendance.present}</strong>
                </div>
                <div>
                  <span>Absent</span>
                  <strong>{selectedAttendance.absent}</strong>
                </div>
                <div>
                  <span>Late</span>
                  <strong>{selectedAttendance.late}</strong>
                </div>
                <div>
                  <span>Average</span>
                  <strong>{selectedAverage !== null ? `${Math.round(selectedAverage)}%` : '—'}</strong>
                </div>
              </div>
            </div>

            {editing ? (
              <form id="student-details-form" className="form-stack" onSubmit={saveDetails}>
                <div className="form-row">
                  <label className="field">
                    <span>Guardian name</span>
                    <input
                      type="text"
                      value={editForm.guardianName}
                      onChange={(event) =>
                        setEditForm((current) => ({ ...current, guardianName: event.target.value }))
                      }
                      placeholder="Parent or guardian"
                    />
                  </label>
                  <label className="field">
                    <span>Guardian phone</span>
                    <input
                      type="tel"
                      value={editForm.parentPhone}
                      onChange={(event) =>
                        setEditForm((current) => ({ ...current, parentPhone: event.target.value }))
                      }
                      placeholder="+91 90000 12345"
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label className="field">
                    <span>Date of birth</span>
                    <input
                      type="date"
                      value={editForm.dateOfBirth}
                      onChange={(event) =>
                        setEditForm((current) => ({ ...current, dateOfBirth: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Gender</span>
                    <select
                      value={editForm.gender}
                      onChange={(event) =>
                        setEditForm((current) => ({ ...current, gender: event.target.value }))
                      }
                    >
                      <option>Female</option>
                      <option>Male</option>
                      <option>Not specified</option>
                    </select>
                  </label>
                </div>
                <label className="field">
                  <span>Home address</span>
                  <textarea
                    rows={2}
                    value={editForm.address}
                    onChange={(event) =>
                      setEditForm((current) => ({ ...current, address: event.target.value }))
                    }
                    placeholder="House, street, area"
                  />
                </label>
                <p className="muted small">
                  These details save straight to the school database. Name, class, roll number and
                  portal access are administrative — send an office request for those.
                </p>
              </form>
            ) : requestOpen ? (
              <form id="student-request-form" className="form-stack" onSubmit={submitRequest}>
                <label className="field">
                  <span>Detail to change</span>
                  <select
                    value={requestForm.field}
                    onChange={(event) => changeRequestField(event.target.value)}
                  >
                    {REQUEST_FIELDS.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>New value</span>
                  {requestForm.field === 'classIdSection' ? (
                    <select
                      value={requestForm.value}
                      onChange={(event) =>
                        setRequestForm((current) => ({ ...current, value: event.target.value }))
                      }
                      required
                    >
                      <option value="">Select class</option>
                      {data.classes.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.displayName}
                        </option>
                      ))}
                    </select>
                  ) : requestForm.field === 'status' ? (
                    <select
                      value={requestForm.value}
                      onChange={(event) =>
                        setRequestForm((current) => ({ ...current, value: event.target.value }))
                      }
                    >
                      <option>Active</option>
                      <option>Inactive</option>
                      <option>Graduated</option>
                    </select>
                  ) : requestForm.field === 'authDisabled' ? (
                    <select
                      value={requestForm.value}
                      onChange={(event) =>
                        setRequestForm((current) => ({ ...current, value: event.target.value }))
                      }
                    >
                      <option value="false">Portal access enabled</option>
                      <option value="true">Portal access disabled</option>
                    </select>
                  ) : requestForm.field === 'address' ? (
                    <textarea
                      rows={2}
                      value={requestForm.value}
                      onChange={(event) =>
                        setRequestForm((current) => ({ ...current, value: event.target.value }))
                      }
                      placeholder="Corrected address"
                      required
                    />
                  ) : (
                    <input
                      type={
                        requestForm.field === 'dateOfBirth'
                          ? 'date'
                          : requestForm.field === 'authEmail'
                            ? 'email'
                            : 'text'
                      }
                      value={requestForm.value}
                      onChange={(event) =>
                        setRequestForm((current) => ({ ...current, value: event.target.value }))
                      }
                      placeholder="Correct value"
                      required
                    />
                  )}
                </label>

                <label className="field">
                  <span>Reason for the office</span>
                  <textarea
                    rows={3}
                    value={requestForm.note}
                    onChange={(event) =>
                      setRequestForm((current) => ({ ...current, note: event.target.value }))
                    }
                    placeholder="Why does this need to change? Add any document reference."
                    required
                  />
                </label>

                <p className="muted small">
                  The school office reviews this request. It can apply the change in one tap, and
                  you will see the status in Requests.
                </p>
              </form>
            ) : (
              <>
                <div className="detail-list">
                  <div>
                    <span>Guardian</span>
                    <strong>{selectedStudent.guardianName || 'Not recorded'}</strong>
                  </div>
                  <div>
                    <span>Guardian phone</span>
                    <strong>{selectedStudent.parentPhone || 'Not recorded'}</strong>
                  </div>
                  <div>
                    <span>Date of birth</span>
                    <strong>{formatDate(selectedStudent.dateOfBirth)}</strong>
                  </div>
                  <div>
                    <span>Address</span>
                    <strong>{selectedStudent.address || 'Not recorded'}</strong>
                  </div>
                </div>

                <div className="student-sheet-actions">
                  {cls.isIncharge && data.meta.teacherStudentEditEnabled !== false ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={startEdit}>
                      <Pencil size={15} /> Edit contact details
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={openRequest}>
                    <Send size={15} /> Ask office to change
                  </button>
                </div>

                <p className="muted small">
                  {cls.isIncharge && data.meta.teacherStudentEditEnabled !== false
                    ? 'Guardian and contact details save directly to the school database. Name, class, roll number and portal access need an office request.'
                    : data.meta.teacherStudentEditEnabled === false
                      ? 'The school has switched off direct student editing. Send an office request for any change.'
                      : 'Contact details are maintained by the class teacher. Use an office request for every other change.'}
                </p>
              </>
            )}

            <div className="sheet-section">
              <div className="section-head">
                <h3>Recent assessments</h3>
                {isStudentAtRisk(data, selectedStudent.id) ? (
                  <Badge tone="danger">Needs support</Badge>
                ) : (
                  <Badge tone="success">On track</Badge>
                )}
              </div>
              {selectedScores.length ? (
                <div className="score-list">
                  {selectedScores.slice(0, 5).map((score) => (
                    <div key={score.id} className="score-row">
                      <span>
                        <strong>{score.examTitle || score.subject}</strong>
                        <small>
                          {score.subject} · {formatDate(score.enteredAt.slice(0, 10))}
                        </small>
                      </span>
                      <span className={`score-value ${score.percentage < 35 ? 'low' : ''}`}>
                        {score.marksObtained}/{score.maxMarks}
                        <small>{Math.round(score.percentage)}%</small>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted small">No assessment scores recorded yet.</p>
              )}
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
