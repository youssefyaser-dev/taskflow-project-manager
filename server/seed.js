import { hashPassword } from './auth.js';

// Fills an empty database with a sample team, projects and tasks.
export function seed(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  const run = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
  const user = (name, email) => run('INSERT INTO users (name, email, password_hash) VALUES (?,?,?)', name, email, hashPassword('welcome123'));
  const demo = user('Karim Adel', 'karim@northwind.test');
  const sara = user('Sara Lee', 'sara@taskflow.test');
  const omar = user('Omar Hassan', 'omar@taskflow.test');
  const ws = run('INSERT INTO workspaces (name, owner_id) VALUES (?, ?)', 'Northwind Studio', demo);
  for (const [u, r] of [[demo, 'owner'], [sara, 'admin'], [omar, 'member']]) run('INSERT INTO members (workspace_id, user_id, role) VALUES (?,?,?)', ws, u, r);

  const lab = Object.fromEntries([['Bug', '#ef4444'], ['Feature', '#4f46e5'], ['Design', '#db2777'], ['Backend', '#0891b2']]
    .map(([n, c]) => [n, run('INSERT INTO labels (workspace_id, name, color) VALUES (?,?,?)', ws, n, c)]));
  const web = run('INSERT INTO projects (workspace_id, name, color) VALUES (?,?,?)', ws, 'Website Redesign', '#4f46e5');
  const app = run('INSERT INTO projects (workspace_id, name, color) VALUES (?,?,?)', ws, 'Mobile Launch', '#0891b2');

  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const ts = (n) => new Date(Date.now() + n * 864e5).toISOString();
  const rows = [
    [web, 'Collect brand assets', 'Logo, fonts and colour palette from the client.', 'done', 'low', omar, 120, -6, ['Design'], -12, -6],
    [web, 'Wireframes for home page', 'Desktop and mobile layouts.', 'done', 'medium', sara, 240, -3, ['Design'], -11, -3],
    [web, 'Build navigation component', 'Responsive menu with keyboard support.', 'review', 'high', omar, 180, 1, ['Feature'], -9, null],
    [web, 'Contact form with validation', 'Email notification on submit.', 'doing', 'medium', demo, 150, 2, ['Feature', 'Backend'], -8, null],
    [web, 'Fix footer overlap on tablets', 'Footer covers the cookie banner at 768px.', 'doing', 'high', sara, 60, 0, ['Bug'], -5, null],
    [web, 'SEO metadata and sitemap', '', 'todo', 'low', null, 90, 5, ['Backend'], -4, null],
    [web, 'Performance pass', 'Image sizes, lazy loading, bundle size.', 'todo', 'high', omar, 240, -1, ['Feature'], -4, null],
    [web, 'Cross-browser testing', 'Chrome, Firefox, Safari, Edge.', 'todo', 'medium', null, 180, 7, [], -3, null],
    [web, 'Launch checklist', 'DNS, SSL, redirects, analytics.', 'todo', 'high', demo, 120, 10, [], -2, null],
    [app, 'Define MVP scope', '', 'done', 'high', demo, 90, -8, ['Feature'], -13, -8],
    [app, 'Onboarding screens', '', 'doing', 'medium', sara, 300, 3, ['Design'], -7, null],
    [app, 'Push notification service', '', 'todo', 'medium', omar, 360, 9, ['Backend'], -2, null],
    [app, 'Store listing copy', '', 'todo', 'low', null, 60, 14, [], -1, null],
  ];
  const ids = rows.map((r, i) => {
    const id = run(
      `INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, estimate_min, due_date, position, created_by, created_at, completed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      r[0], r[1], r[2], r[3], r[4], r[5], r[6], day(r[7]), i + 1, demo, ts(r[9]), r[10] === null ? null : ts(r[10]));
    for (const l of r[8]) run('INSERT INTO task_labels (task_id, label_id) VALUES (?,?)', id, lab[l]);
    return id;
  });
  for (const t of ['Keyboard focus order', 'Mobile breakpoint', 'Active link style']) run('INSERT INTO subtasks (task_id, title, done) VALUES (?,?,?)', ids[2], t, t === 'Active link style' ? 0 : 1);
  for (const t of ['Server-side checks', 'Spam protection', 'Email template']) run('INSERT INTO subtasks (task_id, title, done) VALUES (?,?,?)', ids[3], t, t === 'Server-side checks' ? 1 : 0);
  run('INSERT INTO time_entries (task_id, user_id, minutes, note) VALUES (?,?,?,?)', ids[2], omar, 150, 'Menu markup and styles');
  run('INSERT INTO time_entries (task_id, user_id, minutes, note) VALUES (?,?,?,?)', ids[3], demo, 95, 'Validation rules');
  run('INSERT INTO time_entries (task_id, user_id, minutes, note) VALUES (?,?,?,?)', ids[1], sara, 210, 'Home wireframes');
  run('INSERT INTO comments (task_id, user_id, body) VALUES (?,?,?)', ids[2], sara, 'Looks good. @omar can you check the focus ring contrast?');
  run('INSERT INTO comments (task_id, user_id, body) VALUES (?,?,?)', ids[2], omar, 'Done, bumped it to the brand colour.');
  run('INSERT INTO notifications (user_id, text, task_id) VALUES (?,?,?)', demo, 'Sara Lee mentioned you on "Contact form with validation"', ids[3]);
  run('INSERT INTO notifications (user_id, text, task_id) VALUES (?,?,?)', demo, 'You were assigned "Launch checklist"', ids[8]);
  [[sara, 'task.moved', 'Fix footer overlap on tablets: todo -> doing', ids[4]], [omar, 'task.moved', 'Build navigation component: doing -> review', ids[2]],
    [demo, 'task.created', 'Launch checklist', ids[8]], [sara, 'comment.added', 'Build navigation component', ids[2]]]
    .forEach(([u, a, d, t]) => run('INSERT INTO activity (workspace_id, user_id, task_id, action, detail) VALUES (?,?,?,?,?)', ws, u, t, a, d));
}
