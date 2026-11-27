import React, { useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { LangContext } from './App.jsx';

const ICON = { 'task.created': '+', 'task.moved': '>', 'task.assigned': '@', 'task.deleted': 'x', 'comment.added': '#', 'time.logged': 't', 'project.created': '+', 'project.deleted': 'x' };

export default function Activity({ wid, refreshKey }) {
  const t = useContext(LangContext);
  const [rows, setRows] = useState([]);
  useEffect(() => { if (wid) api('GET', `/api/workspaces/${wid}/activity?limit=50`).then(setRows); }, [wid, refreshKey]);
  return (
    <section className="card pad">
      {rows.length === 0 && <p className="empty">{t('nothing')}</p>}
      <ul className="feed">
        {rows.map((r) => (
          <li key={r.id}><span>{ICON[r.action] || '•'}</span><div><b>{r.user || '—'}</b> <small>{r.action}</small><br />{r.detail}</div><small>{r.created_at}</small></li>
        ))}
      </ul>
    </section>
  );
}
