import { useEffect, useState } from 'react';
import { api, ApiError } from './api.js';
import Chat from './Chat.jsx';
import Approvals from './Approvals.jsx';
import Areas from './Areas.jsx';
import Autos from './Autos.jsx';
import Leads from './Leads.jsx';
import { t, tn, LANG, LOCALE, setLang } from './i18n.js';

/* your-domain.com, not your-domain.com: your main website issues the `__session` cookie
   with a Domain derived from ITS APP_BASE_URL, which moved to your-domain.com on
   14/08. A .your-domain.com cookie never travels to apm.your-domain.com, so APM on
   the old domain can NEVER authenticate — a 401 loop. This domain and the
   cookie's must be the same registrable domain. */
const SIGNIN = 'https://signin.your-domain.com/?step=login';

const AREAS = [
  { id: 'overview', label: t('Overview'), description: t("What's running and what needs your attention.") },
  { id: 'chat', label: t('Assistant'), description: t('Delegate a task and follow every step your agents take.') },
  { id: 'approvals', label: t('Approvals'), description: t('Review the actions waiting for your decision.') },
  { id: 'leads', label: t('Prospecting'), description: t('Find contacts, prepare calls and log results.') },
  { id: 'areas', label: t('Projects'), description: t('Check that your sites and services are up.') },
  { id: 'autos', label: t('Automations'), description: t('Watch your workflows and catch interruptions.') },
  { id: 'inbox', label: t('Inbox'), description: t('All your conversations in one place.'), upcoming: true }
];

function Icon({ name }) {
  const paths = {
    overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    chat: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z M7 9h9 M7 13h6',
    approvals: 'm8 12 3 3 5-6 M12 3l8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6Z',
    leads: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M18 8h4 M20 6v4 M19 15a4 4 0 0 1 3 4v2',
    areas: 'M3 5h6l2 2h10v13H3Z M7 11h10 M7 15h6',
    autos: 'm13 2-9 12h7l-1 8 10-12h-7Z',
    inbox: 'M4 4h16l2 12v4H2v-4Z M2 16h6l2 2h4l2-2h6',
    refresh: 'M20 7a9 9 0 1 0 1 8 M20 2v6h-6',
    arrow: 'M4 12h16 m-6-6 6 6-6 6'
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.overview} /></svg>;
}

function initialTab() {
  const id = window.location.hash.slice(1);
  return AREAS.some((a) => a.id === id) ? id : 'overview';
}

function useTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  useEffect(() => {
    document.body.dataset.theme = theme;
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('apm-theme', theme); } catch { /* no storage */ }
  }, [theme]);
  return [theme, () => setTheme((x) => (x === 'dark' ? 'light' : 'dark'))];
}

function Gate({ motivo }) {
  /* Two different reasons, two different messages. A 403 sent to the login
     screen creates a loop: the user signs in fine, comes back and gets thrown
     out again. That already happened once in your website's dashboard. */
  const sinSesion = motivo === 'no_session' || motivo === 'invalid_session';
  const sinConexion = motivo === 'network' || motivo === 'error';
  return (
    <div className="gate">
      <div className="card">
        <h1>APM</h1>
        {sinConexion ? <><p>{t('Could not connect to APM. Try again in a moment.')}</p><button className="btn" onClick={() => window.location.reload()}>{t('Retry')}</button></> : sinSesion ? (
          <>
            <p>{t('Your session is not active or has expired.')}</p>
            <a className="btn" href={SIGNIN}>{t('Sign in')}</a>
          </>
        ) : (
          <>
            <p>{t('Your account is valid, but it is not authorized for the command center. APM belongs to a single person.')}</p>
            <p className="mono">{motivo}</p>
          </>
        )}
      </div>
    </div>
  );
}

