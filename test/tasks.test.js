import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';

async function setup() {
  const s = await start();
  const a = await s.register('ana@example.com', 'Ana');
  const p = (await s.call('POST', `/api/workspaces/${a.ws}/projects`, { name: 'Site' }, a.token)).body;
  return { ...s, a, p };
}

test('task lifecycle, ordering and completion timestamps', async () => {
  const { call, close, a, p } = await setup();
  const t1 = (await call('POST', `/api/projects/${p.id}/tasks`, { title: 'One', priority: 'high', due_date: '2020-01-01' }, a.token)).body;
  const t2 = (await call('POST', `/api/projects/${p.id}/tasks`, { title: 'Two' }, a.token)).body;
  assert.equal(t2.position, t1.position + 1);
  assert.equal((await call('POST', `/api/projects/${p.id}/tasks`, { title: '' }, a.token)).status, 400);
  assert.equal((await call('POST', `/api/projects/${p.id}/tasks`, { title: 'x', due_date: '2020-13-45' }, a.token)).status, 400);
  const done = (await call('PATCH', `/api/tasks/${t1.id}`, { status: 'done' }, a.token)).body;
  assert.ok(done.completed_at);
  assert.equal((await call('PATCH', `/api/tasks/${t1.id}`, { status: 'bogus' }, a.token)).status, 400);
  assert.equal((await call('PATCH', `/api/tasks/${t1.id}`, { status: 'doing' }, a.token)).body.completed_at, null);
  assert.equal((await call('DELETE', `/api/tasks/${t2.id}`, null, a.token)).status, 204);
  assert.equal((await call('GET', `/api/projects/${p.id}/tasks`, null, a.token)).body.length, 1);
  close();
});

test('filters: status, priority, search and assignee', async () => {
  const { call, close, a, p } = await setup();
  const mk = (b) => call('POST', `/api/projects/${p.id}/tasks`, b, a.token);
  await mk({ title: 'Login page', priority: 'high' });
  await mk({ title: 'Billing', priority: 'low', status: 'doing', assignee_id: a.id });
  await mk({ title: 'Search box', description: 'login related', priority: 'low' });
  const get = async (qs) => (await call('GET', `/api/projects/${p.id}/tasks?${qs}`, null, a.token)).body.map((t) => t.title);
  assert.deepEqual(await get('status=doing'), ['Billing']);
  assert.deepEqual(await get('priority=low&status=todo'), ['Search box']);
  assert.deepEqual((await get('q=login')).sort(), ['Login page', 'Search box']);
  assert.deepEqual(await get('assignee=me'), ['Billing']);
  assert.deepEqual((await get('assignee=none')).sort(), ['Login page', 'Search box']);
  assert.equal((await call('GET', `/api/projects/${p.id}/tasks?status=nope`, null, a.token)).status, 400);
  close();
});

test('assignee must belong to the workspace and gets a notification', async () => {
  const { call, close, register, a, p } = await setup();
  const b = await register('bob@example.com', 'Bob');
  const t = (await call('POST', `/api/projects/${p.id}/tasks`, { title: 'X', assignee_id: b.id }, a.token));
  assert.equal(t.status, 400);
  const inv = (await call('POST', `/api/workspaces/${a.ws}/invites`, { email: 'bob@example.com', role: 'member' }, a.token)).body;
  assert.equal((await call('POST', '/api/invites/accept', { code: inv.code }, b.token)).status, 200);
  const t2 = (await call('POST', `/api/projects/${p.id}/tasks`, { title: 'X', assignee_id: b.id }, a.token)).body;
  const n = (await call('GET', '/api/notifications', null, b.token)).body;
  assert.equal(n.unread, 1);
  assert.match(n.items[0].text, /assigned/);
  await call('POST', '/api/notifications/read', null, b.token);
  assert.equal((await call('GET', '/api/notifications', null, b.token)).body.unread, 0);
  // self-assignment does not notify
  await call('PATCH', `/api/tasks/${t2.id}`, { assignee_id: a.id }, a.token);
  assert.equal((await call('GET', '/api/notifications', null, a.token)).body.unread, 0);
  close();
});

