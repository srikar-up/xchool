import { CalendarDays, Clock3, FileBarChart2, GraduationCap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useStudentData } from '../context/StudentDataContext';
import Badge from '../components/Badge';
import EmptyState from '../components/EmptyState';
import PageHead from '../components/PageHead';
import { categoryLabel, formatDate, formatTime, todayISO } from '../lib/format';
import { gradeFor, gradeTone } from '../lib/student';

export default function Exams() {
  const { data } = useStudentData();
  const today = todayISO();
  const resultsByExam = new Map(data.results.map((result) => [result.examId, result]));
  const upcoming = data.exams
    .filter((exam) => exam.date >= today)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const past = data.exams
    .filter((exam) => exam.date < today)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const renderExam = (exam) => {
    const result = resultsByExam.get(exam.id);
    return (
      <article key={exam.id} className="card student-exam-card">
        <div className="student-exam-head">
          <span className="student-exam-icon">
            <GraduationCap size={17} />
          </span>
          <div>
            <Badge tone="brand">{exam.subject}</Badge>
            <h2>{exam.title}</h2>
            <small>{categoryLabel(exam.category)}</small>
          </div>
          {result ? (
            <div className="student-exam-score">
              <strong>{result.marksObtained}</strong>
              <small>/{result.maxMarks}</small>
              <Badge tone={gradeTone(result.percentage)}>{gradeFor(result.percentage)}</Badge>
            </div>
          ) : (
            <Badge tone={exam.marksStatus === 'Open' ? 'warning' : 'neutral'}>
              {exam.marksStatus || 'Scheduled'}
            </Badge>
          )}
        </div>
        <div className="student-exam-meta">
          <span>
            <CalendarDays size={13} /> {formatDate(exam.date)}
          </span>
          <span>
            <Clock3 size={13} /> {formatTime(exam.startTime)} – {formatTime(exam.endTime)}
          </span>
          <span>Max {exam.maxMarks} marks</span>
        </div>
        {result ? (
          <Link to="/results" className="student-exam-link">
            <FileBarChart2 size={14} /> See result details
          </Link>
        ) : null}
      </article>
    );
  };

  return (
    <div className="t-page">
      <PageHead
        backTo="/more"
        eyebrow="Assessment schedule"
        title="Exams"
        subtitle={`${upcoming.length} upcoming · ${past.length} completed`}
      />

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">Next</span>
            <h2>Upcoming exams</h2>
          </div>
        </div>
        {upcoming.length ? (
          <div className="student-exam-stack">{upcoming.map(renderExam)}</div>
        ) : (
          <EmptyState
            icon={CalendarDays}
            title="No upcoming exams"
            message="The next assessment schedule will appear here when the school publishes it."
          />
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">History</span>
            <h2>Completed exams</h2>
          </div>
          <Link to="/results" className="text-link">
            All results
          </Link>
        </div>
        {past.length ? (
          <div className="student-exam-stack">{past.map(renderExam)}</div>
        ) : (
          <EmptyState
            icon={FileBarChart2}
            title="No exams yet"
            message="Completed assessments and their marks will appear here."
          />
        )}
      </section>
    </div>
  );
}
