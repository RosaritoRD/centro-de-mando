/* Areas and projects — Phase 5.

   Checks from the OUTSIDE that the public URLs respond. The host watchdog
   looks at containers from the inside; this looks at what a user sees. A
   healthy container behind a broken proxy is still a site that's down, and
   that difference is exactly the expensive one. */

import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { t, registrar } from './i18n.js';

registrar({
  'Loading…': 'Cargando…', 'Checking…': 'Comprobando…', 'Check now': 'Comprobar ahora',
  'no data': 'sin datos', 'up': 'arriba', 'down': 'caído',
});

export default function Areas({ refresco = 0 }) {
  const [lista, setLista] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(async () => {
    try { setLista(await api('/api/projects')); }
    catch (e) { setAviso(e.message); }
  }, []);

  /* Reloaded with the dashboard's refresh button. Note: this re-reads what the
     watchdog already probed (every 10 min); to force a new probe there's
     "Check now". */
  useEffect(() => { cargar(); }, [cargar, refresco]);

  async function comprobarAhora() {
    setOcupado(true); setAviso(null);
    try { await api('/api/projects/check', { method: 'POST' }); await cargar(); }
    catch (e) { setAviso(e.message); }
    finally { setOcupado(false); }
  }

  if (lista === null) return <div className="empty">{t('Loading…')}</div>;

  const areas = [...new Set(lista.map((p) => p.area))];

  return (
    <>
      {aviso && <div className="aviso">{aviso}</div>}
      <div className="controles" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={comprobarAhora} disabled={ocupado}>
          {ocupado ? t('Checking…') : t('Check now')}
        </button>
      </div>

      {areas.map((a) => (
        <div key={a}>
          <h2 className="section-title">{a}</h2>
          <div className="lista">
            {lista.filter((p) => p.area === a).map((p) => (
              <div key={p.id} className="fila">
                <span className={'chip ' + (!p.ultimo ? '' : p.ultimo.ok ? 'ok' : 'bad')}>
                  {!p.ultimo ? t('no data') : p.ultimo.ok ? t('up') : t('down')}
                </span>
                <span className="titulo">{p.name}</span>
                <span className="mono">
                  {p.ultimo
                    /* The failure reason matters more than the code: "no
                       response within 8s" and "500" are fixed differently. */
                    ? (p.ultimo.ok ? `${p.ultimo.status} · ${p.ultimo.ms} ms`
                                   : (p.ultimo.error || p.ultimo.status))
                    : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
