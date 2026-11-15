import { useMemo, useState } from 'react';
import {
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock3,
  MinusCircle,
} from 'lucide-react';
import { useStudentData } from '../context/StudentDataContext';
import EmptyState from '../components/EmptyState';
import PageHead from '../components/PageHead';
import { formatDateLong } from '../lib/format';
import {
  addMonths,
  monthCells,
  monthKey,
  monthLabel,
  monthStart,
} from '../lib/student';

const STATUS = {
  present: { label: 'Present', icon: CircleCheck, tone: 'success' },
  absent: { label: 'Absent', icon: CircleX, tone: 'danger' },
  late: { label: 'Late', icon: Clock3, tone: 'warning' },
  excused: { label: 'Excused', icon: MinusCircle, tone: 'neutral' },
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Attendance() {
  const { data } = useStudentData();
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const key = monthKey(month);
  const isCurrent = key === monthKey(monthStart(new Date()));
  const todayIso = new Date().toISOString().slice(0, 10);

  const monthEntries = useMemo(
    () => data.attendance.filter((entry) => String(entry.date).startsWith(key)),
    [data.attendance, key]
  );
  const byDate = useMemo(() => {
    const map = new Map();
    monthEntries.forEach((entry) => {
      const list = map.get(entry.date) || [];
      list.push(entry);
      map.set(entry.date, list);
    });
    return map;
  }, [monthEntries]);

  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  monthEntries.forEach((entry) => {
    if (counts[entry.status] !== undefined) counts[entry.status] += 1;
  });
  const total = monthEntries.length;
  const rate = total
    ? Math.round(((counts.present + counts.late * 0.5) / total) * 1000) / 10
    : null;
  const cells = monthCells(month);

  return (
    <div className="t-page">
      <PageHead
        eyebrow="My register"
        title="Attendance"
        subtitle={data.meta.academicYear || 'Current academic year'}
      />

      <section className="card student-attendance-summary">
        <div className="student-rate-ring">
          <strong>{rate === null ? '—' : `${Math.round(rate)}%`}</strong>
          <span>{monthLabel(month)}</span>
        </div>
        <div className="student-stat-grid">
          {Object.entries(STATUS).map(([status, meta]) => {
            const Icon = meta.icon;
            return (
              <div key={status}>
                <span>
                  <Icon size={14} /> {meta.label}
                </span>
                <strong>{counts[status]}</strong>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="registry-head">
          <div>
            <span className="registry-eyebrow">
              <CalendarCheck2 size={14} /> Monthly view
            </span>
            <h2>My attendance</h2>
            <p>One square per recorded session.</p>
          </div>
          <div className="registry-nav">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMonth((current) => addMonths(current, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft size={17} />
            </button>
            <strong>{monthLabel(month)}</strong>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMonth((current) => addMonths(current, 1))}
              aria-label="Next month"
              disabled={isCurrent}
            >
              <ChevronRight size={17} />
            </button>
            <button type="button" className="registry-today" onClick={() => setMonth(monthStart(new Date()))}>
              Today
            </button>
          </div>
        </div>

        <div className="student-calendar">
          <div className="student-calendar-head">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="student-calendar-grid">
            {cells.map((cell, index) =>
              cell ? (
                <div
                  key={cell.iso}
                  className={`student-calendar-day ${cell.iso === todayIso ? 'today' : ''}`}
                >
                  <span>{cell.day}</span>
                  <div className="student-calendar-dots">
                    {(byDate.get(cell.iso) || []).map((entry) => (
                      <i
                        key={entry.id}
                        className={`status-dot status-${entry.status}`}
                        title={`${entry.sessionType}: ${STATUS[entry.status]?.label || entry.status}`}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div key={`empty-${index}`} className="student-calendar-day empty" />
              )
            )}
          </div>
        </div>

        <div className="student-calendar-legend">
          <span><i className="status-dot status-present" /> Present</span>
          <span><i className="status-dot status-late" /> Late</span>
          <span><i className="status-dot status-excused" /> Excused</span>
          <span><i className="status-dot status-absent" /> Absent</span>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{monthLabel(month)}</span>
            <h2>Session log</h2>
          </div>
          <span className="muted small">{total} recorded</span>
        </div>

        {monthEntries.length ? (
          <div className="card student-session-list">
            {monthEntries.map((entry) => {
              const meta = STATUS[entry.status] || STATUS.excused;
              const Icon = meta.icon;
              return (
                <div key={entry.id} className="student-session-row">
                  <span className={`session-icon tone-${meta.tone}`}>
                    <Icon size={16} />
                  </span>
                  <span className="student-session-text">
                    <strong>{formatDateLong(entry.date, { year: 'numeric' })}</strong>
                    <small>
                      {entry.sessionType === 'FullDay' ? 'Full day' : entry.sessionType}
                      {entry.remarks ? ` · ${entry.remarks}` : ''}
                    </small>
                  </span>
                  <span className={`status-pill status-${entry.status}`}>{meta.label}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={CalendarCheck2}
            title="Nothing recorded"
            message={`No attendance has been recorded for ${monthLabel(month)}.`}
          />
        )}
      </section>
    </div>
  );
}
