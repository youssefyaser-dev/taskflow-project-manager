import React, { useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { LangContext } from './App.jsx';

const COLORS = { low: '#10b981', medium: '#f59e0b', high: '#ef4444' };

export default function Stats({ projectId, refreshKey }) {
  const t = useContext(LangContext);
  const [s, setS] = useState(null);
  useEffect(() => { api('GET', `/api/projects/${projectId}/stats`).then(setS); }, [projectId, refreshKey]);
  if (!s) return null;
  const maxP = Math.max(1, ...Object.values(s.byPriority));
  const R = 28, C = 2 * Math.PI * R;
  return (
    <section className="stats">
      <div className="card stat">
        <svg width="72" height="72" viewBox="0 0 72 72" role="img" aria-label={`${s.completionRate}%`}>
          <circle cx="36" cy="36" r={R} fill="none" stroke="#e8ddd2" strokeWidth="8" />
          <circle cx="36" cy="36" r={R} fill="none" stroke="#f4511e" strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${(s.completionRate / 100) * C} ${C}`} transform="rotate(-90 36 36)" />
          <text x="36" y="41" textAnchor="middle" fontSize="15" fontWeight="700" fill="#111827">{s.completionRate}%</text>
        </svg>
        <div><div className="label">{t('completion')}</div><div className="big">{s.byStatus.done}/{s.total}</div></div>
      </div>
      <div className="card stat">
        <div><div className="label">{t('overdue')}</div><div className={`big ${s.overdue ? 'danger' : ''}`}>{s.overdue}</div></div>
      </div>
      <div className="card bars">
        <div className="label">{t('openTasks')}</div>
        {['high', 'medium', 'low'].map((p) => (
          <div className="bar" key={p}>
            <span>{t(p)}</span>
            <div className="track"><div style={{ width: `${(s.byPriority[p] / maxP) * 100}%`, background: COLORS[p] }} /></div>
            <b>{s.byPriority[p]}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
