import { BookOpen, CheckCircle2, Circle, Clock3 } from 'lucide-react';
import { useStudentData } from '../context/StudentDataContext';
import Badge from '../components/Badge';
import EmptyState from '../components/EmptyState';
import PageHead from '../components/PageHead';
import { progressOf } from '../lib/student';

const STATUS = {
  completed: { label: 'Completed', tone: 'success', icon: CheckCircle2 },
  in_progress: { label: 'In progress', tone: 'warning', icon: Clock3 },
  pending: { label: 'Pending', tone: 'neutral', icon: Circle },
};

export default function Syllabus() {
  const { data } = useStudentData();
  const subjects = data.subjects.map((subject) => ({
    ...subject,
    progress: progressOf(subject.chapters),
  }));
  const overall = subjects.reduce(
    (sum, subject) => ({
      completed: sum.completed + subject.progress.completed,
      total: sum.total + subject.progress.total,
    }),
    { completed: 0, total: 0 }
  );
  const overallPercent = overall.total
    ? Math.round((overall.completed / overall.total) * 100)
    : 0;

  return (
    <div className="t-page">
      <PageHead
        backTo="/more"
        eyebrow="This term"
        title="Syllabus"
        subtitle={`${overall.completed} of ${overall.total} chapters completed`}
        action={<Badge tone="brand">{overallPercent}%</Badge>}
      />

      <section className="card student-syllabus-overview">
        <div className="student-syllabus-head">
          <span>
            <BookOpen size={16} /> Overall coverage
          </span>
          <strong>{overallPercent}%</strong>
        </div>
        <div className="student-progress-track large">
          <i className="student-progress-fill tone-brand" style={{ width: `${overallPercent}%` }} />
        </div>
        <p className="muted small">
          Chapter status is maintained by your subject teachers, so it may update during the week.
        </p>
      </section>

      {subjects.length ? (
        <div className="student-subject-stack">
          {subjects.map((subject) => (
            <section key={subject.id} className="card student-syllabus-card">
              <div className="student-subject-head">
                <div>
                  <h2>{subject.subjectName}</h2>
                  <small>
                    {subject.assignedTeacherName}
                    {subject.isLab ? ' · Lab' : ''} · {subject.progress.completed}/
                    {subject.progress.total} chapters
                  </small>
                </div>
                <strong>{subject.progress.percent}%</strong>
              </div>
              <div className="student-progress-track">
                <i
                  className="student-progress-fill tone-brand"
                  style={{ width: `${subject.progress.percent}%` }}
                />
              </div>

              {subject.chapters.length ? (
                <ol className="student-chapter-list">
                  {subject.chapters.map((chapter, index) => {
                    const meta = STATUS[chapter.status] || STATUS.pending;
                    const Icon = meta.icon;
                    return (
                      <li key={`${subject.id}-${index}`} className="student-chapter-row">
                        <span className={`chapter-icon tone-${meta.tone}`}>
                          <Icon size={14} />
                        </span>
                        <span>
                          <strong>
                            {index + 1}. {chapter.title}
                          </strong>
                          <small>{meta.label}</small>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="soft-empty">No chapters have been added for this subject.</p>
              )}
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={BookOpen}
          title="No subjects yet"
          message="Your class subjects and syllabus will appear here."
        />
      )}
    </div>
  );
}
