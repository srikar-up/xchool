import { NavLink, useNavigate } from 'react-router-dom';
import {
  Award,
  Bell,
  BookOpen,
  ChevronRight,
  Info,
  LogOut,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useStudentData } from '../context/StudentDataContext';
import PageHead from '../components/PageHead';
import { relativeTime } from '../lib/format';

const LINKS = [
  {
    to: '/syllabus',
    label: 'Syllabus',
    description: 'Chapter coverage for every subject',
    icon: BookOpen,
    tone: 'amber',
  },
  {
    to: '/notices',
    label: 'Notices',
    description: 'Announcements from the school',
    icon: Bell,
    tone: 'indigo',
  },
  {
    to: '/report-card',
    label: 'Report card',
    description: 'Attendance, results and teacher remark',
    icon: Award,
    tone: 'teal',
  },
  {
    to: '/profile',
    label: 'Profile',
    description: 'Your details and profile photo',
    icon: UserRound,
    tone: 'blue',
  },
];

export default function More() {
  const {
    data,
    user,
    live,
    offline,
    refreshing,
    refresh,
    lastSyncedAt,
    logout,
    notify,
  } = useStudentData();
  const navigate = useNavigate();

  const signOut = () => {
    logout();
    notify('Signed out of the student portal.', 'info');
    navigate('/login', { replace: true });
  };

  return (
    <div className="t-page">
      <PageHead
        eyebrow="Student portal"
        title="More"
        subtitle={`${data.meta.shortName || data.meta.schoolName || 'Xchool'} · ${
          data.meta.academicYear || ''
        }`}
      />

      <section className="student-more-hero">
        <div>
          <span className="eyebrow">Signed in as</span>
          <h2>{user?.name}</h2>
          <p>
            {data.class?.displayName || user?.classIdSection} · Roll {user?.rollNumber} · ID{' '}
            {user?.code}
          </p>
        </div>
        <ShieldCheck size={34} />
      </section>

      <nav className="student-more-links" aria-label="More sections">
        {LINKS.map(({ to, label, description, icon: Icon, tone }) => (
          <NavLink key={to} to={to} className="student-more-link">
            <span className={`student-more-icon tone-${tone}`}>
              <Icon size={20} />
            </span>
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
            <ChevronRight size={18} />
          </NavLink>
        ))}
      </nav>

      <section className="card student-sync-card">
        <div className="student-sync-head">
          <span>
            {offline ? <WifiOff size={16} /> : <Wifi size={16} />}
            {offline ? 'Offline preview' : live ? 'Live sync connected' : 'Connected'}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => refresh()}
            disabled={refreshing}
          >
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <p>
          {lastSyncedAt
            ? `Last synced ${relativeTime(lastSyncedAt.toISOString())}.`
            : 'Waiting for the first sync.'}{' '}
          Revision {data.revision}.
        </p>
        {offline ? (
          <p className="student-sync-warning">
            You are seeing the last copy saved on this device. Reconnect to get new marks,
            attendance and notices.
          </p>
        ) : null}
      </section>

      <section className="student-about-card">
        <span className="student-about-icon">
          <Info size={18} />
        </span>
        <div>
          <strong>Xchool Student Portal</strong>
          <p>
            Read-only access to your own school record. Version 1.0 ·{' '}
            {data.meta.academicYear || 'current year'}.
          </p>
        </div>
      </section>

      <button type="button" className="btn btn-danger-ghost btn-block" onClick={signOut}>
        <LogOut size={16} /> Sign out
      </button>

      <p className="student-footnote">
        Need help? Contact the school office
        {data.meta.phone ? ` on ${data.meta.phone}` : ''}.
      </p>
    </div>
  );
}
