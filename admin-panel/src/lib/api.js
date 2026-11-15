import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from './firebase';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

async function authHeaders() {
  // Wait for Firebase to restore the persisted session before the first call.
  await auth?.authStateReady?.();
  const user = auth?.currentUser;
  if (!user) return {};
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

async function requestOnce(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json', ...(await authHeaders()) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Cannot reach the school server. Check the connection and try again.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(
      payload?.error || `The school server rejected this request (${response.status}).`
    );
    error.status = response.status;
    error.payload = payload;
    error.errors = payload?.errors;
    throw error;
  }
  return payload;
}

/**
 * Retries while a cold Worker isolate is still booting. The API answers 503
 * with Retry-After until the D1 snapshot is loaded; a first visit can land in
 * that window.
 */
async function request(path, options) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestOnce(path, options);
    } catch (error) {
      if (error.status === 503 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      throw error;
    }
  }
}

export const api = {
  /** Signs in with Firebase Auth; the ID token is sent as a Bearer header. */
  login: async (email, password) => {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    await credential.user.getIdToken();
    return request('/api/me');
  },
  me: () => request('/api/me'),
  logout: () => signOut(auth),

  /**
   * Full working set, or only the slices requested with `include`.
   * Screens that need one table should prefer the targeted endpoints.
   */
  getState: (_staffId, { signal, include } = {}) => {
    const query = include?.length
      ? `?include=${encodeURIComponent(include.join(','))}`
      : '';
    return request(`/api/state${query}`, { signal });
  },
  getBootstrap: () => request('/api/bootstrap'),
  getChanges: (since) => request(`/api/changes?since=${encodeURIComponent(since)}`),
  health: async () => {
    const response = await fetch(`${API_BASE}/api/health`, { cache: 'no-store' });
    return response.json();
  },

  /** Advanced settings: the school-wide student portal switch. */
  setStudentPortal: (studentPortalEnabled) =>
    request('/api/access', { method: 'PATCH', body: { studentPortalEnabled } }),

  /** Developer console: per-account request counters. */
  getTelemetry: () => request('/api/telemetry'),

  /** Blocks or unblocks one account (staff or student) from the API. */
  blockAccount: (payload) =>
    request('/api/telemetry/block', { method: 'POST', body: payload }),
  getStudents: (params = {}) =>
    request(`/api/students?${new URLSearchParams(params).toString()}`),
  getAttendance: (params = {}) =>
    request(`/api/attendance?${new URLSearchParams(params).toString()}`),
  getExamResults: (examId) => request(`/api/exams/${examId}/results`),

  saveAttendance: (_staffId, payload) => request('/api/attendance', { method: 'POST', body: payload }),

  createStudent: (_staffId, payload) => request('/api/students', { method: 'POST', body: payload }),
  updateStudent: (_staffId, id, payload) =>
    request(`/api/students/${id}`, { method: 'PATCH', body: payload }),
  deleteStudent: (_staffId, id) => request(`/api/students/${id}`, { method: 'DELETE' }),
  createStudentLogin: (_staffId, id, payload) =>
    request(`/api/students/${id}/login`, { method: 'POST', body: payload }),
  disableStudentLogin: (_staffId, id) =>
    request(`/api/students/${id}/login`, { method: 'DELETE' }),
  bulkStudents: (_staffId, rows) =>
    request('/api/students/bulk', { method: 'POST', body: { rows } }),

  createStaff: (_staffId, payload) => request('/api/staff', { method: 'POST', body: payload }),
  updateStaff: (_staffId, id, payload) =>
    request(`/api/staff/${id}`, { method: 'PATCH', body: payload }),
  deleteStaff: (_staffId, id) => request(`/api/staff/${id}`, { method: 'DELETE' }),

  createExam: (_staffId, payload) => request('/api/exams', { method: 'POST', body: payload }),
  updateExam: (_staffId, id, payload) =>
    request(`/api/exams/${id}`, { method: 'PATCH', body: payload }),
  deleteExam: (_staffId, id) => request(`/api/exams/${id}`, { method: 'DELETE' }),

  assignSubjectTeacher: (_staffId, subjectId, assignedStaffId) =>
    request(`/api/subjects/${subjectId}`, { method: 'PATCH', body: { assignedStaffId } }),

  createCurriculum: (_staffId, payload) =>
    request('/api/curricula', { method: 'POST', body: payload }),
  updateCurriculum: (_staffId, id, payload) =>
    request(`/api/curricula/${id}`, { method: 'PATCH', body: payload }),
  applyCurriculum: (_staffId, id, sections) =>
    request(`/api/curricula/${id}/apply`, { method: 'POST', body: { sections } }),
  deleteCurriculum: (_staffId, id) =>
    request(`/api/curricula/${id}`, { method: 'DELETE' }),

  saveTimetableCell: (_staffId, payload) =>
    request('/api/timetable', { method: 'PUT', body: payload }),
  deleteTimetableCell: (_staffId, id) => request(`/api/timetable/${id}`, { method: 'DELETE' }),
  updateTimetableSettings: (_staffId, payload) =>
    request('/api/timetable/settings', { method: 'PATCH', body: payload }),

  createAssignment: (_staffId, payload) =>
    request('/api/assignments', { method: 'POST', body: payload }),
  updateAssignment: (_staffId, id, payload) =>
    request(`/api/assignments/${id}`, { method: 'PATCH', body: payload }),
  deleteAssignment: (_staffId, id) => request(`/api/assignments/${id}`, { method: 'DELETE' }),

  createAnnouncement: (_staffId, payload) =>
    request('/api/announcements', { method: 'POST', body: payload }),
  updateAnnouncement: (_staffId, id, payload) =>
    request(`/api/announcements/${id}`, { method: 'PATCH', body: payload }),
  deleteAnnouncement: (_staffId, id) => request(`/api/announcements/${id}`, { method: 'DELETE' }),

  updateRequest: (_staffId, id, payload) =>
    request(`/api/rms/${id}`, { method: 'PATCH', body: payload }),

  updateMeta: (_staffId, payload) => request('/api/meta', { method: 'PATCH', body: payload }),
  importData: (_staffId, payload) => request('/api/import', { method: 'POST', body: payload }),
  resetDemo: (_staffId) => request('/api/reset', { method: 'POST' }),

  /* ---- profile photos ---- */
  signCloudinary: (kind, id) =>
    request('/api/auth/cloudinary-sign', { method: 'POST', body: { kind, id } }),
  setPhoto: (kind, id, photo) =>
    request(`/api/${kind}/${id}/photo`, { method: 'PATCH', body: photo }),
  deletePhoto: (kind, id) => request(`/api/${kind}/${id}/photo`, { method: 'DELETE' }),

  /**
   * Live sync over a fetch stream instead of EventSource.
   *
   * EventSource cannot set headers, which used to force the ID token into the
   * query string - and therefore into proxy and server access logs. Fetch can
   * send the normal Authorization header, so the token never appears in a URL.
   *
   * Resolves when the server closes the stream; rejects on network/auth errors.
   */
  streamEvents: async ({ signal, onOpen, onEvent } = {}) => {
    await auth?.authStateReady?.();
    const token = auth?.currentUser ? await auth.currentUser.getIdToken() : '';

    const response = await fetch(`${API_BASE}/api/events`, {
      method: 'GET',
      headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
      signal,
      cache: 'no-store',
    });

    if (!response.ok || !response.body) {
      throw new Error(`Live sync unavailable (${response.status}).`);
    }

    onOpen?.();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSseBlock(block);
        if (parsed) onEvent?.(parsed);
        boundary = buffer.indexOf('\n\n');
      }
    }
  },
};

/** Reads one SSE block into { event, data }. Comment lines are ignored. */
function parseSseBlock(block) {
  let event = 'message';
  const data = [];

  block.split(/\r?\n/).forEach((line) => {
    if (!line || line.startsWith(':')) return;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  });

  if (!data.length) return null;
  return { event, data: data.join('\n') };
}

export { API_BASE };
