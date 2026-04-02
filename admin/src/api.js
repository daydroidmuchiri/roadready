const API = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export const api = {
  baseUrl: API,
  token: () => localStorage.getItem('rr_admin_token'),
  headers: () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${api.token()}`,
  }),
  get: (path) =>
    fetch(API + path, { headers: api.headers() }).then(r => {
      if (r.status === 401) {
        localStorage.removeItem('rr_admin_token');
        window.location.reload();
      }
      return r.json();
    }),
  post: (path, body) =>
    fetch(API + path, {
      method: 'POST',
      headers: api.headers(),
      body: JSON.stringify(body),
    }).then(r => r.json()),
};
