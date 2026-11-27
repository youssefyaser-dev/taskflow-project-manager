import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';

async function team() {
  const s = await start();
  const owner = await s.register('owner@example.com', 'Owner');
  const join = async (email, role) => {
    const u = await s.register(email);
    const inv = (await s.call('POST', `/api/workspaces/${owner.ws}/invites`, { email, role }, owner.token)).body;
    await s.call('POST', '/api/invites/accept', { code: inv.code }, u.token);
    return u;
  };
  const admin = await join('admin@example.com', 'admin');
  const member = await join('member@example.com', 'member');
  const viewer = await join('viewer@example.com', 'viewer');
  const outsider = await s.register('outsider@example.com');
  const p = (await s.call('POST', `/api/workspaces/${owner.ws}/projects`, { name: 'Core' }, owner.token)).body;
  const t = (await s.call('POST', `/api/projects/${p.id}/tasks`, { title: 'Secret' }, owner.token)).body;
  return { ...s, owner, admin, member, viewer, outsider, p, t };
}

test('outsiders cannot see anything in the workspace', async () => {
  const { call, close, outsider, owner, p, t } = await team();
  for (const [m, u] of [['GET', `/api/workspaces/${owner.ws}/members`], ['GET', `/api/projects/${p.id}/tasks`], ['GET', `/api/tasks/${t.id}`],
    ['GET', `/api/projects/${p.id}/export.csv`], ['GET', `/api/workspaces/${owner.ws}/activity`]]) {
    assert.equal((await call(m, u, null, outsider.token)).status, 404, u);
  }
  assert.equal((await call('PATCH', `/api/tasks/${t.id}`, { title: 'x' }, outsider.token)).status, 404);
  assert.equal((await call('DELETE', `/api/projects/${p.id}`, null, outsider.token)).status, 404);
  close();
});

test('role matrix: viewer reads, member edits tasks, admin manages projects', async () => {
  const { call, close, viewer, member, admin, owner, p, t } = await team();
  assert.equal((await call('GET', `/api/projects/${p.id}/tasks`, null, viewer.token)).status, 200);
  assert.equal((await call('PATCH', `/api/tasks/${t.id}`, { title: 'x' }, viewer.token)).status, 403);
  assert.equal((await call('POST', `/api/tasks/${t.id}/comments`, { body: 'hi' }, viewer.token)).status, 403);
  assert.equal((await call('PATCH', `/api/tasks/${t.id}`, { title: 'Edited' }, member.token)).status, 200);
  assert.equal((await call('POST', `/api/workspaces/${owner.ws}/projects`, { name: 'New' }, member.token)).status, 403);
  assert.equal((await call('DELETE', `/api/projects/${p.id}`, null, member.token)).status, 403);
  assert.equal((await call('POST', `/api/workspaces/${owner.ws}/projects`, { name: 'New' }, admin.token)).status, 201);
  assert.equal((await call('DELETE', `/api/projects/${p.id}`, null, admin.token)).status, 204);
  close();
});

test('invites: only matching email accepts, code works once, only the owner invites admins', async () => {
  const { call, close, register, owner, admin } = await team();
  const bob = await register('bob@example.com'); const mal = await register('mal@example.com');
  assert.equal((await call('POST', `/api/workspaces/${owner.ws}/invites`, { email: 'x@example.com', role: 'admin' }, admin.token)).status, 403);
  assert.equal((await call('POST', `/api/workspaces/${owner.ws}/invites`, { email: 'x@example.com', role: 'owner' }, owner.token)).status, 400);
  assert.equal((await call('POST', `/api/workspaces/${owner.ws}/invites`, { email: 'admin@example.com' }, owner.token)).status, 409);
  const inv = (await call('POST', `/api/workspaces/${owner.ws}/invites`, { email: 'bob@example.com', role: 'viewer' }, admin.token)).body;
  assert.equal((await call('POST', '/api/invites/accept', { code: inv.code }, mal.token)).status, 404);
  assert.equal((await call('POST', '/api/invites/accept', { code: inv.code }, bob.token)).body.role, 'viewer');
  assert.equal((await call('POST', '/api/invites/accept', { code: inv.code }, bob.token)).status, 404);
  assert.equal((await call('GET', `/api/workspaces/${owner.ws}/invites`, null, admin.token)).body.length, 0);
  close();
});

test('member management rules', async () => {
  const { call, close, owner, admin, member } = await team();
  const url = (u) => `/api/workspaces/${owner.ws}/members/${u.id}`;
  assert.equal((await call('PATCH', url(member), { role: 'admin' }, admin.token)).status, 403);
  assert.equal((await call('PATCH', url(member), { role: 'viewer' }, admin.token)).status, 200);
  assert.equal((await call('PATCH', url(owner), { role: 'member' }, admin.token)).status, 400);
  assert.equal((await call('PATCH', url(member), { role: 'admin' }, owner.token)).status, 200);
  assert.equal((await call('DELETE', url(owner), null, admin.token)).status, 400);
  assert.equal((await call('DELETE', url(admin), null, member.token)).status, 403);
  assert.equal((await call('DELETE', url(member), null, member.token)).status, 204); // leave
  assert.equal((await call('GET', `/api/workspaces/${owner.ws}/members`, null, member.token)).status, 404);
  const members = (await call('GET', `/api/workspaces/${owner.ws}/members`, null, owner.token)).body;
  assert.deepEqual(members.map((m) => m.role), ['owner', 'admin', 'viewer']);
  close();
});

test('removing a member unassigns their tasks and activity is recorded', async () => {
  const { call, close, owner, member, t } = await team();
  await call('PATCH', `/api/tasks/${t.id}`, { assignee_id: member.id }, owner.token);
  await call('DELETE', `/api/workspaces/${owner.ws}/members/${member.id}`, null, owner.token);
  assert.equal((await call('GET', `/api/tasks/${t.id}`, null, owner.token)).body.assignee_id, null);
  const acts = (await call('GET', `/api/workspaces/${owner.ws}/activity`, null, owner.token)).body.map((a) => a.action);
  assert.ok(acts.includes('member.removed') && acts.includes('task.assigned') && acts.includes('member.joined'));
  close();
});

test('deleting a project cascades to its tasks', async () => {
  const { call, close, owner, p, t } = await team();
  await call('DELETE', `/api/projects/${p.id}`, null, owner.token);
  assert.equal((await call('GET', `/api/tasks/${t.id}`, null, owner.token)).status, 404);
  close();
});
