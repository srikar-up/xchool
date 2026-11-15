import {
  CalendarDays,
  GraduationCap,
  IdCard,
  LogOut,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStudentData } from '../context/StudentDataContext';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import PageHead from '../components/PageHead';
import PhotoPicker from '../components/PhotoPicker';
import { formatDate } from '../lib/format';

export default function Profile() {
  const { data, user, refresh, logout, notify } = useStudentData();
  const navigate = useNavigate();

  const signOut = () => {
    logout();
    notify('Signed out of the student portal.', 'info');
    navigate('/login', { replace: true });
  };

  return (
    <div className="t-page">
      <PageHead
        backTo="/more"
        eyebrow="My account"
        title="Profile"
        subtitle={data.class?.displayName || user?.classIdSection}
      />

      <section className="card student-profile-card">
        <PhotoPicker
          kind="students"
          id={user?.id}
          name={user?.name || 'Student'}
          photo={user?.photo}
          size={96}
          onSaved={async () => {
            await refresh({ silent: true });
            notify('Profile photo updated.', 'success');
          }}
        />
        <div className="student-profile-identity">
          <h2>{user?.name}</h2>
          <p>
            {data.class?.displayName || user?.classIdSection} · Roll {user?.rollNumber}
          </p>
          <div className="student-profile-badges">
            <Badge tone="brand">{user?.code}</Badge>
            <Badge tone={user?.status === 'Active' ? 'success' : 'neutral'}>
              {user?.status || 'Active'}
            </Badge>
            <Badge tone={user?.authDisabled ? 'warning' : 'success'} icon={ShieldCheck}>
              {user?.authDisabled ? 'Portal disabled' : 'Portal active'}
            </Badge>
          </div>
        </div>
      </section>

      <section className="card student-profile-details">
        <div className="student-detail-row">
          <span>
            <IdCard size={15} /> School ID
          </span>
          <strong>{user?.code}</strong>
        </div>
        <div className="student-detail-row">
          <span>
            <GraduationCap size={15} /> Class
          </span>
          <strong>
            {data.class?.displayName || user?.classIdSection} · Roll {user?.rollNumber}
          </strong>
        </div>
        <div className="student-detail-row">
          <span>
            <CalendarDays size={15} /> Admission date
          </span>
          <strong>{user?.admissionDate ? formatDate(user.admissionDate) : 'Not recorded'}</strong>
        </div>
        <div className="student-detail-row">
          <span>
            <CalendarDays size={15} /> Date of birth
          </span>
          <strong>{user?.dateOfBirth ? formatDate(user.dateOfBirth) : 'Not recorded'}</strong>
        </div>
        <div className="student-detail-row">
          <span>
            <UserRound size={15} /> Guardian
          </span>
          <strong>{user?.guardianName || 'Not recorded'}</strong>
        </div>
        <div className="student-detail-row">
          <span>
            <Phone size={15} /> Guardian phone
          </span>
          <strong>{user?.parentPhone || 'Not recorded'}</strong>
        </div>
        <div className="student-detail-row">
          <span>
            <Mail size={15} /> Portal email
          </span>
          <strong>{user?.authEmail || 'Not linked'}</strong>
        </div>
        <div className="student-detail-row">
          <span>
            <MapPin size={15} /> Home address
          </span>
          <strong>{user?.address || 'Not recorded'}</strong>
        </div>
      </section>

      <section className="card student-profile-note">
        <Avatar name={user?.name} size={34} photo={user?.photo} />
        <p>
          Your record is maintained by the school office. Ask your class teacher or the
          office if any detail needs correcting.
        </p>
      </section>

      <button type="button" className="btn btn-danger-ghost btn-block" onClick={signOut}>
        <LogOut size={16} /> Sign out
      </button>
    </div>
  );
}
