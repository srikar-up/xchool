import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '../lib/api';
import Toast from '../components/Toast';

const StudentDataContext = createContext(null);
const SESSION_KEY = 'xchool.student.session.v1';
const CACHE_KEY = 'xchool.student.state.v1';

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(state) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {
    /* Storage can be full or disabled; the app still works online. */
  }
}

function writeSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* The in-memory session still works. */
  }
}

export function StudentDataProvider({ children }) {
  const [session, setSession] = useState(readSession);
  const [data, setData] = useState(() => readCache());
  const [loading, setLoading] = useState(Boolean(readSession() && !readCache()));
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [live, setLive] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const hasDataRef = useRef(Boolean(data));
  const studentId = session?.student?.id || null;
  const studentIdRef = useRef(studentId);
  studentIdRef.current = studentId;
  const dataRef = useRef(data);

  useEffect(() => {
    hasDataRef.current = Boolean(data);
    dataRef.current = data;
  }, [data]);

  const notify = useCallback((message, type = 'success') => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message, type });
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const dismissToast = useCallback(() => {
    window.clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  const logout = useCallback(() => {
    api.logout?.().catch(() => {
      /* Firebase may already be signed out; local state is what matters. */
    });
    writeSession(null);
    localStorage.removeItem(CACHE_KEY);
    setSession(null);
    setData(null);
    setOffline(false);
    setLive(false);
  }, []);

  const refresh = useCallback(
    async ({ silent = false } = {}) => {
      if (!studentIdRef.current) return null;
      if (!silent) setRefreshing(true);
      try {
        const state = await api.getBootstrap();
        setData(state);
        hasDataRef.current = true;
        setSession((previous) => {
          if (!previous) return previous;
          const next = {
            ...previous,
            student: { ...previous.student, ...state.student },
          };
          writeSession(next);
          return next;
        });
        writeCache(state);
        setOffline(false);
        setLastSyncedAt(new Date());
        return state;
      } catch (error) {
        if (error.status === 401 || error.status === 403) {
          logout();
        } else {
          setOffline(true);
        }
        return null;
      } finally {
        if (!silent) setRefreshing(false);
        setLoading(false);
      }
    },
    [logout]
  );

  const finishLogin = useCallback(async (result) => {
    const next = {
      student: result.student,
      permissions: result.permissions || { student: true, photo: true },
    };
    writeSession(next);
    setSession(next);
    studentIdRef.current = result.student.id;
    const state = await api.getBootstrap();
    setData(state);
    hasDataRef.current = true;
    writeCache(state);
    setLastSyncedAt(new Date());
    setOffline(false);
    setLoading(false);
    return next;
  }, []);

  const login = useCallback(
    async (email, password) => {
      setLoading(true);
      try {
        return await finishLogin(await api.login(email, password));
      } catch (error) {
        setLoading(false);
        throw error;
      }
    },
    [finishLogin]
  );

  const loginWithGoogle = useCallback(async () => {
    setLoading(true);
    try {
      return await finishLogin(await api.loginWithGoogle());
    } catch (error) {
      setLoading(false);
      throw error;
    }
  }, [finishLogin]);

  useEffect(() => {
    if (!studentId) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let changeTimer = null;
    let retryTimer = null;
    let revisionTimer = null;
    let controller = null;

    setLoading(!hasDataRef.current);
    refresh();

    const checkRevision = async () => {
      if (cancelled || !dataRef.current) return;
      try {
        const health = await api.health();
        const local = Number(dataRef.current.revision || 0);
        if (Number(health.revision) > local) refresh({ silent: true });
      } catch {
        /* SSE reconnects on its own; a failed poll is harmless. */
      }
    };

    const onOnline = () => refresh({ silent: true });
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkRevision();
    };

    const scheduleRetry = () => {
      if (cancelled) return;
      setLive(false);
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(connect, 4000);
    };

    const connect = async () => {
      if (cancelled) return;
      controller = new AbortController();

      try {
        await api.streamEvents({
          signal: controller.signal,
          onOpen: () => {
            if (cancelled) return;
            setLive(true);
            setOffline(false);
          },
          onEvent: ({ event, data: raw }) => {
            if (cancelled || event !== 'change') return;
            let change = null;
            try {
              change = JSON.parse(raw);
            } catch {
              change = null;
            }
            if (change?.revoked) {
              logout();
              return;
            }
            window.clearTimeout(changeTimer);
            changeTimer = window.setTimeout(() => refresh({ silent: true }), 220);
          },
        });
        scheduleRetry();
      } catch (error) {
        if (cancelled || error.name === 'AbortError') return;
        scheduleRetry();
      }
    };

    connect();
    revisionTimer = window.setInterval(checkRevision, 5 * 60 * 1000);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearTimeout(changeTimer);
      window.clearTimeout(retryTimer);
      window.clearInterval(revisionTimer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      controller?.abort();
      setLive(false);
    };
  }, [studentId, refresh, logout]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const value = useMemo(
    () => ({
      session,
      user: data?.student || session?.student || null,
      data,
      loading,
      refreshing,
      offline,
      live,
      lastSyncedAt,
      login,
      loginWithGoogle,
      logout,
      refresh,
      notify,
      toast,
      dismissToast,
    }),
    [
      session,
      data,
      loading,
      refreshing,
      offline,
      live,
      lastSyncedAt,
      login,
      loginWithGoogle,
      logout,
      refresh,
      notify,
      toast,
      dismissToast,
    ]
  );

  return (
    <StudentDataContext.Provider value={value}>
      {children}
      <Toast toast={toast} onClose={dismissToast} />
    </StudentDataContext.Provider>
  );
}

export function useStudentData() {
  const context = useContext(StudentDataContext);
  if (!context) throw new Error('useStudentData must be used inside StudentDataProvider');
  return context;
}
