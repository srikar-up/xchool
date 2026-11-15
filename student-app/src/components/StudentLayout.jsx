import { Outlet } from 'react-router-dom';
import { RefreshCw, WifiOff } from 'lucide-react';
import { useStudentData } from '../context/StudentDataContext';
import BottomNav from './BottomNav';
import { relativeTime } from '../lib/format';

export default function StudentLayout() {
  const { offline, refresh, refreshing, lastSyncedAt } = useStudentData();

  return (
    <div className="t-shell">
      {offline ? (
        <div className="offline-banner" role="status">
          <WifiOff size={15} />
          <span>
            Offline preview
            {lastSyncedAt ? ` · last synced ${relativeTime(lastSyncedAt.toISOString())}` : ''}
          </span>
          <button type="button" onClick={() => refresh()} disabled={refreshing}>
            <RefreshCw size={13} className={refreshing ? 'spin' : ''} />
            Retry
          </button>
        </div>
      ) : null}
      <main className="t-main">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
