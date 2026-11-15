import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Award,
  Bell,
  CalendarCheck2,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  ContactRound,
  FileBarChart2,
  GraduationCap,
  Mail,
  MapPin,
  Megaphone,
  Phone,
  Sparkles,
} from 'lucide-react';
import { useStudentData } from '../context/StudentDataContext';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import ProgressRing from '../components/ProgressRing';
import {
  formatDate,
  formatDateLong,
  formatTime,
  greeting,
  relativeTime,
  todayISO,
} from '../lib/format';
import { averagePercentage, todayPeriods } from '../lib/student';

export default function Home() {
  const { data, user } = useStudentData();
  const now = new Date();
  const day = now.getDay();
  const periods = todayPeriods(data, day);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (value) => {
    const [hours, mins] = String(value || '').split(':').map(Number);
    return hours * 60 + (mins || 0);
  };
  const current = periods.find(
    (period) => minutes >= toMinutes(period.startTime) && minutes <= toMinutes(period.endTime)
  );
  const next = periods.find((period) => toMinutes(period.startTime) > minutes) || periods[0];
  const displayPeriods = periods.slice(0, 4);
  const attendance = data.attendanceSummary || { rate: null, present: 0, absent: 0, total: 0 };
  const average = averagePercentage(data.results);
  const latestResults = data.results.slice(0, 3);
  const notices = [...data.announcements].slice(0, 3);
  const pinned = data.announcements.find((notice) => notice.isPinned);
  const today = todayISO();
  const todayEntries = data.attendance.filter((entry) => entry.date === today);
  const upcomingAssignments = data.assignments
    .filter((assignment) => !assignment.dueDate || assignment.dueDate >= today)
    .slice(0, 3);
  const nextExam = [...data.exams]
    .filter((exam) => exam.date >= today)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];

  return (
    <div className="t-page home-page">
      <section className="home-hero">
        <div className="home-hero-decor home-hero-decor-a" aria-hidden="true" />
        <div className="home-hero-decor home-hero-decor-b" aria-hidden="true" />

        <div className="hero-top">
          <div className="hero-identity">
            <Avatar name={user?.name || 'Student'} size={46} className="avatar-hero" photo={user?.photo} />
            <div>
              <span className="hero-greeting">{greeting()},</span>
              <h2>{user?.name || 'Student'}</h2>
            </div>
          </div>
          <Link to="/notices" className="hero-icon-btn" aria-label="Notices">
            <Bell size={19} />
            {pinned ? <span className="dot" /> : null}
          </Link>
        </div>

        <div className="hero-meta">
          <span className="hero-chip">
            <GraduationCap size={14} />
            {data.class?.displayName || 'My class'} · Roll {user?.rollNumber}
          </span>
          <span className="hero-date">{formatDateLong(now, { year: 'numeric' })}</span>
        </div>

        <div className="hero-stats">
          <div className="hero-stat hero-stat-yellow">
            <span className="hero-stat-label">Attendance</span>
            <strong>{attendance.rate === null ? '—' : `${attendance.rate}%`}</strong>
            <small>
              {attendance.total
                ? `${attendance.present + attendance.late} of ${attendance.total} days present`
                : 'No registers yet'}
            </small>
          </div>
          <div className="hero-stat hero-stat-glass">
            <span className="hero-stat-label">Assessment average</span>
            <strong>{average === null ? '—' : `${Math.round(average)}%`}</strong>
            <small>{data.results.length ? `${data.results.length} results recorded` : 'No results yet'}</small>
          </div>
        </div>

        <Link to="/report-card" className="hero-action">
          <Award size={18} />
          View my report card
          <ArrowRight size={17} />
        </Link>
      </section>

      <section className="quick-actions" aria-label="Quick links">
        <Link to="/timetable" className="quick-action qa-teal">
          <span className="quick-action-icon">
            <CalendarDays size={21} />
          </span>
          <span>
            <strong>Timetable</strong>
            <small>This week</small>
          </span>
        </Link>
        <Link to="/attendance" className="quick-action qa-indigo">
          <span className="quick-action-icon">
            <CalendarCheck2 size={21} />
          </span>
          <span>
            <strong>Attendance</strong>
            <small>My register</small>
          </span>
        </Link>
        <Link to="/results" className="quick-action qa-blue">
          <span className="quick-action-icon">
            <FileBarChart2 size={21} />
          </span>
          <span>
            <strong>Results</strong>
            <small>Marks and grades</small>
          </span>
        </Link>
        <Link to="/assignments" className="quick-action qa-amber">
          <span className="quick-action-icon">
            <ClipboardList size={21} />
          </span>
          <span>
            <strong>Assignments</strong>
            <small>Class work and due dates</small>
          </span>
        </Link>
      </section>

      {data.classIncharge ? (
        <section className="card student-class-teacher-card">
          <Avatar
            name={data.classIncharge.name}
            size={52}
            photo={data.classIncharge.photo ? { url: data.classIncharge.photo } : undefined}
          />
          <div>
            <span className="eyebrow">
              <ContactRound size={13} /> Class teacher
            </span>
            <h2>{data.classIncharge.name}</h2>
            <small>
              {data.classIncharge.department || 'General'}
              {data.classIncharge.email ? ` · ${data.classIncharge.email}` : ''}
            </small>
          </div>
          <div className="student-contact-actions">
            {data.classIncharge.phone ? (
              <a
                className="btn btn-ghost btn-sm"
                href={`tel:${String(data.classIncharge.phone).replace(/[^\d+]/g, '')}`}
              >
                <Phone size={14} /> Call
              </a>
            ) : null}
            {data.classIncharge.email ? (
              <a className="btn btn-ghost btn-sm" href={`mailto:${data.classIncharge.email}`}>
                <Mail size={14} /> Email
              </a>
            ) : null}
            <Link to="/teachers" className="btn btn-ghost btn-sm">
              All teachers <ChevronRight size={14} />
            </Link>
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">Today</span>
            <h2>My schedule</h2>
          </div>
          <Link to="/timetable" className="text-link">
            Full week <ChevronRight size={15} />
          </Link>
        </div>

        {displayPeriods.length ? (
          <div className="schedule-list">
            {displayPeriods.map((period) => {
              const isNow = current?.id === period.id;
              const isNext = !isNow && next?.id === period.id;
              return (
                <article key={period.id} className={`schedule-card ${isNow ? 'schedule-now' : ''}`}>
                  <div className="schedule-time">
                    <strong>{formatTime(period.startTime).replace(' ', '')}</strong>
                    <span>{formatTime(period.endTime).replace(' ', '')}</span>
                  </div>
                  <div className="schedule-rail">
                    <span className="schedule-dot" />
                  </div>
                  <div className="schedule-content">
                    <div className="schedule-title-row">
                      <h3>{period.subject}</h3>
                      {isNow ? (
                        <Badge tone="success" icon={Sparkles}>
                          Now
                        </Badge>
                      ) : isNext ? (
                        <Badge tone="brand">Next</Badge>
                      ) : null}
                    </div>
                    <div className="schedule-meta">
                      <span>{period.teacherName}</span>
                      <span>
                        <MapPin size={12} /> {period.room}
                      </span>
                      {period.isLab ? <span className="lab-tag">Lab</span> : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="soft-empty">No periods scheduled for today.</div>
        )}
      </section>

      {todayEntries.length ? (
        <section className="card today-attendance-card">
          <div className="card-top">
            <div>
              <span className="eyebrow">Today</span>
              <h2>Attendance</h2>
            </div>
            <Link to="/attendance" className="icon-btn" aria-label="Open attendance">
              <ArrowRight size={18} />
            </Link>
          </div>
          <div className="today-attendance-list">
            {todayEntries.map((entry) => (
              <div key={entry.id} className="today-attendance-row">
                <span className={`status-pill status-${entry.status}`}>{entry.status}</span>
                <span>{entry.sessionType === 'FullDay' ? 'Full day' : entry.sessionType}</span>
                {entry.remarks ? <small>{entry.remarks}</small> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {upcomingAssignments.length ? (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">Class work</span>
              <h2>Assignments</h2>
            </div>
            <Link to="/assignments" className="text-link">
              All <ChevronRight size={15} />
            </Link>
          </div>
          <div className="notice-list">
            {upcomingAssignments.map((assignment) => (
              <Link key={assignment.id} to="/assignments" className="notice-card">
                <span className="student-assignment-mini-icon">
                  <ClipboardList size={16} />
                </span>
                <span>
                  <strong>{assignment.title}</strong>
                  <small>
                    {assignment.subject} ·{' '}
                    {assignment.dueDate ? `due ${formatDate(assignment.dueDate)}` : 'no due date'}
                  </small>
                </span>
                <ChevronRight size={16} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {pinned ? (
        <Link to="/notices" className="notice-banner">
          <span className="notice-banner-icon">
            <Megaphone size={19} />
          </span>
          <span className="notice-banner-text">
            <small>
              {pinned.importance} · {relativeTime(pinned.createdAt)}
            </small>
            <strong>{pinned.title}</strong>
          </span>
          <ChevronRight size={18} />
        </Link>
      ) : null}

      <div className="home-columns">
        <section className="card">
          <div className="card-top">
            <div>
              <span className="eyebrow">Latest</span>
              <h2>Results</h2>
            </div>
            <Link to="/results" className="icon-btn" aria-label="All results">
              <ArrowRight size={18} />
            </Link>
          </div>
          {latestResults.length ? (
            <div className="result-mini-list">
              {latestResults.map((result) => (
                <Link key={result.id} to="/results" className="result-mini-row">
                  <span>
                    <strong>{result.subject}</strong>
                    <small>{result.title}</small>
                  </span>
                  <span className="result-mini-score">
                    <strong>{result.marksObtained}</strong>
                    <small>/{result.maxMarks}</small>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="soft-empty">No assessment results have been published yet.</p>
          )}
        </section>

        {nextExam ? (
          <Link to="/exams" className="card student-next-exam-card">
            <div className="card-top">
              <div>
                <span className="eyebrow">Next exam</span>
                <h2>{nextExam.subject}</h2>
              </div>
              <CalendarDays size={18} />
            </div>
            <strong>{nextExam.title}</strong>
            <p>
              {formatDate(nextExam.date)} · {formatTime(nextExam.startTime)}
            </p>
            <small>
              {nextExam.maxMarks} marks · {nextExam.marksStatus || 'Scheduled'}
            </small>
          </Link>
        ) : null}

        <section className="card attendance-preview">
          <div className="card-top">
            <div>
              <span className="eyebrow">This term</span>
              <h2>Attendance</h2>
            </div>
          </div>
          <div className="attendance-preview-body">
            <ProgressRing
              value={attendance.rate || 0}
              size={108}
              stroke={10}
              color="var(--brand)"
              track="var(--brand-100)"
            >
              <strong>{attendance.rate === null ? '—' : `${Math.round(attendance.rate)}%`}</strong>
              <span>present</span>
            </ProgressRing>
            <div className="attendance-preview-stats">
              <div>
                <span className="legend-dot success" />
                <span>Present</span>
                <strong>{attendance.present}</strong>
              </div>
              <div>
                <span className="legend-dot warning" />
                <span>Late</span>
                <strong>{attendance.late}</strong>
              </div>
              <div>
                <span className="legend-dot danger" />
                <span>Absent</span>
                <strong>{attendance.absent}</strong>
              </div>
              <div>
                <span className="legend-dot neutral" />
                <span>Excused</span>
                <strong>{attendance.excused}</strong>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">School</span>
            <h2>Notices</h2>
          </div>
          <Link to="/notices" className="text-link">
            All notices <ChevronRight size={15} />
          </Link>
        </div>
        {notices.length ? (
          <div className="notice-list">
            {notices.map((notice) => (
              <Link key={notice.id} to="/notices" className="notice-card">
                <span className={`notice-dot importance-${notice.importance.toLowerCase()}`} />
                <span>
                  <strong>{notice.title}</strong>
                  <small>
                    {notice.publisherName} · {relativeTime(notice.createdAt)}
                  </small>
                </span>
                <ChevronRight size={16} />
              </Link>
            ))}
          </div>
        ) : (
          <p className="soft-empty">No notices yet.</p>
        )}
      </section>

      <p className="student-footnote">
        <ClipboardList size={14} /> Your portal is read-only. Contact the school office to correct a record.
      </p>
    </div>
  );
}
