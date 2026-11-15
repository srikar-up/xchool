import { ContactRound, Mail, Phone, UserRound } from 'lucide-react';
import { useStudentData } from '../context/StudentDataContext';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import EmptyState from '../components/EmptyState';
import PageHead from '../components/PageHead';

function contactHref(kind, value) {
  if (!value) return null;
  if (kind === 'phone') return `tel:${String(value).replace(/[^\d+]/g, '')}`;
  return `mailto:${value}`;
}

function ContactActions({ person }) {
  const phone = contactHref('phone', person.phone);
  const email = contactHref('email', person.email);
  return (
    <div className="student-contact-actions">
      {phone ? (
        <a className="btn btn-ghost btn-sm" href={phone} aria-label={`Call ${person.name}`}>
          <Phone size={14} /> Call
        </a>
      ) : null}
      {email ? (
        <a className="btn btn-ghost btn-sm" href={email} aria-label={`Email ${person.name}`}>
          <Mail size={14} /> Email
        </a>
      ) : null}
    </div>
  );
}

export default function Teachers() {
  const { data } = useStudentData();
  const classTeacher = data.classIncharge;
  const subjectTeachers = data.teachers.filter((teacher) => !teacher.isClassTeacher);

  return (
    <div className="t-page">
      <PageHead
        backTo="/more"
        eyebrow="My class"
        title="Teachers"
        subtitle={`${data.class?.displayName || 'My class'} · ${data.teachers.length} teaching staff`}
      />

      {classTeacher ? (
        <section className="card student-teacher-hero">
          <Avatar
            name={classTeacher.name}
            size={64}
            photo={classTeacher.photo ? { url: classTeacher.photo } : undefined}
          />
          <div className="student-teacher-identity">
            <Badge tone="brand" icon={ContactRound}>
              Class teacher
            </Badge>
            <h2>{classTeacher.name}</h2>
            <p>
              {classTeacher.department || 'General'}
              {classTeacher.staffType ? ` · ${classTeacher.staffType}` : ''}
            </p>
            {classTeacher.email ? <small>{classTeacher.email}</small> : null}
          </div>
          <ContactActions person={classTeacher} />
        </section>
      ) : (
        <EmptyState
          icon={ContactRound}
          title="No class teacher assigned"
          message="The school office has not assigned a class teacher yet."
        />
      )}

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">This term</span>
            <h2>Subject teachers</h2>
          </div>
          <span className="muted small">{subjectTeachers.length}</span>
        </div>

        {subjectTeachers.length ? (
          <div className="card student-teacher-list">
            {subjectTeachers.map((teacher) => (
              <div key={teacher.id} className="student-teacher-row">
                <Avatar
                  name={teacher.name}
                  size={42}
                  photo={teacher.photo ? { url: teacher.photo } : undefined}
                />
                <div className="student-teacher-text">
                  <strong>{teacher.name}</strong>
                  <small>{teacher.subjects.join(' · ') || teacher.department || 'Teacher'}</small>
                  {teacher.email ? <small>{teacher.email}</small> : null}
                </div>
                <ContactActions person={teacher} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={UserRound}
            title="No subject teachers yet"
            message="Teachers appear here once subjects are assigned to your class."
          />
        )}
      </section>

      <p className="student-footnote">
        <Phone size={14} /> Please contact teachers during school hours. For urgent matters,
        call the school office.
      </p>
    </div>
  );
}
