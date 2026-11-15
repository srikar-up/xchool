import { useMemo, useState } from 'react';
import { CalendarClock, ClipboardList, CheckCircle2 } from 'lucide-react';
import { useStudentData } from '../context/StudentDataContext';
import Badge from '../components/Badge';
import EmptyState from '../components/EmptyState';
import PageHead from '../components/PageHead';
import { formatDate, todayISO } from '../lib/format';

function dueLabel(date, today) {
  if (!date) return 'No due date';
  if (date === today) return 'Due today';
  const diff = Math.round(
    (new Date(`${date}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86_400_000
  );
  if (diff === 1) return 'Due tomorrow';
  if (diff > 1) return `Due in ${diff} days`;
  if (diff === -1) return 'Due yesterday';
  return `${Math.abs(diff)} days overdue`;
}

export default function Assignments() {
  const { data } = useStudentData();
  const today = todayISO();
  const [filter, setFilter] = useState('upcoming');

  const groups = useMemo(() => {
    const assignments = data.assignments || [];
    const upcoming = assignments.filter(
      (assignment) => !assignment.dueDate || assignment.dueDate >= today
    );
    const earlier = assignments.filter(
      (assignment) => assignment.dueDate && assignment.dueDate < today
    );
    return { upcoming, earlier };
  }, [data.assignments, today]);

  const visible = filter === 'upcoming' ? groups.upcoming : groups.earlier;

  return (
    <div className="t-page">
      <PageHead
        backTo="/more"
        eyebrow="Class work"
        title="Assignments"
        subtitle={`${data.assignments.length} assignment${
          data.assignments.length === 1 ? '' : 's'
        } for ${data.class?.displayName || 'your class'}`}
      />

      <div className="segmented segmented-2">
        <button
          type="button"
          className={filter === 'upcoming' ? 'active' : ''}
          onClick={() => setFilter('upcoming')}
        >
          Due soon ({groups.upcoming.length})
        </button>
        <button
          type="button"
          className={filter === 'earlier' ? 'active' : ''}
          onClick={() => setFilter('earlier')}
        >
          Earlier ({groups.earlier.length})
        </button>
      </div>

      {visible.length ? (
        <div className="student-assignment-stack">
          {visible.map((assignment) => {
            const overdue =
              assignment.dueDate &&
              assignment.dueDate < today &&
              assignment.status !== 'Reviewed';
            return (
              <article key={assignment.id} className="card student-assignment-card">
                <div className="student-assignment-head">
                  <span className="student-assignment-icon">
                    <ClipboardList size={17} />
                  </span>
                  <div>
                    <Badge tone="brand">{assignment.subject}</Badge>
                    <h2>{assignment.title}</h2>
                    <small>
                      {assignment.teacherName || 'Class teacher'}
                      {assignment.createdAt ? ` · set ${formatDate(assignment.createdAt)}` : ''}
                    </small>
                  </div>
                  <Badge tone={overdue ? 'danger' : assignment.status === 'Reviewed' ? 'success' : 'warning'}>
                    {overdue ? 'Overdue' : assignment.status}
                  </Badge>
                </div>
                {assignment.description ? <p>{assignment.description}</p> : null}
                <div className="student-assignment-foot">
                  <span className={overdue ? 'danger-text' : ''}>
                    <CalendarClock size={14} /> {dueLabel(assignment.dueDate, today)}
                  </span>
                  {assignment.dueDate ? <small>{formatDate(assignment.dueDate)}</small> : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={filter === 'upcoming' ? CalendarClock : CheckCircle2}
          title={filter === 'upcoming' ? 'Nothing due' : 'No earlier assignments'}
          message={
            filter === 'upcoming'
              ? 'New class work from your teachers will appear here.'
              : 'Assignments past their due date will be listed here.'
          }
        />
      )}

      <p className="student-footnote">
        <ClipboardList size={14} /> This portal shows class assignments read-only. Submit work
        in class or through your teacher’s usual channel.
      </p>
    </div>
  );
}
