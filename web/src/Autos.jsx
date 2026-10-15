/* Automatizaciones — Fase 6. Vista de n8n dentro del centro de mando.

   Solo lectura a propósito: la REST API de n8n no ejecuta workflows, y
   además APM no debería poder disparar producción sin pasar por la puerta de
   aprobación. Aquí se mira; lo que dispara son los webhooks de n8n.

   Lo primero que se pinta NO es la lista de ejecuciones. Una tira de verdes
   es lo que enseñaba este panel el 27/08/2026 mientras el asistente de Gmail
   llevaba cuatro días caído: cuando el que falla es el trigger, n8n no crea
   ninguna ejecución, así que no hay nada rojo que contar. Arriba va el
   silencio —qué workflow activo ha dejado de ejecutarse— porque es la única
   señal que ese fallo produce. Ver api/n8n.js. */

import { useEffect, useState } from 'react';
import { api } from './api.js';

/* "hace 4 días" se entiende de un vistazo; un ISO 8601 hay que descifrarlo. */
function haceCuanto(ms) {
  if (ms == null) return '';
  const h = ms / 3_600_000;
  if (h < 1) return `hace ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 48) return `hace ${Math.round(h)} h`;
  return `hace ${Math.round(h / 24)} días`;
}

export default function Autos({ refresco = 0 }) {
  const [ws, setWs] = useState(null);
  const [ex, setEx] = useState([]);
  const [salud, setSalud] = useState(null);
  const [aviso, setAviso] = useState(null);
  /* Cuándo se leyó esto de n8n. Sin la hora, una lista de workflows de hace
     media hora se lee igual que una de hace un segundo, y la diferencia
     importa justo cuando algo se acaba de romper. */
  const [leidoA, setLeidoA] = useState(null);

  useEffect(() => {
    let vivo = true;
    setAviso(null);
    api('/api/n8n/workflows')
      .then((d) => { if (vivo) { setWs(d); setLeidoA(new Date()); } })
      /* Si n8n está caído lo dice esta pestaña y ya: el resto del panel no
         se entera ni debe enterarse. */
      .catch((e) => vivo && (setAviso(e.message), setWs([])));
    /* Las ejecuciones se releen con los workflows: mirar "qué se ha roto" con
       la lista de ayer es peor que no mirarla. */
    api('/api/n8n/executions?limit=15').then((d) => vivo && setEx(d)).catch(() => {});
    /* El diagnóstico va aparte y sin bloquear: pide una lista de ejecuciones
       por workflow, así que tarda más que las otras dos. Si falla, la pestaña
       sigue sirviendo lo de siempre en vez de quedarse en blanco. */
    api('/api/n8n/salud').then((d) => vivo && setSalud(d)).catch(() => {});
    return () => { vivo = false; };
  }, [refresco]);

  if (ws === null) return <div className="empty">Cargando…</div>;

  const activos = ws.filter((w) => w.active).length;
  const nombre = (id) => ws.find((w) => w.id === id)?.name || id;
  const mudos = salud ? salud.workflows.filter((w) => w.estado === 'mudo') : [];

  return (
    <>
      {aviso && <div className="aviso">{aviso}</div>}

      <h2 className="section-title">
        {activos} de {ws.length} workflows activos
        {leidoA && <span className="mono" style={{ fontWeight: 400, marginLeft: 8 }}>
          leído a las {leidoA.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>}
      </h2>

      {/* Mientras el diagnóstico no ha llegado no se afirma nada: decir "todo
          en orden" antes de haberlo comprobado es peor que no decir nada. */}
      {salud && (mudos.length === 0
        ? <div className="empty">Ningún workflow activo se ha quedado en silencio.</div>
        : (
          <div className="lista">
            {mudos.map((w) => (
              <div key={w.id} className="fila">
                <span className="chip bad">mudo</span>
                <span className="titulo">{w.name}</span>
                <span className="mono">
                  última {haceCuanto(w.silencioMs)}
                  {w.cadenciaMs ? ` · iba cada ${haceCuanto(w.cadenciaMs).replace('hace ', '')}` : ''}
                </span>
              </div>
            ))}
          </div>
        ))}

      <h2 className="section-title">Workflows</h2>
      <div className="lista">
        {ws.map((w) => (
          <div key={w.id} className="fila">
            <span className={'chip ' + (w.active ? 'ok' : '')}>{w.active ? 'activo' : 'parado'}</span>
            <span className="titulo">{w.name}</span>
          </div>
        ))}
      </div>

      <h2 className="section-title">Últimas ejecuciones</h2>
      {ex.length === 0 ? <div className="empty">Sin ejecuciones recientes.</div> : (
        <div className="lista">
          {ex.map((e) => (
            <div key={e.id} className="fila">
              <span className={'chip ' + (e.status === 'success' ? 'ok' : e.status === 'error' ? 'bad' : '')}>
                {e.status}
              </span>
              <span className="titulo">{nombre(e.workflowId)}</span>
              <span className="mono">{e.startedAt ? new Date(e.startedAt).toLocaleString() : ''}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
