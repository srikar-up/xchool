import { useMemo } from 'react';
import { Award, BookOpen, FileBarChart2, TrendingUp } from 'lucide-react';
import { useStudentData } from '../context/StudentDataContext';
import Badge from '../components/Badge';
import EmptyState from '../components/EmptyState';
import PageHead from '../components/PageHead';
import { categoryLabel, formatDate } from '../lib/format';
import { averagePercentage, gradeFor, gradeTone } from '../lib/student';

export default function Results() {
  const { data } = useStudentData();
  const average = averagePercentage(data.results);

  const bySubject = useMemo(() => {
    const map = new Map();
    data.results.forEach((result) => {
      const list = map.get(result.subject) || [];
      list.push(result);
      map.set(result.subject, list);
    });
    return [...map.entries()]
      .map(([subject, results]) => ({
        subject,
        average: averagePercentage(results),
        results,
      }))
      .sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
  }, [data.results]);

  const best = bySubject[0] || null;

  return (
    <div className="t-page">
      <PageHead
        eyebrow="Assessments"
        title="Results"
        subtitle={`${data.results.length} published result${data.results.length === 1 ? '' : 's'}`}
      />

      <section className="student-result-hero">
        <div className="student-result-score">
          <span>Overall average</span>
          <strong>{average === null ? '—' : `${Math.round(average)}%`}</strong>
          <Badge tone={gradeTone(average)}>{gradeFor(average)}</Badge>
        </div>
        <div className="student-result-side">
          <div>
            <span>
              <Award size={14} /> Best subject
            </span>
            <strong>{best ? best.subject : '—'}</strong>
            <small>{best?.average === null ? '' : `${Math.round(best.average)}% average`}</small>
          </div>
          <div>
            <span>
              <BookOpen size={14} /> Subjects assessed
            </span>
            <strong>{bySubject.length}</strong>
            <small>across all assessments</small>
          </div>
        </div>
      </section>

      {bySubject.length ? (
        <div className="student-subject-stack">
          {bySubject.map((group) => (
            <section key={group.subject} className="card student-subject-card">
              <div className="student-subject-head">
                <div>
                  <h2>{group.subject}</h2>
                  <small>{group.results.length} result{group.results.length === 1 ? '' : 's'}</small>
                </div>
                <strong>{group.average === null ? '—' : `${Math.round(group.average)}%`}</strong>
              </div>

              <div className="student-result-list">
                {group.results.map((result) => (
                  <article key={result.id} className="student-result-row">
                    <div className="student-result-main">
                      <span>
                        <strong>{result.title}</strong>
                        <small>
                          {categoryLabel(result.category)} · {formatDate(result.date)}
                        </small>
                      </span>
                      <span className="student-result-marks">
                        <strong>{result.marksObtained}</strong>
                        <small>/{result.maxMarks}</small>
                      </span>
                    </div>
                    <div className="student-result-bar">
                      <div className="student-progress-track">
                        <i
                          className={`student-progress-fill tone-${gradeTone(result.percentage)}`}
                          style={{ width: `${Math.max(2, Math.min(100, result.percentage || 0))}%` }}
                        />
                      </div>
                      <span>
                        {result.percentage === null ? '—' : `${result.percentage}%`} ·{' '}
                        <strong>{gradeFor(result.percentage)}</strong>
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={FileBarChart2}
          title="No results yet"
          message="Results appear here as soon as your teachers publish them."
        />
      )}

      <p className="student-footnote">
        <TrendingUp size={14} /> Averages are unweighted across published assessments.
      </p>
    </div>
  );
}
