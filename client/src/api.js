let token = localStorage.getItem('tf_token') || '';

export const setToken = (t) => {
  token = t;
  if (t) localStorage.setItem('tf_token', t); else localStorage.removeItem('tf_token');
};
export const hasToken = () => Boolean(token);

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) { setToken(''); location.reload(); }
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}
