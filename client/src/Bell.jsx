import React, { useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { LangContext } from './App.jsx';

export default function Bell({ refreshKey }) {
  const t = useContext(LangContext);
  const [data, setData] = useState({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const load = () => api('GET', '/api/notifications').then(setData).catch(() => {});
  useEffect(() => { load(); const i = setInterval(load, 20000); return () => clearInterval(i); }, [refreshKey]);
  const markRead = async () => { await api('POST', '/api/notifications/read'); load(); };
  return (
    <div className="bell">
      <button onClick={() => setOpen(!open)} aria-label={t('notifications')}>Alerts{data.unread > 0 && <span className="badge">{data.unread}</span>}</button>
      {open && (
        <div className="pop card">
          <div className="row"><b className="grow">{t('notifications')}</b><button className="link" onClick={markRead}>{t('markRead')}</button></div>
          {data.items.length === 0 && <p className="empty">{t('nothing')}</p>}
          {data.items.map((n) => <p key={n.id} className={n.read ? '' : 'unread'}>{n.text}<br /><small>{n.created_at}</small></p>)}
        </div>
      )}
    </div>
  );
}
