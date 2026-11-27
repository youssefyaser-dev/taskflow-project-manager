import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { LangContext, RoleContext, can } from './App.jsx';
import TaskModal from './TaskModal.jsx';

const COLS = ['todo', 'doing', 'review', 'done'];
const today = () => new Date().toISOString().slice(0, 10);

export default function Board({ projectId, wid, me, onChange }) {
  const t = useContext(LangContext);
  const role = useContext(RoleContext);
  const canEdit = can(role, 'member');
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [labels, setLabels] = useState([]);
  const [f, setF] = useState({ q: '', priority: '', assignee: '', label: '' });
  const [editing, setEditing] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    setTasks(await api('GET', `/api/projects/${projectId}/tasks?${qs}`));
  }, [projectId, f]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api('GET', `/api/workspaces/${wid}/members`).then(setMembers);
    api('GET', `/api/workspaces/${wid}/labels`).then(setLabels);
  }, [wid]);

  const byCol = (c) => tasks.filter((x) => x.status === c);
  const drop = async (status, beforeId) => {
    const moving = tasks.find((x) => x.id === dragId);
    setDragId(null); setOver(null);
    if (!moving || !canEdit) return;
    const col = tasks.filter((x) => x.status === status && x.id !== moving.id);
    const idx = beforeId ? col.findIndex((x) => x.id === beforeId) : -1;
    const position = idx === -1 ? (col.at(-1)?.position ?? 0) + 1 : ((col[idx - 1]?.position ?? col[idx].position - 2) + col[idx].position) / 2;
    setTasks((all) => all.map((x) => (x.id === moving.id ? { ...x, status, position } : x)).sort((a, b) => a.position - b.position));
    await api('PATCH', `/api/tasks/${moving.id}`, { status, position });
    await load(); onChange();
  };
  const initials = (n) => (n || '').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <>
      <div className="toolbar">
        <input className="search" placeholder={t('search')} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
          <option value="">{t('allPriorities')}</option>
          {['high', 'medium', 'low'].map((p) => <option key={p} value={p}>{t(p)}</option>)}
        </select>
        <select value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })}>
          <option value="">{t('assignee')}: *</option>
          <option value="me">{t('mine')}</option>
          <option value="none">{t('unassigned')}</option>
          {members.filter((m) => m.id !== me.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })}>
          <option value="">{t('allLabels')}</option>
          {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        {canEdit ? <button className="primary" onClick={() => setEditing({ status: 'todo' })}>+ {t('addTask')}</button> : <span className="muted">{t('readOnly')}</span>}
      </div>
      <div className="board">
        {COLS.map((c) => (
          <div key={c} className={`col ${over === c ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(c); }} onDragLeave={() => setOver(null)} onDrop={() => drop(c, null)}>
            <h4>{t(c)} <span className="count">{byCol(c).length}</span></h4>
            {byCol(c).map((x) => (
              <article key={x.id} className={`task p-${x.priority}`} draggable={canEdit}
                onDragStart={() => setDragId(x.id)} onDragEnd={() => { setDragId(null); setOver(null); }}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.stopPropagation(); drop(c, x.id); }}
                onClick={() => setEditing(x)}>
                {x.labels.length > 0 && <div className="labels">{x.labels.map((l) => <span key={l.id} className="lbl" style={{ background: l.color }}>{l.name}</span>)}</div>}
                <div className="ttl">{x.title}</div>
                {x.subtask_total > 0 && (
                  <div className="prog"><div className="track"><div style={{ width: `${(x.subtask_done / x.subtask_total) * 100}%`, background: '#10b981' }} /></div><small>{x.subtask_done}/{x.subtask_total}</small></div>
                )}
                <div className="meta">
                  <span className={`pill ${x.priority}`}>{t(x.priority)}</span>
                  {x.due_date && <span className={x.status !== 'done' && x.due_date < today() ? 'late' : ''}>Due {x.due_date.slice(5)}</span>}
                  {x.comment_count > 0 && <span>Comments: {x.comment_count}</span>}
                  {x.logged_min > 0 && <span>Time {Math.round(x.logged_min / 6) / 10}h</span>}
                  {x.assignee_name && <span className="avatar" title={x.assignee_name}>{initials(x.assignee_name)}</span>}
                </div>
              </article>
            ))}
            {!byCol(c).length && <div className="hint">{t('emptyCol')}</div>}
          </div>
        ))}
      </div>
      {editing && (
        <TaskModal task={editing} projectId={projectId} wid={wid} members={members} labels={labels} onLabelsChanged={() => api('GET', `/api/workspaces/${wid}/labels`).then(setLabels)}
          onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); onChange(); }} />
      )}
    </>
  );
}
