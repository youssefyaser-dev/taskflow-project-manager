import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

export async function start(opts = {}) {
  const db = openDb();
  const app = createApp(db, { secret: 'test-secret', ...opts });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, token) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* csv or plain text */ }
    return { status: res.status, body: parsed, headers: res.headers };
  };
  const register = async (email, name = email.split('@')[0]) => {
    const r = await call('POST', '/api/auth/register', { name, email, password: 'password123' });
    const ws = (await call('GET', '/api/workspaces', null, r.body.token)).body[0];
    return { token: r.body.token, id: r.body.user.id, ws: ws.id };
  };
  return { call, db, register, close: () => { server.closeAllConnections?.(); server.close(); } };
}
