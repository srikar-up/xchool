import { Bell, Megaphone, Pin } from 'lucide-react';
import { useStudentData } from '../context/StudentDataContext';
import Badge from '../components/Badge';
import EmptyState from '../components/EmptyState';
import PageHead from '../components/PageHead';
import { relativeTime } from '../lib/format';

const IMPORTANCE_TONE = {
  Normal: 'neutral',
  Important: 'brand',
  Urgent: 'warning',
  Emergency: 'danger',
};

export default function Notices() {
  const { data } = useStudentData();

  return (
    <div className="t-page">
      <PageHead
        backTo="/more"
        eyebrow="School announcements"
        title="Notices"
        subtitle={`${data.announcements.length} notice${data.announcements.length === 1 ? '' : 's'} for students`}
      />

      {data.announcements.length ? (
        <div className="student-notice-stack">
          {data.announcements.map((notice) => (
            <article key={notice.id} className="card student-notice-card">
              <div className="student-notice-head">
                <span className="student-notice-icon">
                  <Megaphone size={17} />
                </span>
                <div>
                  <h2>{notice.title}</h2>
                  <small>
                    {notice.publisherName} · {relativeTime(notice.createdAt)}
                  </small>
                </div>
                <div className="student-notice-badges">
                  {notice.isPinned ? (
                    <Badge tone="brand" icon={Pin}>
                      Pinned
                    </Badge>
                  ) : null}
                  <Badge tone={IMPORTANCE_TONE[notice.importance] || 'neutral'}>
                    {notice.importance}
                  </Badge>
                </div>
              </div>
              <p>{notice.body}</p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Bell}
          title="No notices"
          message="School announcements for students will appear here."
        />
      )}
    </div>
  );
}
