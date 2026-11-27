import express from 'express';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js';
import { HttpError, ROLE_RANK, validators, rateLimit } from './http.js';

const STATUSES = ['todo', 'doing', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];
const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(db, { secret = 'dev-secret-change-me', authLimit = { windowMs: 60_000, max: 20 } } = {}) {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '100kb' }));
  const { str, date, oneOf, int } = validators();

  const wrap = (fn) => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const nowIso = () => new Date().toISOString();

  const auth = (req, _res, next) => {
    const data = verifyToken((req.get('authorization') || '').replace(/^Bearer /, ''), secret);
    if (!data) return next(new HttpError(401, 'Not signed in'));
    req.userId = data.uid;
    next();
  };

  // ---- access helpers: every resource resolves to a workspace, then to the caller's role there ----
  const roleIn = (userId, wid) => one('SELECT role FROM members WHERE workspace_id = ? AND user_id = ?', wid, userId)?.role;
  const need = (userId, wid, min) => {
    const role = roleIn(userId, wid);
    if (!role) throw new HttpError(404, 'Not found'); // do not reveal other workspaces
    if (ROLE_RANK[role] < ROLE_RANK[min]) throw new HttpError(403, `requires ${min} role`);
    return role;
  };
  const wsParam = (req, min) => { const wid = int(req.params.wid, 'workspace', { min: 1 }); need(req.userId, wid, min); return wid; };
  const projectOf = (req, min) => {
    const p = one('SELECT * FROM projects WHERE id = ?', Number(req.params.id));
    if (!p) throw new HttpError(404, 'Project not found');
    need(req.userId, p.workspace_id, min);
    return p;
  };
  const taskOf = (req, min) => {
    const t = one(
      'SELECT t.*, p.workspace_id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?',
      Number(req.params.id)
    );
    if (!t) throw new HttpError(404, 'Task not found');
    need(req.userId, t.workspace_id, min);
    return t;
  };
  const log = (wid, userId, action, detail = '', taskId = null) =>
    run('INSERT INTO activity (workspace_id, user_id, task_id, action, detail) VALUES (?,?,?,?,?)', wid, userId, taskId, action, detail);
  const notify = (userId, text, taskId = null, exceptUser = null) => {
    if (userId && userId !== exceptUser) run('INSERT INTO notifications (user_id, text, task_id) VALUES (?,?,?)', userId, text, taskId);
  };
  const isMember = (wid, uid) => Boolean(roleIn(uid, wid));
  const newWorkspace = (name, ownerId) => {
    const id = Number(run('INSERT INTO workspaces (name, owner_id) VALUES (?, ?)', name, ownerId).lastInsertRowid);
    run("INSERT INTO members (workspace_id, user_id, role) VALUES (?, ?, 'owner')", id, ownerId);
    return id;
  };

  // ---- auth ----
  const limiter = rateLimit(authLimit);
  app.post('/api/auth/register', limiter, wrap((req, res) => {
    const name = str(req.body.name, 'name', { max: 80 });
    const email = str(req.body.email, 'email').toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'email is invalid');
    if (password.length < 8) throw new HttpError(400, 'password must be at least 8 characters');
    if (one('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'email already registered');
    const id = Number(run('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', name, email, hashPassword(password)).lastInsertRowid);
    const wid = newWorkspace(`${name}'s workspace`, id);
    log(wid, id, 'workspace.created', `${name}'s workspace`);
    res.status(201).json({ token: signToken({ uid: id }, secret), user: { id, name, email } });
  }));

  app.post('/api/auth/login', limiter, wrap((req, res) => {
    const email = str(req.body.email, 'email').toLowerCase();
    const u = one('SELECT * FROM users WHERE email = ?', email);
    if (!u || !verifyPassword(String(req.body.password || ''), u.password_hash)) throw new HttpError(401, 'wrong email or password');
    res.json({ token: signToken({ uid: u.id }, secret), user: { id: u.id, name: u.name, email: u.email } });
  }));

  app.get('/api/me', auth, wrap((req, res) => res.json(one('SELECT id, name, email FROM users WHERE id = ?', req.userId))));

  // ---- workspaces, members, invites ----
  app.get('/api/workspaces', auth, wrap((req, res) => {
    res.json(all(
      `SELECT w.id, w.name, m.role,
              (SELECT COUNT(*) FROM members x WHERE x.workspace_id = w.id) AS member_count
       FROM workspaces w JOIN members m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.id`, req.userId));
  }));

  app.post('/api/workspaces', auth, wrap((req, res) => {
    const name = str(req.body.name, 'name', { max: 80 });
    const id = newWorkspace(name, req.userId);
    log(id, req.userId, 'workspace.created', name);
    res.status(201).json({ id, name, role: 'owner', member_count: 1 });
  }));

  app.get('/api/workspaces/:wid/members', auth, wrap((req, res) => {
    const wid = wsParam(req, 'viewer');
    res.json(all(
      `SELECT u.id, u.name, u.email, m.role, m.joined_at FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.name`, wid));
  }));

  app.post('/api/workspaces/:wid/invites', auth, wrap((req, res) => {
    const wid = wsParam(req, 'admin');
    const email = str(req.body.email, 'email').toLowerCase();
    const role = oneOf(req.body.role || 'member', ['admin', 'member', 'viewer'], 'role');
    if (role === 'admin' && roleIn(req.userId, wid) !== 'owner') throw new HttpError(403, 'only the owner can invite admins');
    const existing = one('SELECT u.id FROM users u JOIN members m ON m.user_id = u.id WHERE u.email = ? AND m.workspace_id = ?', email, wid);
    if (existing) throw new HttpError(409, 'already a member');
    const code = randomBytes(9).toString('base64url');
    run('INSERT INTO invites (workspace_id, email, role, code, invited_by) VALUES (?,?,?,?,?)', wid, email, role, code, req.userId);
    log(wid, req.userId, 'member.invited', email);
    res.status(201).json({ email, role, code });
  }));

  app.get('/api/workspaces/:wid/invites', auth, wrap((req, res) => {
    const wid = wsParam(req, 'admin');
    res.json(all('SELECT id, email, role, code, created_at FROM invites WHERE workspace_id = ? AND accepted_at IS NULL ORDER BY id DESC', wid));
  }));

  app.post('/api/invites/accept', auth, wrap((req, res) => {
    const code = str(req.body.code, 'code', { max: 64 });
    const inv = one('SELECT * FROM invites WHERE code = ? AND accepted_at IS NULL', code);
    const me = one('SELECT * FROM users WHERE id = ?', req.userId);
    if (!inv || inv.email !== me.email) throw new HttpError(404, 'invite not found');
    run('INSERT OR IGNORE INTO members (workspace_id, user_id, role) VALUES (?,?,?)', inv.workspace_id, me.id, inv.role);
    run('UPDATE invites SET accepted_at = ? WHERE id = ?', nowIso(), inv.id);
    log(inv.workspace_id, me.id, 'member.joined', me.name);
    res.json({ workspace_id: inv.workspace_id, role: inv.role });
  }));

  app.patch('/api/workspaces/:wid/members/:uid', auth, wrap((req, res) => {
    const wid = wsParam(req, 'admin');
    const uid = int(req.params.uid, 'user', { min: 1 });
    const target = roleIn(uid, wid);
    if (!target) throw new HttpError(404, 'member not found');
    const mine = roleIn(req.userId, wid);
    const role = oneOf(req.body.role, ['admin', 'member', 'viewer'], 'role');
    if (target === 'owner') throw new HttpError(400, 'the owner role cannot be changed');
    if (mine !== 'owner' && (target === 'admin' || role === 'admin')) throw new HttpError(403, 'only the owner can manage admins');
    run('UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?', role, wid, uid);
    log(wid, req.userId, 'member.role', `${uid} -> ${role}`);
    res.json({ user_id: uid, role });
  }));

  app.delete('/api/workspaces/:wid/members/:uid', auth, wrap((req, res) => {
    const wid = int(req.params.wid, 'workspace', { min: 1 });
    const uid = int(req.params.uid, 'user', { min: 1 });
    const self = uid === req.userId;
    need(req.userId, wid, self ? 'viewer' : 'admin');
    const target = roleIn(uid, wid);
    if (!target) throw new HttpError(404, 'member not found');
    if (target === 'owner') throw new HttpError(400, 'the owner cannot be removed');
    if (!self && target === 'admin' && roleIn(req.userId, wid) !== 'owner') throw new HttpError(403, 'only the owner can remove admins');
    run('DELETE FROM members WHERE workspace_id = ? AND user_id = ?', wid, uid);
    run('UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ? AND project_id IN (SELECT id FROM projects WHERE workspace_id = ?)', uid, wid);
    log(wid, req.userId, self ? 'member.left' : 'member.removed', String(uid));
    res.status(204).end();
  }));

  app.get('/api/workspaces/:wid/activity', auth, wrap((req, res) => {
    const wid = wsParam(req, 'viewer');
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    res.json(all(
      `SELECT a.id, a.action, a.detail, a.task_id, a.created_at, u.name AS user
       FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.workspace_id = ? ORDER BY a.id DESC LIMIT ?`, wid, limit));
  }));

  // ---- labels ----
  app.get('/api/workspaces/:wid/labels', auth, wrap((req, res) => {
    res.json(all('SELECT id, name, color FROM labels WHERE workspace_id = ? ORDER BY name', wsParam(req, 'viewer')));
  }));
  app.post('/api/workspaces/:wid/labels', auth, wrap((req, res) => {
    const wid = wsParam(req, 'member');
    const name = str(req.body.name, 'name', { max: 30 });
    const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color || '') ? req.body.color : '#64748b';
    if (one('SELECT 1 FROM labels WHERE workspace_id = ? AND name = ?', wid, name)) throw new HttpError(409, 'label already exists');
    const id = Number(run('INSERT INTO labels (workspace_id, name, color) VALUES (?,?,?)', wid, name, color).lastInsertRowid);
    res.status(201).json({ id, name, color });
  }));

  // ---- projects ----
  app.get('/api/workspaces/:wid/projects', auth, wrap((req, res) => {
    res.json(all(
      `SELECT p.id, p.name, p.color,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS total,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done
       FROM projects p WHERE p.workspace_id = ? ORDER BY p.id`, wsParam(req, 'viewer')));
  }));

  app.post('/api/workspaces/:wid/projects', auth, wrap((req, res) => {
    const wid = wsParam(req, 'admin');
    const name = str(req.body.name, 'name', { max: 80 });
    const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color || '') ? req.body.color : '#4f46e5';
    const id = Number(run('INSERT INTO projects (workspace_id, name, color) VALUES (?,?,?)', wid, name, color).lastInsertRowid);
    log(wid, req.userId, 'project.created', name);
    res.status(201).json({ id, name, color, total: 0, done: 0 });
  }));

  app.delete('/api/projects/:id', auth, wrap((req, res) => {
    const p = projectOf(req, 'admin');
    run('DELETE FROM projects WHERE id = ?', p.id);
    log(p.workspace_id, req.userId, 'project.deleted', p.name);
    res.status(204).end();
  }));

  // ---- tasks ----
  const labelsFor = (ids) => {
    if (!ids.length) return new Map();
    const rows = all(
      `SELECT tl.task_id, l.id, l.name, l.color FROM task_labels tl JOIN labels l ON l.id = tl.label_id
       WHERE tl.task_id IN (${ids.map(() => '?').join(',')})`, ...ids);
    const m = new Map();
    for (const r of rows) (m.get(r.task_id) || m.set(r.task_id, []).get(r.task_id)).push({ id: r.id, name: r.name, color: r.color });
    return m;
  };

  app.get('/api/projects/:id/tasks', auth, wrap((req, res) => {
    const p = projectOf(req, 'viewer');
    const where = ['t.project_id = ?']; const args = [p.id];
    if (req.query.status) { where.push('t.status = ?'); args.push(oneOf(req.query.status, STATUSES, 'status')); }
    if (req.query.assignee === 'me') { where.push('t.assignee_id = ?'); args.push(req.userId); }
    else if (req.query.assignee === 'none') where.push('t.assignee_id IS NULL');
    else if (req.query.assignee) { where.push('t.assignee_id = ?'); args.push(int(req.query.assignee, 'assignee', { min: 1 })); }
    if (req.query.priority) { where.push('t.priority = ?'); args.push(oneOf(req.query.priority, PRIORITIES, 'priority')); }
    if (req.query.label) { where.push('EXISTS (SELECT 1 FROM task_labels tl WHERE tl.task_id = t.id AND tl.label_id = ?)'); args.push(int(req.query.label, 'label', { min: 1 })); }
    if (req.query.q) { where.push('(t.title LIKE ? OR t.description LIKE ?)'); const like = `%${String(req.query.q).slice(0, 100)}%`; args.push(like, like); }
    const rows = all(
      `SELECT t.*, u.name AS assignee_name,
              (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) AS comment_count,
              (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_total,
              (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.done = 1) AS subtask_done,
              (SELECT COALESCE(SUM(minutes), 0) FROM time_entries e WHERE e.task_id = t.id) AS logged_min
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE ${where.join(' AND ')} ORDER BY t.position, t.id`, ...args);
    const lm = labelsFor(rows.map((r) => r.id));
    res.json(rows.map((r) => ({ ...r, labels: lm.get(r.id) || [] })));
  }));

  const checkAssignee = (wid, v) => {
    if (v === null || v === undefined || v === '') return null;
    const id = int(v, 'assignee', { min: 1 });
    if (!isMember(wid, id)) throw new HttpError(400, 'assignee must be a workspace member');
    return id;
  };

  app.post('/api/projects/:id/tasks', auth, wrap((req, res) => {
    const p = projectOf(req, 'member');
    const b = req.body;
    const title = str(b.title, 'title');
    const description = str(b.description, 'description', { max: 2000, required: false });
    const priority = b.priority === undefined ? 'medium' : oneOf(b.priority, PRIORITIES, 'priority');
    const status = b.status === undefined ? 'todo' : oneOf(b.status, STATUSES, 'status');
    const assignee = checkAssignee(p.workspace_id, b.assignee_id);
    const estimate = b.estimate_min ? int(b.estimate_min, 'estimate', { min: 1, max: 100000 }) : null;
    const max = one('SELECT COALESCE(MAX(position), 0) AS m FROM tasks WHERE project_id = ? AND status = ?', p.id, status).m;
    const id = Number(run(
      `INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, estimate_min, due_date, position, created_by, completed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      p.id, title, description, status, priority, assignee, estimate, date(b.due_date, 'due_date'), max + 1, req.userId, status === 'done' ? nowIso() : null
    ).lastInsertRowid);
    log(p.workspace_id, req.userId, 'task.created', title, id);
    notify(assignee, `You were assigned "${title}"`, id, req.userId);
    res.status(201).json(one('SELECT * FROM tasks WHERE id = ?', id));
  }));

  app.get('/api/tasks/:id', auth, wrap((req, res) => {
    const t = taskOf(req, 'viewer');
    res.json({
      ...one('SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.id = ?', t.id),
      labels: labelsFor([t.id]).get(t.id) || [],
      subtasks: all('SELECT id, title, done FROM subtasks WHERE task_id = ? ORDER BY id', t.id),
      time_entries: all('SELECT e.id, e.minutes, e.note, e.created_at, u.name AS user FROM time_entries e JOIN users u ON u.id = e.user_id WHERE e.task_id = ? ORDER BY e.id DESC', t.id),
    });
  }));

  app.patch('/api/tasks/:id', auth, wrap((req, res) => {
    const t = taskOf(req, 'member');
    const b = req.body;
    const title = b.title !== undefined ? str(b.title, 'title') : t.title;
    const description = b.description !== undefined ? str(b.description, 'description', { max: 2000, required: false }) : t.description;
    const priority = b.priority !== undefined ? oneOf(b.priority, PRIORITIES, 'priority') : t.priority;
    const status = b.status !== undefined ? oneOf(b.status, STATUSES, 'status') : t.status;
    const due = b.due_date !== undefined ? date(b.due_date, 'due_date') : t.due_date;
    const assignee = b.assignee_id !== undefined ? checkAssignee(t.workspace_id, b.assignee_id) : t.assignee_id;
    const estimate = b.estimate_min !== undefined ? (b.estimate_min ? int(b.estimate_min, 'estimate', { min: 1, max: 100000 }) : null) : t.estimate_min;
    let position = t.position;
    if (b.position !== undefined) {
      if (typeof b.position !== 'number' || !Number.isFinite(b.position)) throw new HttpError(400, 'position is invalid');
      position = b.position;
    } else if (status !== t.status) {
      position = one('SELECT COALESCE(MAX(position), 0) AS m FROM tasks WHERE project_id = ? AND status = ?', t.project_id, status).m + 1;
    }
    const completed = status === 'done' ? (t.completed_at || nowIso()) : null;
    run(
      `UPDATE tasks SET title=?, description=?, priority=?, status=?, due_date=?, assignee_id=?, estimate_min=?, position=?, completed_at=? WHERE id=?`,
      title, description, priority, status, due, assignee, estimate, position, completed, t.id);
    if (status !== t.status) log(t.workspace_id, req.userId, 'task.moved', `${title}: ${t.status} -> ${status}`, t.id);
    if (assignee !== t.assignee_id) {
      log(t.workspace_id, req.userId, 'task.assigned', title, t.id);
      notify(assignee, `You were assigned "${title}"`, t.id, req.userId);
    }
    res.json(one('SELECT * FROM tasks WHERE id = ?', t.id));
  }));

  app.delete('/api/tasks/:id', auth, wrap((req, res) => {
    const t = taskOf(req, 'member');
    run('DELETE FROM tasks WHERE id = ?', t.id);
    log(t.workspace_id, req.userId, 'task.deleted', t.title);
    res.status(204).end();
  }));

  app.put('/api/tasks/:id/labels', auth, wrap((req, res) => {
    const t = taskOf(req, 'member');
    const ids = Array.isArray(req.body.label_ids) ? req.body.label_ids.map((x) => int(x, 'label', { min: 1 })) : [];
    for (const id of ids) if (!one('SELECT 1 FROM labels WHERE id = ? AND workspace_id = ?', id, t.workspace_id)) throw new HttpError(400, 'unknown label');
    run('DELETE FROM task_labels WHERE task_id = ?', t.id);
    for (const id of new Set(ids)) run('INSERT INTO task_labels (task_id, label_id) VALUES (?,?)', t.id, id);
    res.json({ label_ids: [...new Set(ids)] });
  }));

  // ---- subtasks ----
  app.post('/api/tasks/:id/subtasks', auth, wrap((req, res) => {
    const t = taskOf(req, 'member');
    const title = str(req.body.title, 'title', { max: 150 });
    const id = Number(run('INSERT INTO subtasks (task_id, title) VALUES (?,?)', t.id, title).lastInsertRowid);
    res.status(201).json({ id, title, done: 0 });
  }));
  const subtaskOf = (req, min) => {
    const s = one(
      `SELECT s.*, p.workspace_id FROM subtasks s JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id WHERE s.id = ?`,
      Number(req.params.id));
    if (!s) throw new HttpError(404, 'Subtask not found');
    need(req.userId, s.workspace_id, min);
    return s;
  };
  app.patch('/api/subtasks/:id', auth, wrap((req, res) => {
    const s = subtaskOf(req, 'member');
    const title = req.body.title !== undefined ? str(req.body.title, 'title', { max: 150 }) : s.title;
    const done = req.body.done !== undefined ? (req.body.done ? 1 : 0) : s.done;
    run('UPDATE subtasks SET title = ?, done = ? WHERE id = ?', title, done, s.id);
    res.json({ id: s.id, title, done });
  }));
  app.delete('/api/subtasks/:id', auth, wrap((req, res) => {
    run('DELETE FROM subtasks WHERE id = ?', subtaskOf(req, 'member').id);
    res.status(204).end();
  }));

  // ---- time tracking ----
  app.post('/api/tasks/:id/time', auth, wrap((req, res) => {
    const t = taskOf(req, 'member');
    const minutes = int(req.body.minutes, 'minutes', { min: 1, max: 1440 });
    const note = str(req.body.note, 'note', { max: 200, required: false });
    const id = Number(run('INSERT INTO time_entries (task_id, user_id, minutes, note) VALUES (?,?,?,?)', t.id, req.userId, minutes, note).lastInsertRowid);
    log(t.workspace_id, req.userId, 'time.logged', `${minutes} min on ${t.title}`, t.id);
    res.status(201).json({ id, minutes, note });
  }));

  // ---- comments (with @mentions) ----
  app.get('/api/tasks/:id/comments', auth, wrap((req, res) => {
    const t = taskOf(req, 'viewer');
    res.json(all('SELECT c.id, c.body, c.created_at, u.name AS author FROM comments c JOIN users u ON u.id = c.user_id WHERE c.task_id = ? ORDER BY c.id', t.id));
  }));
  app.post('/api/tasks/:id/comments', auth, wrap((req, res) => {
    const t = taskOf(req, 'member');
    const body = str(req.body.body, 'body', { max: 1000 });
    const id = Number(run('INSERT INTO comments (task_id, user_id, body) VALUES (?,?,?)', t.id, req.userId, body).lastInsertRowid);
    const me = one('SELECT name FROM users WHERE id = ?', req.userId).name;
    for (const m of new Set(body.match(/@[\w.+-]+@[\w-]+\.[\w.-]+|@[\w.+-]+/g) || [])) {
      const handle = m.slice(1).toLowerCase();
      const u = handle.includes('@')
        ? one('SELECT id FROM users WHERE email = ?', handle)
        : one("SELECT id FROM users WHERE lower(substr(email, 1, instr(email, '@') - 1)) = ?", handle);
      if (u && isMember(t.workspace_id, u.id)) notify(u.id, `${me} mentioned you on "${t.title}"`, t.id, req.userId);
    }
    log(t.workspace_id, req.userId, 'comment.added', t.title, t.id);
    res.status(201).json(one('SELECT c.id, c.body, c.created_at, u.name AS author FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?', id));
  }));

  // ---- notifications ----
  app.get('/api/notifications', auth, wrap((req, res) => {
    res.json({
      unread: one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0', req.userId).n,
      items: all('SELECT id, text, task_id, read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30', req.userId),
    });
  }));
  app.post('/api/notifications/read', auth, wrap((req, res) => {
    run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.userId);
    res.status(204).end();
  }));

  // ---- stats, report, export ----
  app.get('/api/projects/:id/stats', auth, wrap((req, res) => {
    const p = projectOf(req, 'viewer');
    const today = nowIso().slice(0, 10);
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of all('SELECT status, COUNT(*) AS n FROM tasks WHERE project_id = ? GROUP BY status', p.id)) byStatus[r.status] = r.n;
    const byPriority = Object.fromEntries(PRIORITIES.map((s) => [s, 0]));
    for (const r of all("SELECT priority, COUNT(*) AS n FROM tasks WHERE project_id = ? AND status != 'done' GROUP BY priority", p.id)) byPriority[r.priority] = r.n;
    const overdue = one("SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND status != 'done' AND due_date IS NOT NULL AND due_date < ?", p.id, today).n;
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    res.json({ total, byStatus, byPriority, overdue, completionRate: total ? Math.round((byStatus.done / total) * 100) : 0 });
  }));

  app.get('/api/projects/:id/report', auth, wrap((req, res) => {
    const p = projectOf(req, 'viewer');
    const days = Math.min(60, Math.max(7, Number(req.query.days) || 14));
    const total = one('SELECT COUNT(*) AS n FROM tasks WHERE project_id = ?', p.id).n;
    const burndown = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      const created = one('SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND substr(created_at, 1, 10) <= ?', p.id, d).n;
      const completed = one('SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND completed_at IS NOT NULL AND substr(completed_at, 1, 10) <= ?', p.id, d).n;
      burndown.push({ date: d, remaining: created - completed });
    }
    const workload = all(
      `SELECT COALESCE(u.name, 'Unassigned') AS name, COUNT(*) AS open_tasks, COALESCE(SUM(t.estimate_min), 0) AS estimate_min
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.project_id = ? AND t.status != 'done' GROUP BY t.assignee_id ORDER BY open_tasks DESC`, p.id);
    const time = all(
      `SELECT u.name, SUM(e.minutes) AS minutes FROM time_entries e JOIN users u ON u.id = e.user_id JOIN tasks t ON t.id = e.task_id
       WHERE t.project_id = ? GROUP BY e.user_id ORDER BY minutes DESC`, p.id);
    res.json({ total, burndown, workload, time });
  }));

  const csvCell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  app.get('/api/projects/:id/export.csv', auth, wrap((req, res) => {
    const p = projectOf(req, 'viewer');
    const rows = all(
      `SELECT t.id, t.title, t.status, t.priority, u.name AS assignee, t.due_date, t.estimate_min,
              (SELECT COALESCE(SUM(minutes), 0) FROM time_entries e WHERE e.task_id = t.id) AS logged_min, t.created_at, t.completed_at
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.project_id = ? ORDER BY t.id`, p.id);
    const head = ['id', 'title', 'status', 'priority', 'assignee', 'due_date', 'estimate_min', 'logged_min', 'created_at', 'completed_at'];
    res.type('text/csv').attachment(`${p.name.replace(/[^\w-]+/g, '_')}.csv`)
      .send([head.join(','), ...rows.map((r) => head.map((h) => csvCell(r[h])).join(','))].join('\n') + '\n');
  }));

  // ---- client ----
  const dist = path.join(here, '..', 'client', 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