function Overview({ me, budget, health, runs, pending, go, refreshing }) {
  const pct = budget && budget.limitUsd > 0
    ? Math.max(0, Math.min(100, Math.round((budget.spentUsd / budget.limitUsd) * 100))) : 0;
  const approvals = pending?.length;
  const statuses = { done: t('Done'), failed: t('Failed'), running: t('Running'), queued: t('Queued'), awaiting_approval: t('Awaiting approval'), interrupted: t('Interrupted') };
  return (
    <>
      <section className="command-brief" aria-label={t('Next action')}>
        <div className="brief-icon"><Icon name={approvals ? 'approvals' : 'chat'} /></div>
        <div className="brief-copy">
          <p className="eyebrow">{t('YOUR NEXT STEP')}</p>
          <h2>{pending === null ? t('Get your projects going') : approvals ? tn(approvals, '{n} action is waiting for your approval', '{n} actions are waiting for your approval') : t('All set for your next task')}</h2>
          <p>{approvals ? t('Your agents need a decision to continue.') : t('Open the assistant to delegate, or carry on with your prospecting.')}</p>
        </div>
        <button className="btn" onClick={() => go(approvals ? 'approvals' : 'chat')}>
          {approvals ? t('Review approvals') : t('Open assistant')} <Icon name="arrow" />
        </button>
      </section>

      <div className="grid metrics-grid">
        <article className="card metric-card">
          <h3>{t("Today's budget")} <span className="metric-unit">USD</span></h3>
          <div className="big">{budget ? `$${budget.spentUsd.toFixed(2)}` : '—'} <span>/ {budget ? `$${budget.limitUsd.toFixed(2)}` : '—'}</span></div>
          <div className="bar" role="progressbar" aria-label={t('Budget used')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={budget ? pct : undefined}><i style={{ width: `${pct}%` }} /></div>
          <div className="sub">{budget ? t('{left} available · {pct}% used', { left: `$${budget.remainingUsd.toFixed(2)}`, pct }) : refreshing ? t('Loading budget…') : t('Budget unavailable')}</div>
        </article>
        <article className="card metric-card">
          <h3>{t('Agents working')} <Icon name="autos" /></h3>
          <div className="big">{runs?.vivas ?? '—'} <span>/ {me.limits.maxConcurrentRuns}</span></div>
          <div className="sub">{t('Active runs / concurrency limit')}</div>
        </article>
        <article className="card metric-card">
          <h3>{t('System status')} <span className={'punto ' + (health?.ok ? 'vivo' : health ? 'malo' : '')} /></h3>
          <div className="system-state">{health ? (health.ok ? t('Operational') : t('Needs attention')) : refreshing ? t('Checking…') : t('No data')}</div>
          <div className="sub">{health ? (health.db === 'up' ? t('Database connected') : t('Check the database connection')) : refreshing ? t('Querying services') : t('Could not check the status')}</div>
        </article>
      </div>

      <section className="workspace-section">
        <div className="section-heading"><h2>{t('Work shortcuts')}</h2><span>{t('Pick up where you left off')}</span></div>
        <div className="work-shortcuts">
          {[['leads', t('Prepare calls'), t('Contacts, scripts and follow-up')], ['areas', t('Review projects'), t('Availability of your services')], ['autos', t('View automations'), t('Active workflows and latest executions')]].map(([id, title, text]) => (
            <button className="work-shortcut" key={id} onClick={() => go(id)}><span className="shortcut-icon"><Icon name={id} /></span><span><strong>{title}</strong><small>{text}</small></span><Icon name="arrow" /></button>
          ))}
        </div>
      </section>
      <section className="workspace-section">
        <div className="section-heading"><h2>{t('Recent activity')}</h2><button className="text-action" onClick={() => go('chat')}>{t('View conversations')} <Icon name="arrow" /></button></div>
        {runs === null && refreshing ? <div className="empty" role="status">{t('Loading activity…')}</div> : runs === null ? <div className="empty"><strong>{t('Could not load the activity.')}</strong>{t('Press Refresh to try again.')}</div>
          : runs.runs.length === 0 ? <div className="empty"><strong>{t('Your first task starts in the assistant.')}</strong>{t('Ask it to check a project or help you prepare a call.')}<button className="text-action" onClick={() => go('chat')}>{t('Start a conversation')} <Icon name="arrow" /></button></div>
          : <div className="lista recent-runs">{runs.runs.map((r) => <div key={r.id} className="fila">
            <span className={'chip ' + (r.status === 'done' ? 'ok' : r.status === 'failed' ? 'bad' : '')}>{statuses[r.status] || r.status}</span>
            <span className="titulo">{r.title}</span><span className="mono">${r.costUsd.toFixed(4)}</span>
          </div>)}</div>}
      </section>
    </>
  );
}

/* How often the whole dashboard is re-read. One minute, not five seconds: what
   you look at here (daily budget, site health, n8n workflows) changes over
   minutes, and APM is left open in a tab for hours. */
const CADA_MS = 60_000;

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [estado, setEstado] = useState({ fase: 'cargando' });
  const [tab, setTab] = useState(initialTab);
  const [budget, setBudget] = useState(null);
  const [health, setHealth] = useState(null);
  const [runs, setRuns] = useState(null);
  const [pending, setPending] = useState(null);
  const [refreshing, setRefreshing] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loadError, setLoadError] = useState(false);

  function go(id) {
    if (id !== tab) window.location.hash = id;
    setTab(id);
  }
  useEffect(() => {
    const onHash = () => {
      const id = window.location.hash.slice(1) || 'overview';
      if (AREAS.some((a) => a.id === id)) setTab(id);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    document.title = `${AREAS.find((a) => a.id === tab).label} · APM`;
  }, [tab]);
  /* A counter, not a function: it's passed to each tab as a prop and each one
     puts it in its effect's dependencies. That way "refresh" refreshes
     EVERYTHING — overview, sites, n8n, approvals — without the shell having to
     know what each tab loads. */
  const [refresco, setRefresco] = useState(0);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const me = await api('/api/me');
        if (!vivo) return;
        setEstado({ fase: 'dentro', me });
      } catch (e) {
        if (!vivo) return;
        const code = e instanceof ApiError ? (e.code || 'error') : 'network';
        setEstado({ fase: 'fuera', motivo: code });
      }
    })();
    return () => { vivo = false; };
  }, []);

  /* Health, budget and live runs don't block the screen: if they fail, the
     dashboard still renders with dashes instead of numbers. */
  useEffect(() => {
    if (estado.fase !== 'dentro') return undefined;
    let vivo = true;
    setRefreshing(true);
    Promise.allSettled([api('/api/health'), api('/api/budget'), api('/api/runs?limit=8'), api('/api/approvals')])
      .then((results) => {
        if (!vivo) return;
        const [h, b, r, a] = results;
        setHealth(h.status === 'fulfilled' ? h.value : null);
        setBudget(b.status === 'fulfilled' ? b.value : null);
        setRuns(r.status === 'fulfilled' ? r.value : null);
        setPending(a.status === 'fulfilled' ? a.value : null);
        const failed = results.some((result) => result.status === 'rejected');
        setLoadError(failed);
        if (!failed) setUpdatedAt(new Date());
        setRefreshing(false);
      });
    return () => { vivo = false; };
  }, [estado.fase, refresco]);

  /* Refresh only while the tab is visible. On a phone, APM stays open in the
     background for days: without this check it would be thousands of requests
     a day to render something nobody is looking at. */
  useEffect(() => {
    if (estado.fase !== 'dentro') return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setRefresco((n) => n + 1);
    }, CADA_MS);
    const alVolver = () => {
      if (document.visibilityState === 'visible') setRefresco((n) => n + 1);
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', alVolver); };
  }, [estado.fase]);

  if (estado.fase === 'cargando') {
    return <div className="gate"><div className="card"><p>{t('Loading…')}</p></div></div>;
  }
  if (estado.fase === 'fuera') return <Gate motivo={estado.motivo} />;

  const area = AREAS.find((a) => a.id === tab);
  return (
    <div className="apm-shell">
      <a href="#main-content" className="skip-link">{t('Skip to content')}</a>
      <aside className="workspace-sidebar">
        <a className="workspace-brand" href="#overview"><span className="brand-symbol"><Icon name="overview" /></span><span className="brand">Acme <span>APM</span><small>{t('Command center')}</small></span></a>
        <p className="nav-caption">{t('WORKSPACE')}</p>
        <nav className="workspace-nav" aria-label={t('Main navigation')}>
          {AREAS.map((a) => <button key={a.id} onClick={() => go(a.id)} aria-current={tab === a.id ? 'page' : undefined}>
            <Icon name={a.id} /><span>{a.label}</span>
            {a.id === 'approvals' && pending?.length > 0 && <b className="nav-count">{pending.length}</b>}
            {a.upcoming && <small>{t('Soon')}</small>}
          </button>)}
        </nav>
        <div className="workspace-footer"><span className="workspace-avatar">K</span><div><strong>Acme</strong><small>{t('Personal workspace')}</small></div><span className={'punto ' + (health?.ok ? 'vivo' : '')} /></div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <div className="breadcrumb">{t('Command center')} <span>/</span> <strong>{area.label}</strong></div>
          <div className="header-tools">
            <span className={'chip ' + (health ? (health.ok ? 'ok' : 'bad') : '')}>{health ? (health.ok ? t('Operational') : t('Needs attention')) : t('No data')}</span>
            <button className="iconbtn" onClick={() => setRefresco((n) => n + 1)} disabled={refreshing} aria-label={t('Refresh everything')} title={t('Refresh everything')}><span className={refreshing ? 'is-refreshing' : ''}><Icon name="refresh" /></span></button>
            <button className="iconbtn" onClick={toggleTheme} aria-label={theme === 'dark' ? t('Switch to light theme') : t('Switch to dark theme')} title={theme === 'dark' ? t('Light theme') : t('Dark theme')}>{theme === 'dark' ? '☀' : '☾'}</button>
            <button className="iconbtn" onClick={() => setLang(LANG === 'es' ? 'en' : 'es')} aria-label={t('Language')} title={t('Language')}>{LANG === 'es' ? 'EN' : 'ES'}</button>
          </div>
        </header>
        <main id="main-content" className="workspace-main" tabIndex={-1}>
          <div className="page-heading"><div><p className="eyebrow">{tab === 'overview' ? t('YOUR OPERATION AT A GLANCE') : t('COMMAND CENTER')}</p><h1>{area.label}</h1><p>{area.description}</p></div><span className="sync-label" role="status">{refreshing ? t('Updating…') : loadError ? t('Partial update') : updatedAt ? t('Updated {time}', { time: updatedAt.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }) }) : t('Waiting for data')}</span></div>
          {loadError && <div className="aviso" role="alert">{t('Some data could not be loaded.')} <button className="text-action" onClick={() => setRefresco((n) => n + 1)}>{t('Retry')}</button></div>}
          {tab === 'overview' ? <Overview me={estado.me} budget={budget} health={health} runs={runs} pending={pending} go={go} refreshing={refreshing} />
            : tab === 'chat' ? <Chat refresco={refresco} />
            : tab === 'approvals' ? <Approvals refresco={refresco} />
            : tab === 'areas' ? <Areas refresco={refresco} />
            : tab === 'autos' ? <Autos refresco={refresco} />
            : tab === 'leads' ? <Leads refresco={refresco} />
            : <div className="empty"><strong>{t('The inbox will be available soon.')}</strong>{t('In the meantime, you can see your conversations with your agents in the assistant.')}<button className="text-action" onClick={() => go('chat')}>{t('Open assistant')} <Icon name="arrow" /></button></div>}
        </main>
      </div>
    </div>
  );
}
