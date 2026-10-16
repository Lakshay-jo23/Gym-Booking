// Talks to the backend and remembers who is logged in.

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', details = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details; // { field: message } from the server's validation
  }
}

const TOKEN_KEY = 'gym.token';
const USER_KEY = 'gym.user';

// localStorage can throw (private mode, blocked), so every access is guarded
export const auth = {
  get token() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  get user() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } },
  set({ token, user }) {
    try { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* ignore */ }
  },
  clear() {
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
  },
};

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(auth.token ? { Authorization: 'Bearer ' + auth.token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', { code: 'NETWORK' });
  }

  let data = null;
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }

  if (!res.ok) {
    // An expired/invalid token anywhere except the login forms means: log in again
    if (res.status === 401 && auth.token && !path.startsWith('/auth/')) {
      auth.clear();
      onUnauthorized();
    }
    throw new ApiError(data?.error?.message || `Request failed (${res.status})`, {
      status: res.status,
      code: data?.error?.code,
      details: data?.error?.details,
    });
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  del: (path) => request('DELETE', path),
};
