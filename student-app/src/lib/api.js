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
  /**
   * Signs in with Firebase Auth, then asks the API for the linked student
   * profile. A staff account gets 403 here and is signed out again.
   */
  login: async (email, password) => {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    await credential.user.getIdToken();
    try {
      return await request('/api/student/me');
    } catch (error) {
      await signOut(auth).catch(() => {});
      throw error;
    }
  },

  me: () => request('/api/student/me'),
  getBootstrap: () => request('/api/student/bootstrap'),
  /**
   * School-wide switches. Public on purpose: the login screen has to know
   * whether the portal is open before anyone can sign in.
   */
  publicConfig: async () => {
    const response = await fetch(`${API_BASE}/api/public/config`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Cannot read the school configuration.');
    return response.json();
  },
  getChanges: (since) =>
    request(`/api/student/changes?since=${encodeURIComponent(since)}`),
  health: async () => {
    const response = await fetch(`${API_BASE}/api/health`, { cache: 'no-store' });
    return response.json();
  },
  logout: () => signOut(auth),

  /* ---- own profile photo ---- */
  signCloudinary: (kind, id) =>
    request('/api/auth/cloudinary-sign', { method: 'POST', body: { kind, id } }),
  setPhoto: (_kind, id, photo) =>
    request(`/api/students/${id}/photo`, { method: 'PATCH', body: photo }),
  deletePhoto: (_kind, id) => request(`/api/students/${id}/photo`, { method: 'DELETE' }),

  /**
   * Reuters the scoped bootstrap when the server says the revision changed.
   * Only a revision and a `full` flag travel on the stream, never records.
   */
  streamEvents: async ({ signal, onOpen, onEvent } = {}) => {
    await auth?.authStateReady?.();
    const token = auth?.currentUser ? await auth.currentUser.getIdToken() : '';

    const response = await fetch(`${API_BASE}/api/student/events`, {
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
