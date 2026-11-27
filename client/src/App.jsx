import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, setToken, hasToken } from './api.js';
import { STRINGS } from './i18n.js';
import Board from './Board.jsx';
import Stats from './Stats.jsx';
import Report from './Report.jsx';
import Team from './Team.jsx';
import Activity from './Activity.jsx';
import Bell from './Bell.jsx';

export const LangContext = React.createContext((k) => k);
export const RoleContext = React.createContext('viewer');

const RANK = { viewer: 1, member: 2, admin: 3, owner: 4 };
export const can = (role, min) => RANK[role] >= RANK[min];

function AuthForm({ t, onDone }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const submit = async (e, creds) => {
    e?.preventDefault();
    setErr('');
    try {
      const r = await api('POST', mode === 'login' || creds ? '/api/auth/login' : '/api/auth/register', creds || f);
      setToken(r.token);
      onDone(r.user);
    } catch (ex) { setErr(ex.message); }
  };
  return (
    <form className="auth card" onSubmit={submit}>
      <h1>{t('appName')}</h1>
      <h2>{mode === 'login' ? t('signIn') : t('register')}</h2>
      {mode === 'register' && <input placeholder={t('name')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />}
      <input type="email" placeholder={t('email')} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
      <input type="password" placeholder={t('password')} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} />
      {err && <p className="error">{err}</p>}
      <button className="primary">{mode === 'login' ? t('signIn') : t('register')}</button>
      <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? t('noAccount') : t('haveAccount')}
      </button>
      <button type="button" className="link" onClick={() => submit(null, { email: 'demo@taskflow.test', password: 'demo12345' })}>{t('demo')}</button>
    </form>
  );
}

export default function App() {
  const [lang, setLang] = useState(localStorage.getItem('tf_lang') || 'en');
  const t = useCallback((k) => STRINGS[lang][k] ?? k, [lang]);
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!hasToken());
  const [workspaces, setWorkspaces] = useState([]);
  const [wid, setWid] = useState(null);
  const [projects, setProjects] = useState([]);
  const [current, setCurrent] = useState(null);
  const [view, setView] = useState('board');
  const [newName, setNewName] = useState('');
  const [tick, setTick] = useState(0);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('tf_lang', lang);
  }, [lang]);
  useEffect(() => {
    if (!hasToken()) return;
    api('GET', '/api/me').then(setUser).catch(() => {}).finally(() => setReady(true));
  }, []);

  const loadWorkspaces = useCallback(async () => {
    const list = await api('GET', '/api/workspaces');
    setWorkspaces(list);
    setWid((w) => (w && list.some((x) => x.id === w) ? w : list[0]?.id ?? null));
  }, []);
  useEffect(() => { if (user) loadWorkspaces(); }, [user, loadWorkspaces]);

  const loadProjects = useCallback(async () => {
    if (!wid) return;
    const list = await api('GET', `/api/workspaces/${wid}/projects`);
    setProjects(list);
    setCurrent((c) => (c && list.some((p) => p.id === c) ? c : list[0]?.id ?? null));
  }, [wid]);
  useEffect(() => { loadProjects(); }, [loadProjects]);

  const ws = useMemo(() => workspaces.find((w) => w.id === wid), [workspaces, wid]);
  const role = ws?.role || 'viewer';
  const project = useMemo(() => projects.find((p) => p.id === current), [projects, current]);
  const changed = () => { setTick((k) => k + 1); loadProjects(); };

  const addProject = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const colors = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#db2777'];
    const p = await api('POST', `/api/workspaces/${wid}/projects`, { name: newName, color: colors[projects.length % colors.length] });
    setNewName(''); await loadProjects(); setCurrent(p.id); setView('board');
  };
  const removeProject = async (p) => {
    if (!window.confirm(`${t('confirmDelete')} (${p.name})`)) return;
    await api('DELETE', `/api/projects/${p.id}`); await loadProjects();
  };
  const accept = async (e) => {
    e.preventDefault(); setMsg('');
    try { const r = await api('POST', '/api/invites/accept', { code }); setCode(''); await loadWorkspaces(); setWid(r.workspace_id); }
    catch (ex) { setMsg(ex.message); }
  };
  const newWs = async () => {
    const name = window.prompt(t('workspace'));
    if (!name) return;
    const w = await api('POST', '/api/workspaces', { name });
    await loadWorkspaces(); setWid(w.id);
  };

  if (!ready) return null;
  const tabs = [['board', 'board'], ['report', 'report'], ['team', 'team'], ['activity', 'activity']];
  return (
    <LangContext.Provider value={t}>
      <RoleContext.Provider value={role}>
        <div className="shell">
          {!user ? (
            <div className="center">
              <button className="lang" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>{lang === 'en' ? 'العربية' : 'English'}</button>
              <AuthForm t={t} onDone={setUser} />
            </div>
          ) : (
            <>
              <aside className="side">
                <div className="brand"><span className="logo">✓</span> {t('appName')}</div>
                <h3>{t('workspace')}</h3>
                <div className="row">
                  <select className="dark" value={wid || ''} onChange={(e) => setWid(Number(e.target.value))}>
                    {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  <button className="lang" title={t('newWorkspace')} onClick={newWs}>+</button>
                </div>
                <h3>{t('projects')}</h3>
                <ul>
                  {projects.map((p) => (
                    <li key={p.id} className={p.id === current ? 'active' : ''} onClick={() => { setCurrent(p.id); setView('board'); }}>
                      <span className="dot" style={{ background: p.color }} />
                      <span className="grow">{p.name}</span>
                      <small>{p.done}/{p.total}</small>
                      {can(role, 'admin') && <button className="x" title={t('delete')} onClick={(e) => { e.stopPropagation(); removeProject(p); }}>×</button>}
                    </li>
                  ))}
                </ul>
                {can(role, 'admin') && (
                  <form className="newproj" onSubmit={addProject}>
                    <input placeholder={t('newProject')} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} />
                    <button className="primary">+</button>
                  </form>
                )}
                <form className="newproj" onSubmit={accept}>
                  <input placeholder={t('acceptCode')} value={code} onChange={(e) => setCode(e.target.value)} />
                  <button>{t('join')}</button>
                </form>
                {msg && <p className="error">{msg}</p>}
                <div className="spacer" />
                <div className="who">{user.name} · {t(role)}</div>
                <div className="row">
                  <button className="lang" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>{lang === 'en' ? 'العربية' : 'English'}</button>
                  <button className="lang" onClick={() => { setToken(''); setUser(null); setProjects([]); setWorkspaces([]); }}>{t('signOut')}</button>
                </div>
              </aside>
              <main className="main">
                <header className="top">
                  <h2>{project && <span className="dot" style={{ background: project.color }} />} {project ? project.name : ws?.name}</h2>
                  <nav className="tabs">
                    {tabs.map(([k, label]) => (
                      <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{t(label)}</button>
                    ))}
                  </nav>
                  <Bell refreshKey={tick} />
                </header>
                {view === 'board' && (project ? (
                  <>
                    <Stats projectId={project.id} refreshKey={tick} />
                    <Board projectId={project.id} wid={wid} me={user} onChange={changed} />
                  </>
                ) : <p className="empty">{t('pickProject')}</p>)}
                {view === 'report' && (project ? <Report project={project} refreshKey={tick} /> : <p className="empty">{t('pickProject')}</p>)}
                {view === 'team' && <Team wid={wid} me={user} onChange={loadWorkspaces} />}
                {view === 'activity' && <Activity wid={wid} refreshKey={tick} />}
              </main>
            </>
          )}
        </div>
      </RoleContext.Provider>
    </LangContext.Provider>
  );
}
