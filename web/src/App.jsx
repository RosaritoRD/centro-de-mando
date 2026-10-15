import { useEffect, useState } from 'react';
import { api, ApiError } from './api.js';
import Chat from './Chat.jsx';
import Approvals from './Approvals.jsx';
import Areas from './Areas.jsx';
import Autos from './Autos.jsx';
import Leads from './Leads.jsx';

/* tu-dominio.com, no tu-dominio.com: la cookie `__session` la emite tu web principal con
   Domain derivado de SU APP_BASE_URL, que el 14/08 pasó a tu-dominio.com. Una
   cookie de .tu-dominio.com no viaja a apm.tu-dominio.com, así que APM en el
   dominio viejo no puede autenticar NUNCA — 401 en bucle. Este dominio y el de
   la cookie tienen que ser el mismo registrable. */
const SIGNIN = 'https://signin.tu-dominio.com/?step=login';

const AREAS = [
  { id: 'overview', label: 'Resumen', description: 'Lo que está en marcha y lo que necesita tu atención.' },
  { id: 'chat', label: 'Asistente', description: 'Delega una tarea y sigue cada paso de tus agentes.' },
  { id: 'approvals', label: 'Aprobaciones', description: 'Revisa las acciones que esperan tu decisión.' },
  { id: 'leads', label: 'Prospección', description: 'Encuentra contactos, prepara llamadas y registra resultados.' },
  { id: 'areas', label: 'Proyectos', description: 'Comprueba la disponibilidad de tus sitios y servicios.' },
  { id: 'autos', label: 'Automatizaciones', description: 'Supervisa tus flujos y detecta interrupciones.' },
  { id: 'inbox', label: 'Bandeja de entrada', description: 'Tus conversaciones, en un solo lugar.', upcoming: true }
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
    try { localStorage.setItem('apm-theme', theme); } catch { /* sin storage */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

function Gate({ motivo }) {
  /* Dos motivos distintos, dos mensajes distintos. Un 403 mandado a la
     pantalla de login produce un bucle: el usuario se identifica bien, vuelve,
     y lo vuelven a echar. Eso ya pasó una vez en el panel de tu web. */
  const sinSesion = motivo === 'no_session' || motivo === 'invalid_session';
  const sinConexion = motivo === 'network' || motivo === 'error';
  return (
    <div className="gate">
      <div className="card">
        <h1>APM</h1>
        {sinConexion ? <><p>No se pudo conectar con APM. Vuelve a intentarlo en unos momentos.</p><button className="btn" onClick={() => window.location.reload()}>Reintentar</button></> : sinSesion ? (
          <>
            <p>Tu sesión no está activa o caducó.</p>
            <a className="btn" href={SIGNIN}>Identificarme</a>
          </>
        ) : (
          <>
            <p>
              Tu cuenta es válida, pero no está autorizada para el centro de mando.
              APM es de una sola persona.
            </p>
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
  const statuses = { done: 'Completada', failed: 'Con error', running: 'En curso', queued: 'En cola', awaiting_approval: 'Espera aprobación', interrupted: 'Interrumpida' };
  return (
    <>
      <section className="command-brief" aria-label="Siguiente acción">
        <div className="brief-icon"><Icon name={approvals ? 'approvals' : 'chat'} /></div>
        <div className="brief-copy">
          <p className="eyebrow">TU SIGUIENTE PASO</p>
          <h2>{pending === null ? 'Pon tus proyectos en marcha' : approvals ? `${approvals} ${approvals === 1 ? 'acción espera' : 'acciones esperan'} tu aprobación` : 'Todo listo para tu próxima tarea'}</h2>
          <p>{approvals ? 'Tus agentes necesitan una decisión para continuar.' : 'Abre el asistente para delegar o continúa con tu prospección.'}</p>
        </div>
        <button className="btn" onClick={() => go(approvals ? 'approvals' : 'chat')}>
          {approvals ? 'Revisar aprobaciones' : 'Abrir asistente'} <Icon name="arrow" />
        </button>
      </section>

      <div className="grid metrics-grid">
        <article className="card metric-card">
          <h3>Presupuesto de hoy <span className="metric-unit">USD</span></h3>
          <div className="big">{budget ? `$${budget.spentUsd.toFixed(2)}` : '—'} <span>/ {budget ? `$${budget.limitUsd.toFixed(2)}` : '—'}</span></div>
          <div className="bar" role="progressbar" aria-label="Presupuesto utilizado" aria-valuemin={0} aria-valuemax={100} aria-valuenow={budget ? pct : undefined}><i style={{ width: `${pct}%` }} /></div>
          <div className="sub">{budget ? `$${budget.remainingUsd.toFixed(2)} disponibles · ${pct}% utilizado` : refreshing ? 'Cargando presupuesto…' : 'Presupuesto no disponible'}</div>
        </article>
        <article className="card metric-card">
          <h3>Agentes trabajando <Icon name="autos" /></h3>
          <div className="big">{runs?.vivas ?? '—'} <span>/ {me.limits.maxConcurrentRuns}</span></div>
          <div className="sub">Ejecuciones activas / límite simultáneo</div>
        </article>
        <article className="card metric-card">
          <h3>Estado del sistema <span className={'punto ' + (health?.ok ? 'vivo' : health ? 'malo' : '')} /></h3>
          <div className="system-state">{health ? (health.ok ? 'Operativo' : 'Requiere atención') : refreshing ? 'Comprobando…' : 'Sin datos'}</div>
          <div className="sub">{health ? (health.db === 'up' ? 'Base de datos conectada' : 'Revisar conexión con la base de datos') : refreshing ? 'Consultando servicios' : 'No se pudo comprobar el estado'}</div>
        </article>
      </div>

      <section className="workspace-section">
        <div className="section-heading"><h2>Accesos de trabajo</h2><span>Continúa donde lo dejaste</span></div>
        <div className="work-shortcuts">
          {[['leads', 'Preparar llamadas', 'Contactos, guiones y seguimiento'], ['areas', 'Revisar proyectos', 'Disponibilidad de tus servicios'], ['autos', 'Ver automatizaciones', 'Flujos activos y últimas ejecuciones']].map(([id, title, text]) => (
            <button className="work-shortcut" key={id} onClick={() => go(id)}><span className="shortcut-icon"><Icon name={id} /></span><span><strong>{title}</strong><small>{text}</small></span><Icon name="arrow" /></button>
          ))}
        </div>
      </section>
      <section className="workspace-section">
        <div className="section-heading"><h2>Actividad reciente</h2><button className="text-action" onClick={() => go('chat')}>Ver conversaciones <Icon name="arrow" /></button></div>
        {runs === null && refreshing ? <div className="empty" role="status">Cargando actividad…</div> : runs === null ? <div className="empty"><strong>No se pudo cargar la actividad.</strong>Pulsa Actualizar para volver a intentarlo.</div>
          : runs.runs.length === 0 ? <div className="empty"><strong>Tu primera tarea empieza en el asistente.</strong>Pídele que revise un proyecto o te ayude a preparar una llamada.<button className="text-action" onClick={() => go('chat')}>Crear una conversación <Icon name="arrow" /></button></div>
          : <div className="lista recent-runs">{runs.runs.map((r) => <div key={r.id} className="fila">
            <span className={'chip ' + (r.status === 'done' ? 'ok' : r.status === 'failed' ? 'bad' : '')}>{statuses[r.status] || r.status}</span>
            <span className="titulo">{r.title}</span><span className="mono">${r.costUsd.toFixed(4)}</span>
          </div>)}</div>}
      </section>
    </>
  );
}

/* Cada cuánto se relee el panel entero. Un minuto y no cinco segundos: lo que
   se mira aquí (presupuesto del día, salud de los sitios, workflows de n8n)
   cambia en minutos, y APM se deja abierto en una pestaña durante horas. */
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
  /* Un contador y no una función: se le pasa a cada pestaña como prop y cada
     una lo mete en las dependencias de su efecto. Así "actualizar" actualiza
     TODO —resumen, sitios, n8n, aprobaciones— sin que el shell tenga que
     saber qué carga cada pestaña. */
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

  /* La salud, el presupuesto y las ejecuciones vivas no bloquean la pantalla:
     si fallan, el panel se ve igual con guiones en vez de números. */
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

  /* Refresco solo con la pestaña a la vista. En el móvil, APM se queda
     abierto en segundo plano días enteros: sin esta condición serían miles de
     peticiones al día para pintar algo que nadie está mirando. */
  useEffect(() => {
    if (estado.fase !== 'dentro') return undefined;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setRefresco((n) => n + 1);
    }, CADA_MS);
    const alVolver = () => {
      if (document.visibilityState === 'visible') setRefresco((n) => n + 1);
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver); };
  }, [estado.fase]);

  if (estado.fase === 'cargando') {
    return <div className="gate"><div className="card"><p>Cargando…</p></div></div>;
  }
  if (estado.fase === 'fuera') return <Gate motivo={estado.motivo} />;

  const area = AREAS.find((a) => a.id === tab);
  return (
    <div className="apm-shell">
      <a href="#main-content" className="skip-link">Saltar al contenido</a>
      <aside className="workspace-sidebar">
        <a className="workspace-brand" href="#overview"><span className="brand-symbol"><Icon name="overview" /></span><span className="brand">tu empresa <span>APM</span><small>Centro de mando</small></span></a>
        <p className="nav-caption">ESPACIO DE TRABAJO</p>
        <nav className="workspace-nav" aria-label="Navegación principal">
          {AREAS.map((a) => <button key={a.id} onClick={() => go(a.id)} aria-current={tab === a.id ? 'page' : undefined}>
            <Icon name={a.id} /><span>{a.label}</span>
            {a.id === 'approvals' && pending?.length > 0 && <b className="nav-count">{pending.length}</b>}
            {a.upcoming && <small>Pronto</small>}
          </button>)}
        </nav>
        <div className="workspace-footer"><span className="workspace-avatar">K</span><div><strong>tu empresa</strong><small>Espacio personal</small></div><span className={'punto ' + (health?.ok ? 'vivo' : '')} /></div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <div className="breadcrumb">Centro de mando <span>/</span> <strong>{area.label}</strong></div>
          <div className="header-tools">
            <span className={'chip ' + (health ? (health.ok ? 'ok' : 'bad') : '')}>{health ? (health.ok ? 'Operativo' : 'Requiere atención') : 'Sin datos'}</span>
            <button className="iconbtn" onClick={() => setRefresco((n) => n + 1)} disabled={refreshing} aria-label="Actualizar todo" title="Actualizar todo"><span className={refreshing ? 'is-refreshing' : ''}><Icon name="refresh" /></span></button>
            <button className="iconbtn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'} title={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}>{theme === 'dark' ? '☀' : '☾'}</button>
          </div>
        </header>
        <main id="main-content" className="workspace-main" tabIndex={-1}>
          <div className="page-heading"><div><p className="eyebrow">{tab === 'overview' ? 'TU OPERACIÓN, DE UN VISTAZO' : 'CENTRO DE MANDO'}</p><h1>{area.label}</h1><p>{area.description}</p></div><span className="sync-label" role="status">{refreshing ? 'Actualizando…' : loadError ? 'Actualización incompleta' : updatedAt ? `Actualizado ${updatedAt.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}` : 'Esperando datos'}</span></div>
          {loadError && <div className="aviso" role="alert">No se pudieron cargar algunos datos. <button className="text-action" onClick={() => setRefresco((n) => n + 1)}>Reintentar</button></div>}
          {tab === 'overview' ? <Overview me={estado.me} budget={budget} health={health} runs={runs} pending={pending} go={go} refreshing={refreshing} />
            : tab === 'chat' ? <Chat refresco={refresco} />
            : tab === 'approvals' ? <Approvals refresco={refresco} />
            : tab === 'areas' ? <Areas refresco={refresco} />
            : tab === 'autos' ? <Autos refresco={refresco} />
            : tab === 'leads' ? <Leads refresco={refresco} />
            : <div className="empty"><strong>La bandeja de entrada estará disponible próximamente.</strong>Mientras tanto, puedes consultar las conversaciones con tus agentes en el asistente.<button className="text-action" onClick={() => go('chat')}>Abrir asistente <Icon name="arrow" /></button></div>}
        </main>
      </div>
    </div>
  );
}
