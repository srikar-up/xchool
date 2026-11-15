import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileUp,
  KeyRound,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  TriangleAlert,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAppData } from '../context/AppDataContext';
import { api } from '../lib/api';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import Drawer from '../components/Drawer';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import PageHeader from '../components/PageHeader';
import ProgressRing from '../components/ProgressRing';
import {
  classLabel,
  compareRoll,
  downloadCsv,
  formatDate,
  gradeLetter,
  isStudentAtRisk,
  parseCsv,
  studentAttendance,
  studentAverage,
  studentScores,
  todayISO,
} from '../lib/format';

const PAGE_SIZE = 8;

function emptyForm(data) {
  return {
    name: '',
    classIdSection: data.classes[0]?.id || '',
    rollNumber: '',
    guardianName: '',
    parentPhone: '',
    gender: 'Not specified',
    dateOfBirth: '',
    address: '',
    status: 'Active',
    authEmail: '',
    authUid: '',
    authDisabled: false,
  };
}

export default function Students() {
  const { data, user, notify, refresh } = useAppData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [riskOnly, setRiskOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(() => emptyForm(data));
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [loginTarget, setLoginTarget] = useState(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginResult, setLoginResult] = useState(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const fileInputRef = useRef(null);

  const studentParam = searchParams.get('student');
  const selectedStudent = studentParam
    ? data.students.find((student) => student.id === studentParam)
    : null;

  const filtered = useMemo(
    () =>
      data.students
        .filter((student) => {
          const text = search.trim().toLowerCase();
          const matchesSearch =
            !text ||
            student.name.toLowerCase().includes(text) ||
            student.code.toLowerCase().includes(text) ||
            (student.legacyIds || []).some((id) =>
              String(id).toLowerCase().includes(text)
            ) ||
            student.rollNumber.includes(text) ||
            (student.parentPhone || '').includes(text);
          const matchesClass =
            classFilter === 'all' || student.classIdSection === classFilter;
          const matchesRisk = !riskOnly || isStudentAtRisk(data, student.id);
          return matchesSearch && matchesClass && matchesRisk;
        })
        .sort((a, b) =>
          String(a.classIdSection).localeCompare(String(b.classIdSection)) ||
          compareRoll(a.rollNumber, b.rollNumber)
        ),
    [data, search, classFilter, riskOnly]
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, classFilter, riskOnly]);

  useEffect(() => {
    if (searchParams.get('add') === '1') {
      openAdd();
      const next = new URLSearchParams(searchParams);
      next.delete('add');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm(data));
    setFormOpen(true);
  };

  const openEdit = (student) => {
    setEditing(student);
    setForm({
      name: student.name,
      classIdSection: student.classIdSection,
      rollNumber: student.rollNumber,
      guardianName: student.guardianName || '',
      parentPhone: student.parentPhone || '',
      gender: student.gender || 'Not specified',
      dateOfBirth: student.dateOfBirth || '',
      address: student.address || '',
      status: student.status || 'Active',
      authEmail: student.authEmail || '',
      authUid: student.authUid || '',
      authDisabled: Boolean(student.authDisabled),
    });
    setFormOpen(true);
  };

  const setField = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (editing) {
        await api.updateStudent(user.id, editing.id, form);
        notify(`${form.name}’s record updated.`, 'success');
      } else {
        await api.createStudent(user.id, form);
        notify(`${form.name} added to ${form.classIdSection}.`, 'success');
      }
      await refresh({ silent: true });
      closeForm();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.deleteStudent(user.id, deleteTarget.id);
      await refresh({ silent: true });
      notify(`${deleteTarget.name} removed from the roster.`, 'success');
      setDeleteTarget(null);
      if (studentParam === deleteTarget.id) {
        const next = new URLSearchParams(searchParams);
        next.delete('student');
        setSearchParams(next, { replace: true });
      }
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openLogin = (student) => {
    setLoginTarget(student);
    setLoginEmail(student.authEmail || '');
    setLoginPassword('');
    setLoginResult(null);
  };

  const closeLogin = () => {
    setLoginTarget(null);
    setLoginResult(null);
    setLoginPassword('');
  };

  const createLogin = async (event) => {
    event.preventDefault();
    if (!loginTarget) return;
    setLoginBusy(true);
    try {
      const result = await api.createStudentLogin(user.id, loginTarget.id, {
        email: loginEmail.trim(),
        password: loginPassword.trim() || undefined,
      });
      setLoginResult(result.login);
      await refresh({ silent: true });
      notify(`Portal login created for ${loginTarget.name}.`, 'success');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setLoginBusy(false);
    }
  };

  const setPortalAccess = async (student, enabled) => {
    setBusy(true);
    try {
      await api.updateStudent(user.id, student.id, { authDisabled: !enabled });
      await refresh({ silent: true });
      notify(
        enabled ? `Portal access enabled for ${student.name}.` : `Portal access disabled for ${student.name}.`,
        'success'
      );
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const closeStudent = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('student');
    setSearchParams(next, { replace: true });
  };

  const exportCsv = () => {
    const rows = filtered.map((student) => [
      student.code,
      student.rollNumber,
      student.name,
      student.classIdSection,
      student.admissionDate || '',
      student.guardianName || '',
      student.parentPhone || '',
      studentAttendance(data, student.id).rate,
      studentAverage(data, student.id) ?? '',
      isStudentAtRisk(data, student.id) ? 'At risk' : 'On track',
    ]);
    downloadCsv(
      'xchool-students.csv',
      [
        'student_id',
        'roll_number',
        'name',
        'class_id_section',
        'admission_date',
        'guardian_name',
        'parent_phone',
        'attendance_rate',
        'assessment_average',
        'status',
      ],
      rows
    );
    notify(`Exported ${rows.length} student records.`, 'success');
  };

  const importCsv = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) throw new Error('The CSV file has no data rows.');
      const result = await api.bulkStudents(user.id, rows);
      await refresh({ silent: true });
      setImportResult({ ...result, fileName: file.name });
      notify(`${result.inserted} students added, ${result.updated} updated.`, 'success');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-page">
      <PageHeader
        eyebrow="Student directory"
        title="Students"
        subtitle={`${data.students.length} enrolled students across ${data.classes.length} sections.`}
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden-input"
              onChange={importCsv}
            />
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              <Upload size={16} /> Import CSV
            </button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={exportCsv}>
              <Download size={16} /> Export
            </button>
            <button type="button" className="admin-btn admin-btn-primary" onClick={openAdd}>
              <UserPlus size={16} /> Add student
            </button>
          </>
        }
      />

      <section className="admin-card table-card">
        <div className="table-toolbar">
          <div className="admin-search">
            <Search size={17} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, student ID, roll or phone"
            />
          </div>
          <div className="table-toolbar-filters">
            <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
              <option value="all">All classes</option>
              {data.classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.displayName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`admin-filter-toggle ${riskOnly ? 'active' : ''}`}
              onClick={() => setRiskOnly((current) => !current)}
            >
              <TriangleAlert size={14} /> At risk only
            </button>
            <span className="table-result-count">{filtered.length} records</span>
          </div>
        </div>

        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Class</th>
                <th>Roll</th>
                <th>Guardian</th>
                <th>Attendance</th>
                <th>Average</th>
                <th>Status</th>
                <th className="align-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((student) => {
                const attendance = studentAttendance(data, student.id);
                const average = studentAverage(data, student.id);
                const atRisk = isStudentAtRisk(data, student.id);
                return (
                  <tr key={student.id}>
                    <td>
                      <button
                        type="button"
                        className="table-person"
                        onClick={() => setSearchParams({ student: student.id })}
                      >
                        <Avatar name={student.name} size={34} photo={student.photo} />
                        <span>
                          <strong>{student.name}</strong>
                          <small>{student.code}</small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <span className="table-class-badge">{student.classIdSection}</span>
                    </td>
                    <td>{student.rollNumber}</td>
                    <td>
                      <span className="table-stack">
                        <strong>{student.guardianName || '—'}</strong>
                        <small>{student.parentPhone || 'No phone'}</small>
                      </span>
                    </td>
                    <td>
                      <span className="table-progress-cell">
                        <span className="table-progress">
                          <i style={{ width: `${attendance.rate}%` }} />
                        </span>
                        <strong>{attendance.rate}%</strong>
                      </span>
                    </td>
                    <td>
                      <strong>{average !== null ? `${Math.round(average)}%` : '—'}</strong>
                    </td>
                    <td>
                      {atRisk ? (
                        <Badge tone="danger" icon={TriangleAlert}>
                          At risk
                        </Badge>
                      ) : (
                        <Badge tone="success">On track</Badge>
                      )}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="table-action"
                          onClick={() => setSearchParams({ student: student.id })}
                          aria-label={`View ${student.name}`}
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          type="button"
                          className="table-action"
                          onClick={() => openEdit(student)}
                          aria-label={`Edit ${student.name}`}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          className="table-action danger"
                          onClick={() => setDeleteTarget(student)}
                          aria-label={`Delete ${student.name}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!paged.length ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon={Users}
                      title="No students match these filters"
                      message="Clear the search or choose another class to see the roster."
                      compact
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="table-pagination">
          <span>
            Showing {filtered.length ? (safePage - 1) * PAGE_SIZE + 1 : 0}–
            {Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div>
            <button
              type="button"
              className="admin-icon-btn"
              disabled={safePage <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft size={17} />
            </button>
            <span className="table-page-number">
              {safePage} / {totalPages}
            </span>
            <button
              type="button"
              className="admin-icon-btn"
              disabled={safePage >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              aria-label="Next page"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </section>

      <Drawer
        open={Boolean(selectedStudent)}
        title={selectedStudent?.name}
        subtitle={
          selectedStudent
            ? `${classLabel(data, selectedStudent.classIdSection)} · ${selectedStudent.code}`
            : ''
        }
        onClose={closeStudent}
        width={520}
        footer={
          selectedStudent ? (
            <div className="drawer-footer-actions">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => {
                  closeStudent();
                  openEdit(selectedStudent);
                }}
              >
                <Pencil size={15} /> Edit record
              </button>
              <button type="button" className="admin-btn admin-btn-primary" onClick={() => setDeleteTarget(selectedStudent)}>
                <Trash2 size={15} /> Remove student
              </button>
            </div>
          ) : null
        }
      >
        {selectedStudent ? (
          <StudentDetail
            data={data}
            student={selectedStudent}
            busy={busy}
            onEdit={() => openEdit(selectedStudent)}
            onCreateLogin={() => openLogin(selectedStudent)}
            onToggleLogin={(enabled) => setPortalAccess(selectedStudent, enabled)}
          />
        ) : null}
      </Drawer>

      <Modal
        open={formOpen}
        title={editing ? 'Edit student record' : 'Add a new student'}
        subtitle={
          editing
            ? 'Changes are shared immediately with the teacher and student workspaces.'
            : 'The school ID is generated from the admission year and roll number.'
        }
        icon={editing ? Pencil : UserPlus}
        onClose={closeForm}
        size="lg"
        footer={
          <div className="modal-actions">
            <button type="button" className="admin-btn admin-btn-ghost" onClick={closeForm}>
              Cancel
            </button>
            <button type="submit" form="student-form" className="admin-btn admin-btn-primary" disabled={busy}>
              {busy ? <span className="admin-spinner" /> : null}
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add student'}
            </button>
          </div>
        }
      >
        <form id="student-form" className="admin-form-grid" onSubmit={submit}>
          <label className="admin-field admin-span-2">
            <span>Full name</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => setField('name', event.target.value)}
              placeholder="e.g. Ayesha Khan"
              required
            />
          </label>
          <label className="admin-field">
            <span>Class</span>
            <select
              value={form.classIdSection}
              onChange={(event) => setField('classIdSection', event.target.value)}
              required
            >
              {data.classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Roll number</span>
            <input
              type="text"
              value={form.rollNumber}
              onChange={(event) => setField('rollNumber', event.target.value)}
              placeholder="Auto if blank"
            />
          </label>
          <label className="admin-field">
            <span>Guardian name</span>
            <input
              type="text"
              value={form.guardianName}
              onChange={(event) => setField('guardianName', event.target.value)}
              placeholder="Parent or guardian"
            />
          </label>
          <label className="admin-field">
            <span>Guardian phone</span>
            <input
              type="tel"
              value={form.parentPhone}
              onChange={(event) => setField('parentPhone', event.target.value)}
              placeholder="+91 90000 12345"
            />
          </label>
          <label className="admin-field">
            <span>Date of birth</span>
            <input
              type="date"
              value={form.dateOfBirth}
              onChange={(event) => setField('dateOfBirth', event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Status</span>
            <select value={form.status} onChange={(event) => setField('status', event.target.value)}>
              <option>Active</option>
              <option>Inactive</option>
              <option>Graduated</option>
            </select>
          </label>
          <label className="admin-field">
            <span>Portal email</span>
            <input
              type="email"
              value={form.authEmail}
              onChange={(event) => setField('authEmail', event.target.value)}
              placeholder="student@school.edu"
            />
          </label>
          <label className="admin-field">
            <span>Firebase UID</span>
            <input
              type="text"
              value={form.authUid}
              onChange={(event) => setField('authUid', event.target.value)}
              placeholder="Optional - link an existing account"
            />
          </label>
          <label className="admin-field">
            <span>Portal access</span>
            <select
              value={form.authDisabled ? 'disabled' : 'enabled'}
              onChange={(event) => setField('authDisabled', event.target.value === 'disabled')}
            >
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label className="admin-field admin-span-2">
            <span>Home address</span>
            <input
              type="text"
              value={form.address}
              onChange={(event) => setField('address', event.target.value)}
              placeholder="House, street, area"
            />
          </label>
        </form>
      </Modal>

      <Modal
        open={Boolean(loginTarget)}
        title={loginResult ? 'Student login created' : 'Create student login'}
        subtitle={loginTarget ? `${loginTarget.name} · ${loginTarget.code}` : ''}
        icon={KeyRound}
        onClose={closeLogin}
        size="sm"
        footer={
          loginResult ? (
            <div className="modal-actions">
              <button type="button" className="admin-btn admin-btn-primary" onClick={closeLogin}>
                Done
              </button>
            </div>
          ) : (
            <div className="modal-actions">
              <button type="button" className="admin-btn admin-btn-ghost" onClick={closeLogin}>
                Cancel
              </button>
              <button
                type="submit"
                form="student-login-form"
                className="admin-btn admin-btn-primary"
                disabled={loginBusy || !loginEmail.trim()}
              >
                {loginBusy ? <span className="admin-spinner" /> : <KeyRound size={15} />}
                {loginBusy ? 'Creating…' : 'Create login'}
              </button>
            </div>
          )
        }
      >
        {loginResult ? (
          <div className="student-login-result">
            <p>
              Share these credentials with the student. The password is shown once and is not
              stored in the school database.
            </p>
            <div>
              <span>Email</span>
              <code>{loginResult.email}</code>
            </div>
            {loginResult.password ? (
              <div>
                <span>Password</span>
                <code>{loginResult.password}</code>
              </div>
            ) : null}
            <div>
              <span>Firebase UID</span>
              <code>{loginResult.uid}</code>
            </div>
            {loginResult.linkedExisting ? (
              <p className="muted small">
                An existing Firebase account was linked and its password reset.
              </p>
            ) : null}
          </div>
        ) : (
          <form id="student-login-form" className="admin-form-grid" onSubmit={createLogin}>
            <label className="admin-field admin-span-2">
              <span>Portal email</span>
              <input
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                placeholder="student@school.edu"
                required
                autoFocus
              />
            </label>
            <label className="admin-field admin-span-2">
              <span>Password (optional)</span>
              <input
                type="text"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="Leave blank to generate one"
                minLength={6}
              />
            </label>
            <p className="muted small admin-span-2">
              If this email already has a Firebase account, it will be linked and its password
              reset. Leave the password blank to generate a one-time password.
            </p>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        title="Remove this student?"
        subtitle="This action cannot be undone in the prototype."
        icon={Trash2}
        onClose={() => setDeleteTarget(null)}
        size="sm"
        footer={
          <div className="modal-actions">
            <button type="button" className="admin-btn admin-btn-ghost" onClick={() => setDeleteTarget(null)}>
              Keep student
            </button>
            <button type="button" className="admin-btn admin-btn-danger" onClick={remove} disabled={busy}>
              {busy ? <span className="admin-spinner" /> : <Trash2 size={15} />}
              {busy ? 'Removing…' : 'Remove permanently'}
            </button>
          </div>
        }
      >
        {deleteTarget ? (
          <div className="delete-summary">
            <Avatar name={deleteTarget.name} size={46} photo={deleteTarget.photo} />
            <div>
              <strong>{deleteTarget.name}</strong>
              <span>
                {classLabel(data, deleteTarget.classIdSection)} · Roll {deleteTarget.rollNumber}
              </span>
              <p>Their attendance entries and assessment records will also be removed.</p>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(importResult)}
        title="CSV import complete"
        subtitle={importResult?.fileName}
        icon={FileUp}
        onClose={() => setImportResult(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="admin-btn admin-btn-primary" onClick={() => setImportResult(null)}>
              Done
            </button>
          </div>
        }
      >
        {importResult ? (
          <div className="import-result">
            <div className="import-stats">
              <div>
                <span>Added</span>
                <strong>{importResult.inserted}</strong>
              </div>
              <div>
                <span>Updated</span>
                <strong>{importResult.updated}</strong>
              </div>
              <div>
                <span>Errors</span>
                <strong>{importResult.errors.length}</strong>
              </div>
            </div>
            {importResult.errors.length ? (
              <div className="import-errors">
                <strong>Rows that need attention</strong>
                {importResult.errors.slice(0, 8).map((error) => (
                  <div key={`${error.row}-${error.message}`}>
                    <span>Row {error.row}</span>
                    <p>{error.message}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted small">All rows were imported without errors.</p>
            )}
            <p className="import-hint">
              Accepted headers: student_id, roll_number, name, class_id_section, admission_date,
              guardian_name, parent_phone. Student IDs are six digits, for example 260001; leave
              the column blank to assign the next number automatically.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function StudentDetail({ data, student, busy, onEdit, onCreateLogin, onToggleLogin }) {
  const attendance = studentAttendance(data, student.id);
  const scores = studentScores(data, student.id);
  const average = studentAverage(data, student.id);
  const atRisk = isStudentAtRisk(data, student.id);

  return (
    <div className="student-detail">
      <div className="student-detail-top">
        <Avatar name={student.name} size={64} photo={student.photo} />
        <div>
          <h2>{student.name}</h2>
          <p>
            {classLabel(data, student.classIdSection)} · Roll {student.rollNumber} · {student.code}
          </p>
          <div className="student-detail-badges">
            <Badge tone={student.status === 'Active' ? 'success' : 'neutral'}>{student.status}</Badge>
            {atRisk ? (
              <Badge tone="danger" icon={TriangleAlert}>
                Needs support
              </Badge>
            ) : (
              <Badge tone="success">On track</Badge>
            )}
          </div>
        </div>
      </div>

      <div className="student-detail-stats">
        <div className="student-detail-ring">
          <ProgressRing
            value={attendance.rate}
            size={94}
            stroke={9}
            color={attendance.rate >= 75 ? '#15803D' : '#B45309'}
            track="#F1F5F9"
          >
            <strong>{attendance.rate}%</strong>
            <span>attendance</span>
          </ProgressRing>
        </div>
        <div className="student-detail-numbers">
          <div>
            <span>Average</span>
            <strong>{average !== null ? `${Math.round(average)}%` : '—'}</strong>
          </div>
          <div>
            <span>Assessments</span>
            <strong>{scores.length}</strong>
          </div>
          <div>
            <span>Absences</span>
            <strong>{attendance.absent}</strong>
          </div>
          <div>
            <span>Late</span>
            <strong>{attendance.late}</strong>
          </div>
        </div>
      </div>

      <div className="student-contact-grid">
        <div>
          <span>
            <Users size={14} /> Guardian
          </span>
          <strong>{student.guardianName || 'Not recorded'}</strong>
        </div>
        <div>
          <span>
            <Phone size={14} /> Guardian phone
          </span>
          <strong>{student.parentPhone || 'Not recorded'}</strong>
        </div>
        <div>
          <span>
            <Mail size={14} /> Date of birth
          </span>
          <strong>{student.dateOfBirth ? formatDate(student.dateOfBirth) : 'Not recorded'}</strong>
        </div>
        <div>
          <span>School ID</span>
          <strong>{student.code}</strong>
        </div>
        <div>
          <span>Admission date</span>
          <strong>{student.admissionDate ? formatDate(student.admissionDate) : 'Not recorded'}</strong>
        </div>
      </div>

      <section
        className={`student-portal-card ${
          student.authUid || student.authEmail
            ? student.authDisabled
              ? 'is-disabled'
              : 'is-active'
            : ''
        }`}
      >
        <div className="student-portal-head">
          <span>
            <KeyRound size={15} /> Student portal
          </span>
          <Badge
            tone={
              student.authUid || student.authEmail
                ? student.authDisabled
                  ? 'warning'
                  : 'success'
                : 'neutral'
            }
          >
            {student.authUid || student.authEmail
              ? student.authDisabled
                ? 'Disabled'
                : 'Active'
              : 'Not linked'}
          </Badge>
        </div>

        {student.authEmail || student.authUid ? (
          <div className="student-portal-meta">
            <strong>{student.authEmail || 'Linked by Firebase UID'}</strong>
            {student.authUid ? <small>UID {student.authUid}</small> : null}
          </div>
        ) : (
          <p className="muted small">
            No login yet. Create one so this student can open the student portal.
          </p>
        )}

        <div className="student-portal-actions">
          {!student.authUid ? (
            <button
              type="button"
              className="admin-btn admin-btn-primary admin-btn-sm"
              onClick={onCreateLogin}
              disabled={busy}
            >
              <KeyRound size={14} /> Create login
            </button>
          ) : null}
          {student.authUid && !student.authDisabled ? (
            <button
              type="button"
              className="admin-btn admin-btn-ghost admin-btn-sm"
              onClick={() => onToggleLogin(false)}
              disabled={busy}
            >
              <ShieldOff size={14} /> Disable access
            </button>
          ) : null}
          {student.authUid && student.authDisabled ? (
            <button
              type="button"
              className="admin-btn admin-btn-primary admin-btn-sm"
              onClick={() => onToggleLogin(true)}
              disabled={busy}
            >
              <ShieldCheck size={14} /> Enable access
            </button>
          ) : null}
        </div>
      </section>

      <div className="student-detail-section">
        <div className="admin-section-head compact">
          <h3>Recent assessments</h3>
          <Badge tone={atRisk ? 'danger' : 'success'}>
            {atRisk ? 'Below risk threshold' : 'On track'}
          </Badge>
        </div>
        {scores.length ? (
          <div className="admin-mini-table">
            <div className="admin-mini-head">
              <span>Assessment</span>
              <span>Score</span>
              <span>Grade</span>
            </div>
            {scores.slice(0, 5).map((score) => (
              <div key={score.id} className="admin-mini-row">
                <span>
                  <strong>{score.examTitle || score.subject}</strong>
                  <small>
                    {score.subject} · {formatDate(score.enteredAt.slice(0, 10))}
                  </small>
                </span>
                <span>
                  {score.marksObtained}/{score.maxMarks} · {Math.round(score.percentage)}%
                </span>
                <Badge tone={score.percentage < 35 ? 'danger' : 'success'}>
                  {gradeLetter(score.percentage)}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">No assessment scores recorded yet.</p>
        )}
      </div>

      <div className="student-detail-section">
        <h3>Home address</h3>
        <p className="student-address">{student.address || 'Not recorded'}</p>
      </div>

      <button type="button" className="admin-btn admin-btn-secondary admin-btn-block" onClick={onEdit}>
        <Pencil size={15} /> Edit student record
      </button>
    </div>
  );
}
