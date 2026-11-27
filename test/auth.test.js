import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../server/auth.js';

test('password hashing is salted and verifies', () => {
  const a = hashPassword('secret-pass'); const b = hashPassword('secret-pass');
  assert.notEqual(a, b);
  assert.ok(verifyPassword('secret-pass', a));
  assert.ok(!verifyPassword('other', a));
  assert.ok(!verifyPassword('x', 'garbage'));
});

test('tokens expire and reject tampering', () => {
  const t = signToken({ uid: 1 }, 's');
  assert.equal(verifyToken(t, 's').uid, 1);
  assert.equal(verifyToken(t, 'other'), null);
  assert.equal(verifyToken(t.slice(0, -2) + 'xx', 's'), null);
  assert.equal(verifyToken(signToken({ uid: 1 }, 's', -5), 's'), null);
  assert.equal(verifyToken(undefined, 's'), null);
});

test('register creates a personal workspace; login is case-insensitive on email', async () => {
  const { call, close } = await start();
  const r = await call('POST', '/api/auth/register', { name: 'Ana', email: 'a@example.com', password: 'password123' });
  assert.equal(r.status, 201);
  assert.equal((await call('GET', '/api/workspaces', null, r.body.token)).body[0].role, 'owner');
  assert.equal((await call('POST', '/api/auth/register', { name: 'Ana', email: 'a@example.com', password: 'password123' })).status, 409);
  assert.equal((await call('POST', '/api/auth/login', { email: 'a@example.com', password: 'nope' })).status, 401);
  const l = await call('POST', '/api/auth/login', { email: 'A@Example.com', password: 'password123' });
  assert.equal(l.status, 200);
  assert.equal((await call('GET', '/api/me', null, l.body.token)).body.email, 'a@example.com');
  assert.equal((await call('GET', '/api/me')).status, 401);
  close();
});

test('registration validation', async () => {
  const { call, close } = await start();
  assert.equal((await call('POST', '/api/auth/register', { name: 'x', email: 'bad', password: 'password123' })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', { name: 'x', email: 'x@y.co', password: 'short' })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', { email: 'x@y.co', password: 'password123' })).status, 400);
  close();
});

test('auth endpoints are rate limited', async () => {
  const { call, close } = await start({ authLimit: { windowMs: 60_000, max: 3 } });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await call('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' })).status);
  assert.deepEqual(codes, [401, 401, 401, 429, 429]);
  close();
});
