import React, { useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { LangContext } from './App.jsx';

function Burndown({ data }) {
  const W = 640, H = 200, P = 28;
  const max = Math.max(1, ...data.map((d) => d.remaining));
  const x = (i) => P + (i * (W - 2 * P)) / Math.max(1, data.length - 1);
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const pts = data.map((d, i) => `${x(i)},${y(d.remaining)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
      {[0, 0.5, 1].map((g) => <g key={g}><line x1={P} x2={W - P} y1={y(max * g)} y2={y(max * g)} stroke="#e5e7eb" /><text x={4} y={y(max * g) + 4} fontSize="11" fill="#6b7280">{Math.round(max * g)}</text></g>)}
      <polygon points={`${P},${H - P} ${pts} ${W - P},${H - P}`} fill="#4f46e522" />
      <polyline points={pts} fill="none" stroke="#4f46e5" strokeWidth="2.5" />
      {data.map((d, i) => <circle key={d.date} cx={x(i)} cy={y(d.remaining)} r="3" fill="#4f46e5"><title>{d.date}: {d.remaining}</title></circle>)}
      <text x={P} y={H - 8} fontSize="11" fill="#6b7280">{data[0]?.date}</text>
      <text x={W - P} y={H - 8} fontSize="11" fill="#6b7280" textAnchor="end">{data.at(-1)?.date}</text>
    </svg>
  );
}

const hm = (m) => `${Math.floor(m / 60)}h ${m % 60}m`;

export default function Report({ project, refreshKey }) {
  const t = useContext(LangContext);
  const [r, setR] = useState(null);
  useEffect(() => { api('GET', `/api/projects/${project.id}/report?days=14`).then(setR); }, [project.id, refreshKey]);
  const exportCsv = async () => {
    const res = await fetch(`/api/projects/${project.id}/export.csv`, { headers: { authorization: `Bearer ${localStorage.getItem('tf_token')}` } });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `${project.name}.csv` });
    a.click(); URL.revokeObjectURL(url);
  };
  if (!r) return null;
  const maxT = Math.max(1, ...r.time.map((x) => x.minutes));
  return (
    <div className="reportgrid">
      <section className="card pad wide"><div className="row"><h3 className="grow">{t('burndown')}</h3><button onClick={exportCsv}>{t('exportCsv')}</button></div><Burndown data={r.burndown} /></section>
      <section className="card pad"><h3>{t('workload')}</h3>
        <table className="table"><tbody>{r.workload.map((w) => <tr key={w.name}><td>{w.name}</td><td>{w.open_tasks} {t('tasks')}</td><td><small>{hm(w.estimate_min)}</small></td></tr>)}</tbody></table>
      </section>
      <section className="card pad"><h3>{t('timeByPerson')}</h3>
        {r.time.length === 0 && <p className="empty">{t('nothing')}</p>}
        {r.time.map((x) => (
          <div className="bar wide-bar" key={x.name}><span>{x.name}</span><div className="track"><div style={{ width: `${(x.minutes / maxT) * 100}%`, background: '#4f46e5' }} /></div><b>{hm(x.minutes)}</b></div>
        ))}
      </section>
    </div>
  );
}
