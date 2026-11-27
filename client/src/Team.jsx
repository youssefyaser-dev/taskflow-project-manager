import React, { useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { LangContext, RoleContext, can } from './App.jsx';

export default function Team({ wid, me, onChange }) {
  const t = useContext(LangContext);
  const role = useContext(RoleContext);
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [f, setF] = useState({ email: '', role: 'member' });
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    if (!wid) return;
    setMembers(await api('GET', `/api/workspaces/${wid}/members`));
    if (can(role, 'admin')) setInvites(await api('GET', `/api/workspaces/${wid}/invites`)); else setInvites([]);
  }, [wid, role]);
  useEffect(() => { load(); }, [load]);

  const invite = async (e) => {
    e.preventDefault(); setErr('');
    try { await api('POST', `/api/workspaces/${wid}/invites`, f); setF({ ...f, email: '' }); load(); } catch (ex) { setErr(ex.message); }
  };
  const setRole = async (m, r) => { try { await api('PATCH', `/api/workspaces/${wid}/members/${m.id}`, { role: r }); } catch (ex) { setErr(ex.message); } load(); };
  const remove = async (m) => {
    if (!window.confirm(t('confirmDelete'))) return;
    try { await api('DELETE', `/api/workspaces/${wid}/members/${m.id}`); } catch (ex) { setErr(ex.message); }
    load(); onChange();
  };
  return (
    <section className="card pad">
      <h3>{t('members')}</h3>
      <table className="table">
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td><b>{m.name}</b><br /><small>{m.email}</small></td>
              <td>
                {can(role, 'admin') && m.role !== 'owner' ? (
                  <select value={m.role} onChange={(e) => setRole(m, e.target.value)}>
                    {['admin', 'member', 'viewer'].map((r) => <option key={r} value={r}>{t(r)}</option>)}
                  </select>
                ) : <span className="pill neutral">{t(m.role)}</span>}
              </td>
              <td>{m.role !== 'owner' && (can(role, 'admin') || m.id === me.id) && <button className="danger-btn" onClick={() => remove(m)}>{t('remove')}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {err && <p className="error">{err}</p>}
      {can(role, 'admin') && (
        <>
          <h3>{t('invite')}</h3>
          <form className="row" onSubmit={invite}>
            <input type="email" required placeholder={t('inviteEmail')} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} style={{ width: 140 }}>
              {['admin', 'member', 'viewer'].map((r) => <option key={r} value={r}>{t(r)}</option>)}
            </select>
            <button className="primary">{t('invite')}</button>
          </form>
          {invites.length > 0 && <h4>{t('pendingInvites')}</h4>}
          <ul className="feed">{invites.map((i) => <li key={i.id}><div><b>{i.email}</b> <small>{t(i.role)}</small><br /><code>{i.code}</code></div></li>)}</ul>
        </>
      )}
    </section>
  );
}