test('labels, subtasks, time tracking and task detail', async () => {
  const { call, close, a, p } = await setup();
  const lab = (await call('POST', `/api/workspaces/${a.ws}/labels`, { name: 'Bug', color: '#ef4444' }, a.token)).body;
  assert.equal((await call('POST', `/api/workspaces/${a.ws}/labels`, { name: 'Bug' }, a.token)).status, 409);
  const t = (await call('POST', `/api/projects/${p.id}/tasks`, { title: 'Fix' }, a.token)).body;
  assert.equal((await call('PUT', `/api/tasks/${t.id}/labels`, { label_ids: [lab.id, 9999] }, a.token)).status, 400);
  await call('PUT', `/api/tasks/${t.id}/labels`, { label_ids: [lab.id] }, a.token);
  const s1 = (await call('POST', `/api/tasks/${t.id}/subtasks`, { title: 'Reproduce' }, a.token)).body;
  await call('POST', `/api/tasks/${t.id}/subtasks`, { title: 'Patch' }, a.token);
  await call('PATCH', `/api/subtasks/${s1.id}`, { done: true }, a.token);
  assert.equal((await call('POST', `/api/tasks/${t.id}/time`, { minutes: 0 }, a.token)).status, 400);
  await call('POST', `/api/tasks/${t.id}/time`, { minutes: 45, note: 'debug' }, a.token);
  await call('POST', `/api/tasks/${t.id}/time`, { minutes: 30 }, a.token);
  const list = (await call('GET', `/api/projects/${p.id}/tasks`, null, a.token)).body[0];
  assert.equal(list.subtask_total, 2); assert.equal(list.subtask_done, 1); assert.equal(list.logged_min, 75);
  assert.equal(list.labels[0].name, 'Bug');
  const detail = (await call('GET', `/api/tasks/${t.id}`, null, a.token)).body;
  assert.equal(detail.subtasks.length, 2); assert.equal(detail.time_entries.length, 2);
  assert.equal((await call('DELETE', `/api/subtasks/${s1.id}`, null, a.token)).status, 204);
  close();
});

test('comments create @mention notifications for workspace members only', async () => {
  const { call, close, register, a, p } = await setup();
  const b = await register('bob@example.com', 'Bob');
  const out = await register('eve@example.com', 'Eve');
  const inv = (await call('POST', `/api/workspaces/${a.ws}/invites`, { email: 'bob@example.com' }, a.token)).body;
  await call('POST', '/api/invites/accept', { code: inv.code }, b.token);
  const t = (await call('POST', `/api/projects/${p.id}/tasks`, { title: 'Review' }, a.token)).body;
  const c = await call('POST', `/api/tasks/${t.id}/comments`, { body: 'Hi @bob and @eve, please check' }, a.token);
  assert.equal(c.status, 201);
  assert.equal((await call('GET', '/api/notifications', null, b.token)).body.unread, 1);
  assert.equal((await call('GET', '/api/notifications', null, out.token)).body.unread, 0);
  assert.equal((await call('GET', `/api/tasks/${t.id}/comments`, null, b.token)).body.length, 1);
  close();
});

test('stats, report and CSV export (formula injection neutralised)', async () => {
  const { call, close, a, p } = await setup();
  const t1 = (await call('POST', `/api/projects/${p.id}/tasks`, { title: '=HYPERLINK("x")', priority: 'high', due_date: '2020-01-01', assignee_id: a.id, estimate_min: 60 }, a.token)).body;
  const t2 = (await call('POST', `/api/projects/${p.id}/tasks`, { title: 'Plain, with comma' }, a.token)).body;
  await call('PATCH', `/api/tasks/${t2.id}`, { status: 'done' }, a.token);
  await call('POST', `/api/tasks/${t1.id}/time`, { minutes: 20 }, a.token);
  const s = (await call('GET', `/api/projects/${p.id}/stats`, null, a.token)).body;
  assert.equal(s.total, 2); assert.equal(s.overdue, 1); assert.equal(s.completionRate, 50); assert.equal(s.byPriority.high, 1);
  const r = (await call('GET', `/api/projects/${p.id}/report?days=7`, null, a.token)).body;
  assert.equal(r.burndown.length, 7);
  assert.equal(r.burndown.at(-1).remaining, 1);
  assert.equal(r.workload[0].name, 'Ana'); assert.equal(r.workload[0].estimate_min, 60);
  assert.equal(r.time[0].minutes, 20);
  const csv = await call('GET', `/api/projects/${p.id}/export.csv`, null, a.token);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.body, /"'=HYPERLINK\(""x""\)"|'=HYPERLINK/);
  assert.match(csv.body, /"Plain, with comma"/);
  close();
});
