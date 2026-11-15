import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useStudentData } from '../context/StudentDataContext';
import AppLoading from '../components/AppLoading';

export default function RequireAuth() {
  const { session, data, loading, offline, refresh, refreshing } = useStudentData();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (loading && !data) {
    return <AppLoading label="Loading your student portal" />;
  }
  if (!data) {
    return (
      <div className="app-loading">
        <div className="app-loading-brand">
          <img
            src={`${import.meta.env.BASE_URL}school-logo.jpg`}
            alt="Xchool crest"
            className="app-loading-logo"
          />
          <div className="app-loading-name">
            <strong>Xchool</strong>
            <small>Student portal</small>
          </div>
        </div>
        <p>{offline ? 'The school server is not reachable.' : 'Your student data is not ready yet.'}</p>
        <p className="app-loading-hint">
          Attendance, marks and notices are loaded fresh each time. Check your connection and try
          again.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => refresh()}
          disabled={refreshing}
        >
          {refreshing ? 'Connecting…' : 'Try again'}
        </button>
      </div>
    );
  }
  return <Outlet />;
}

export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}
