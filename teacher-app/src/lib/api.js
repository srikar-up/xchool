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
    throw new Error('Cannot reach the school server. Check your connection and try again.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.error || `The school server rejected this request (${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
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
  getStudents: (params = {}) =>
    request(`/api/students?${new URLSearchParams(params).toString()}`),
  getAttendance: (params = {}) =>
    request(`/api/attendance?${new URLSearchParams(params).toString()}`),
  getExamResults: (examId) => request(`/api/exams/${examId}/results`),
  saveAttendance: (_staffId, payload) =>
    request('/api/attendance', { method: 'POST', body: payload }),
  submitMarks: (_staffId, examId, records) =>
    request(`/api/exams/${examId}/marks`, { method: 'POST', body: { records } }),
  updateChapter: (_staffId, subjectId, chapterIndex, status) =>
    request(`/api/subjects/${subjectId}/chapters`, {
      method: 'POST',
      body: { chapterIndex, status },
    }),
  saveReportRemark: (_staffId, studentId, text) =>
    request(`/api/students/${studentId}/remark`, { method: 'PATCH', body: { text } }),
  updateStudent: (_staffId, studentId, payload) =>
    request(`/api/students/${studentId}`, { method: 'PATCH', body: payload }),
  createAssignment: (_staffId, payload) =>
    request('/api/assignments', { method: 'POST', body: payload }),
  updateAssignment: (_staffId, assignmentId, payload) =>
    request(`/api/assignments/${assignmentId}`, { method: 'PATCH', body: payload }),
  deleteAssignment: (_staffId, assignmentId) =>
    request(`/api/assignments/${assignmentId}`, { method: 'DELETE' }),
  createRequest: (_staffId, payload) => request('/api/rms', { method: 'POST', body: payload }),

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
