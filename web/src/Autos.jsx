/* Automations — Phase 6. An n8n view inside the command center.

   Read-only on purpose: the n8n REST API doesn't run workflows, and APM
   shouldn't be able to trigger production without going through the approval
   gate anyway. Here you look; n8n's webhooks are what trigger.

   The first thing drawn is NOT the executions list. A strip of green is what
   this dashboard showed on 27/08/2026 while the Gmail assistant had been down
   for four days: when the trigger is what fails, n8n creates no execution, so
   there's nothing red to count. Silence goes on top — which active workflow
   stopped running — because it's the only signal that failure produces.
   See api/n8n.js. */

import { useEffect, useState } from 'react';
import { api } from './api.js';
import { t, registrar, LOCALE } from './i18n.js';

registrar({
  '{n} min ago': 'hace {n} min', '{n} h ago': 'hace {n} h', '{n} days ago': 'hace {n} días',
  '{n} min': '{n} min', '{n} h': '{n} h', '{n} days': '{n} días', 'Loading…': 'Cargando…',
  '{active} of {total} workflows active': '{active} de {total} workflows activos',
  'read at {time}': 'leído a las {time}',
  'No active workflow has gone silent.': 'Ningún workflow activo se ha quedado en silencio.',
  'silent': 'mudo', 'last {when}': 'última {when}', ' · used to run every {every}': ' · iba cada {every}',
  'Workflows': 'Workflows', 'active': 'activo', 'stopped': 'parado',
  'Latest executions': 'Últimas ejecuciones', 'No recent executions.': 'Sin ejecuciones recientes.',
});

/* "4 days ago" reads at a glance; an ISO 8601 has to be deciphered.
   With `ago` false it's just the duration ("every 2 h"). */
function haceCuanto(ms, ago = true) {
  if (ms == null) return '';
  const h = ms / 3_600_000;
  const [k, n] = h < 1 ? ['min', Math.max(1, Math.round(ms / 60_000))]
    : h < 48 ? ['h', Math.round(h)] : ['days', Math.round(h / 24)];
  return t(ago ? `{n} ${k} ago` : `{n} ${k}`, { n });
}

export default function Autos({ refresco = 0 }) {
  const [ws, setWs] = useState(null);
  const [ex, setEx] = useState([]);
  const [salud, setSalud] = useState(null);
  const [aviso, setAviso] = useState(null);
  /* When this was read from n8n. Without the time, a workflow list from half
     an hour ago reads the same as one from a second ago, and the difference
     matters exactly when something has just broken. */
  const [leidoA, setLeidoA] = useState(null);

  useEffect(() => {
    let vivo = true;
    setAviso(null);
    api('/api/n8n/workflows')
      .then((d) => { if (vivo) { setWs(d); setLeidoA(new Date()); } })
      /* If n8n is down this tab says so and that's it: the rest of the
         dashboard doesn't notice, and shouldn't. */
      .catch((e) => vivo && (setAviso(e.message), setWs([])));
    /* Executions are re-read with the workflows: checking "what broke"
       against yesterday's list is worse than not checking. */
    api('/api/n8n/executions?limit=15').then((d) => vivo && setEx(d)).catch(() => {});
    /* The diagnosis is separate and non-blocking: it asks for an executions
       list per workflow, so it takes longer than the other two. If it fails,
       the tab keeps serving the usual instead of going blank. */
    api('/api/n8n/salud').then((d) => vivo && setSalud(d)).catch(() => {});
    return () => { vivo = false; };
  }, [refresco]);

  if (ws === null) return <div className="empty">{t('Loading…')}</div>;

  const activos = ws.filter((w) => w.active).length;
  const nombre = (id) => ws.find((w) => w.id === id)?.name || id;
  const mudos = salud ? salud.workflows.filter((w) => w.estado === 'mudo') : [];

  return (
    <>
      {aviso && <div className="aviso">{aviso}</div>}

      <h2 className="section-title">
        {t('{active} of {total} workflows active', { active: activos, total: ws.length })}
        {leidoA && <span className="mono" style={{ fontWeight: 400, marginLeft: 8 }}>
          {t('read at {time}', { time: leidoA.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }) })}
        </span>}
      </h2>

      {/* Until the diagnosis arrives nothing is claimed: saying "all good"
          before checking is worse than saying nothing. */}
      {salud && (mudos.length === 0
        ? <div className="empty">{t('No active workflow has gone silent.')}</div>
        : (
          <div className="lista">
            {mudos.map((w) => (
              <div key={w.id} className="fila">
                <span className="chip bad">{t('silent')}</span>
                <span className="titulo">{w.name}</span>
                <span className="mono">
                  {t('last {when}', { when: haceCuanto(w.silencioMs) })}
                  {w.cadenciaMs ? t(' · used to run every {every}', { every: haceCuanto(w.cadenciaMs, false) }) : ''}
                </span>
              </div>
            ))}
          </div>
        ))}

      <h2 className="section-title">{t('Workflows')}</h2>
      <div className="lista">
        {ws.map((w) => (
          <div key={w.id} className="fila">
            <span className={'chip ' + (w.active ? 'ok' : '')}>{w.active ? t('active') : t('stopped')}</span>
            <span className="titulo">{w.name}</span>
          </div>
        ))}
      </div>

      <h2 className="section-title">{t('Latest executions')}</h2>
      {ex.length === 0 ? <div className="empty">{t('No recent executions.')}</div> : (
        <div className="lista">
          {ex.map((e) => (
            <div key={e.id} className="fila">
              <span className={'chip ' + (e.status === 'success' ? 'ok' : e.status === 'error' ? 'bad' : '')}>
                {e.status}
              </span>
              <span className="titulo">{nombre(e.workflowId)}</span>
              <span className="mono">{e.startedAt ? new Date(e.startedAt).toLocaleString(LOCALE) : ''}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
