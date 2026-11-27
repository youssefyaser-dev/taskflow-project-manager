import React, { useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { LangContext, RoleContext, can } from './App.jsx';

export default function TaskModal({ task, projectId, wid, members, labels, onLabelsChanged, onClose, onSaved }) {
  const t = useContext(LangContext);
  const role = useContext(RoleContext);
  const canEdit = can(role, 'member');
  const isNew = !task.id;
  const [f, setF] = useState({
    title: task.title || '', description: task.description || '', priority: task.priority || 'medium', status: task.status || 'todo',
    due_date: task.due_date || '', assignee_id: task.assignee_id || '', estimate_min: task.estimate_min || '',
  });
  const [labelIds, setLabelIds] = useState((task.labels || []).map((l) => l.id));
  const [detail, setDetail] = useState({ subtasks: [], time_entries: [] });
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [sub, setSub] = useState('');
  const [tm, setTm] = useState({ minutes: '', note: '' });
  const [newLabel, setNewLabel] = useState('');
  const [err, setErr] = useState('');

  const loadDetail = useCallback(async () => {
    if (!task.id) return;
    setDetail(await api('GET', `/api/tasks/${task.id}`));
    setComments(await api('GET', `/api/tasks/${task.id}/comments`));
  }, [task.id]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const save = async (e) => {
    e.preventDefault(); setErr('');
    try {
      const body = { ...f, due_date: f.due_date || null, assignee_id: f.assignee_id ? Number(f.assignee_id) : null, estimate_min: f.estimate_min ? Number(f.estimate_min) : null };
      let id = task.id;
      if (isNew) id = (await api('POST', `/api/projects/${projectId}/tasks`, body)).id;
      else await api('PATCH', `/api/tasks/${id}`, body);
      await api('PUT', `/api/tasks/${id}/labels`, { label_ids: labelIds });
      onSaved();
    } catch (ex) { setErr(ex.message); }
  };
  const remove = async () => { if (window.confirm(t('confirmDelete'))) { await api('DELETE', `/api/tasks/${task.id}`); onSaved(); } };
  const post = async (e) => { e.preventDefault(); if (!text.trim()) return; await api('POST', `/api/tasks/${task.id}/comments`, { body: text }); setText(''); loadDetail(); };
  const addSub = async (e) => { e.preventDefault(); if (!sub.trim()) return; await api('POST', `/api/tasks/${task.id}/subtasks`, { title: sub }); setSub(''); loadDetail(); };
  const toggleSub = async (s) => { await api('PATCH', `/api/subtasks/${s.id}`, { done: !s.done }); loadDetail(); };
  const logTime = async (e) => { e.preventDefault(); try { await api('POST', `/api/tasks/${task.id}/time`, { minutes: Number(tm.minutes), note: tm.note }); setTm({ minutes: '', note: '' }); loadDetail(); } catch (ex) { setErr(ex.message); } };
  const addLabel = async (e) => {
    e.preventDefault(); if (!newLabel.trim()) return;
    try { const l = await api('POST', `/api/workspaces/${wid}/labels`, { name: newLabel }); setNewLabel(''); setLabelIds((x) => [...x, l.id]); onLabelsChanged(); } catch (ex) { setErr(ex.message); }
  };
  const toggleLabel = (id) => setLabelIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const total = detail.time_entries.reduce((a, b) => a + b.minutes, 0);

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card">
        <h3>{isNew ? t('newTask') : t('editTask')}</h3>
        <form onSubmit={save}>
          <fieldset disabled={!canEdit}>
            <label>{t('title')}<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus required maxLength={200} /></label>
            <label>{t('description')}<textarea rows="3" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
            <div className="grid3">
              <label>{t('priority')}<select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{['low', 'medium', 'high'].map((p) => <option key={p} value={p}>{t(p)}</option>)}</select></label>
              <label>{t('statusLabel')}<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{['todo', 'doing', 'review', 'done'].map((p) => <option key={p} value={p}>{t(p)}</option>)}</select></label>
              <label>{t('due')}<input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></label>
              <label>{t('assignee')}<select value={f.assignee_id} onChange={(e) => setF({ ...f, assignee_id: e.target.value })}><option value="">{t('unassigned')}</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
              <label>{t('estimate')}<input type="number" min="0" value={f.estimate_min} onChange={(e) => setF({ ...f, estimate_min: e.target.value })} /></label>
            </div>
            <div className="labelpick">
              <span className="muted">{t('labels')}:</span>
              {labels.map((l) => <button type="button" key={l.id} className={`lbl ${labelIds.includes(l.id) ? 'on' : 'off'}`} style={{ background: labelIds.includes(l.id) ? l.color : undefined }} onClick={() => toggleLabel(l.id)}>{l.name}</button>)}
            </div>
          </fieldset>
          {canEdit && !isNew && <div className="row"><input placeholder="+ label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ maxWidth: 160 }} /><button type="button" onClick={addLabel}>{t('add')}</button></div>}
          {err && <p className="error">{err}</p>}
          <div className="row end">
            {!isNew && canEdit && <button type="button" className="danger-btn" onClick={remove}>{t('delete')}</button>}
            <span className="grow" />
            <button type="button" onClick={onClose}>{t('cancel')}</button>
            {canEdit && <button className="primary">{t('save')}</button>}
          </div>
        </form>
        {!isNew && (
          <>
            <section className="sect"><h4>{t('subtasks')}</h4>
              {detail.subtasks.map((s) => <label key={s.id} className="check"><input type="checkbox" checked={Boolean(s.done)} disabled={!canEdit} onChange={() => toggleSub(s)} /> <span className={s.done ? 'strike' : ''}>{s.title}</span></label>)}
              {canEdit && <form className="row" onSubmit={addSub}><input className="grow" placeholder={t('addSubtask')} value={sub} onChange={(e) => setSub(e.target.value)} /><button>{t('add')}</button></form>}
            </section>
            <section className="sect"><h4>{t('logTime')} <small>({Math.floor(total / 60)}h {total % 60}m {t('logged')})</small></h4>
              {detail.time_entries.map((e) => <p key={e.id} className="small"><b>{e.user}</b> · {e.minutes} min {e.note && `· ${e.note}`}</p>)}
              {canEdit && <form className="row" onSubmit={logTime}>
                <input type="number" min="1" max="1440" placeholder={t('minutes')} value={tm.minutes} onChange={(e) => setTm({ ...tm, minutes: e.target.value })} style={{ maxWidth: 110 }} required />
                <input className="grow" placeholder={t('note')} value={tm.note} onChange={(e) => setTm({ ...tm, note: e.target.value })} /><button>{t('add')}</button></form>}
            </section>
            <section className="sect"><h4>{t('comments')}</h4>
              {comments.map((c) => <p key={c.id} className="small"><b>{c.author}</b> <small>{c.created_at}</small><br />{c.body}</p>)}
              {canEdit && <form className="row" onSubmit={post}><input className="grow" placeholder={t('writeComment')} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} /><button>{t('post')}</button></form>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
