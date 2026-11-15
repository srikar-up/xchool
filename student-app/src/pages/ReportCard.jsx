import { Award, Printer } from 'lucide-react';
import { useStudentData } from '../context/StudentDataContext';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import PageHead from '../components/PageHead';
import { categoryLabel, formatDate, formatDateLong } from '../lib/format';
import {
  averagePercentage,
  gradeFor,
  gradeTone,
  latestRemark,
} from '../lib/student';

export default function ReportCard() {
  const { data, user } = useStudentData();
  const average = averagePercentage(data.results);
  const remark = latestRemark(user);
  const attendance = data.attendanceSummary;
  const meta = data.meta;

  return (
    <div className="t-page report-page">
      <PageHead
        backTo="/more"
        eyebrow="Progress report"
        title="Report card"
        subtitle={meta.academicYear || 'Current academic year'}
        action={
          <button type="button" className="btn btn-primary btn-sm no-print" onClick={() => window.print()}>
            <Printer size={15} /> Print
          </button>
        }
      />

      <article className="report-sheet">
        <header className="report-sheet-head">
          <span className="report-crest">
            <img src={`${import.meta.env.BASE_URL}school-logo.jpg`} alt="" />
          </span>
          <div className="report-school">
            <h1>{meta.schoolName || 'Xchool'}</h1>
            <p>{meta.address}</p>
            <small>
              {meta.phone}
              {meta.email ? ` · ${meta.email}` : ''}
            </small>
          </div>
          <span className="report-year">{meta.academicYear}</span>
        </header>

        <div className="report-student-card">
          <Avatar name={user?.name || 'Student'} size={58} photo={user?.photo} />
          <div>
            <h2>{user?.name}</h2>
            <p>
              {data.class?.displayName || user?.classIdSection} · Roll {user?.rollNumber} · ID{' '}
              {user?.code}
            </p>
            <small>
              Guardian: {user?.guardianName || 'Not recorded'}
              {user?.parentPhone ? ` · ${user.parentPhone}` : ''}
            </small>
          </div>
          <div className="report-average">
            <Award size={18} />
            <strong>{average === null ? '—' : `${Math.round(average)}%`}</strong>
            <span>average</span>
          </div>
        </div>

        <section className="report-grid">
          <div>
            <span>Class teacher</span>
            <strong>{data.classIncharge?.name || 'Not assigned'}</strong>
          </div>
          <div>
            <span>Attendance</span>
            <strong>
              {attendance.rate === null ? '—' : `${attendance.rate}%`}
              <small>
                {' '}
                ({attendance.present + attendance.late}/{attendance.total})
              </small>
            </strong>
          </div>
          <div>
            <span>Admission date</span>
            <strong>{user?.admissionDate ? formatDate(user.admissionDate) : 'Not recorded'}</strong>
          </div>
          <div>
            <span>Generated</span>
            <strong>{formatDateLong(new Date(), { year: 'numeric' })}</strong>
          </div>
        </section>

        <section className="report-section">
          <h3>Assessment results</h3>
          {data.results.length ? (
            <table className="report-table">
              <thead>
                <tr>
                  <th>Assessment</th>
                  <th>Subject</th>
                  <th>Date</th>
                  <th>Marks</th>
                  <th>%</th>
                  <th>Grade</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((result) => (
                  <tr key={result.id}>
                    <td>
                      {result.title}
                      <small>{categoryLabel(result.category)}</small>
                    </td>
                    <td>{result.subject}</td>
                    <td>{formatDate(result.date)}</td>
                    <td>
                      {result.marksObtained}/{result.maxMarks}
                    </td>
                    <td>{result.percentage === null ? '—' : result.percentage}</td>
                    <td>
                      <Badge tone={gradeTone(result.percentage)}>{gradeFor(result.percentage)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No assessment results have been published yet.</p>
          )}
        </section>

        <section className="report-section">
          <h3>Attendance summary</h3>
          <div className="report-attendance">
            <div>
              <span>Present</span>
              <strong>{attendance.present}</strong>
            </div>
            <div>
              <span>Late</span>
              <strong>{attendance.late}</strong>
            </div>
            <div>
              <span>Excused</span>
              <strong>{attendance.excused}</strong>
            </div>
            <div>
              <span>Absent</span>
              <strong>{attendance.absent}</strong>
            </div>
            <div>
              <span>Rate</span>
              <strong>{attendance.rate === null ? '—' : `${attendance.rate}%`}</strong>
            </div>
          </div>
        </section>

        <section className="report-section teacher-remark">
          <h3>Teacher remark</h3>
          <p>
            {remark?.text ||
              'No remark has been recorded this term. Your class teacher can add one before the report is shared.'}
          </p>
          <span className="remark-sign">
            {remark ? `— ${remark.updatedByName || 'Class teacher'}` : ''}
          </span>
        </section>

        <footer className="report-signatures">
          <div>
            <span />
            <small>Class teacher</small>
          </div>
          <div>
            <span />
            <small>{meta.principalName || 'Principal'}</small>
          </div>
        </footer>

        <p className="report-foot">
          Generated {formatDateLong(new Date(), { year: 'numeric' })} · {meta.shortName || meta.schoolName}
        </p>
      </article>

      <p className="student-footnote no-print">
        This is a student copy. The school office keeps the official record.
      </p>
    </div>
  );
}
