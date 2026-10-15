/* Áreas y proyectos — Fase 5.

   Comprueba desde FUERA que las URLs públicas responden. El vigilante del
   host mira contenedores por dentro; esto mira lo que ve un usuario. Un
   contenedor sano detrás de un proxy roto sigue siendo un sitio caído, y esa
   diferencia es justo la que se paga cara. */

import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

export default function Areas({ refresco = 0 }) {
  const [lista, setLista] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(async () => {
    try { setLista(await api('/api/projects')); }
    catch (e) { setAviso(e.message); }
  }, []);

  /* Se recarga con el botón de actualizar del panel. Ojo: esto relee lo que
     el vigilante ya sondeó (cada 10 min); para forzar un sondeo nuevo está
     "Comprobar ahora". */
  useEffect(() => { cargar(); }, [cargar, refresco]);

  async function comprobarAhora() {
    setOcupado(true); setAviso(null);
    try { await api('/api/projects/check', { method: 'POST' }); await cargar(); }
    catch (e) { setAviso(e.message); }
    finally { setOcupado(false); }
  }

  if (lista === null) return <div className="empty">Cargando…</div>;

  const areas = [...new Set(lista.map((p) => p.area))];

  return (
    <>
      {aviso && <div className="aviso">{aviso}</div>}
      <div className="controles" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={comprobarAhora} disabled={ocupado}>
          {ocupado ? 'Comprobando…' : 'Comprobar ahora'}
        </button>
      </div>

      {areas.map((a) => (
        <div key={a}>
          <h2 className="section-title">{a}</h2>
          <div className="lista">
            {lista.filter((p) => p.area === a).map((p) => (
              <div key={p.id} className="fila">
                <span className={'chip ' + (!p.ultimo ? '' : p.ultimo.ok ? 'ok' : 'bad')}>
                  {!p.ultimo ? 'sin datos' : p.ultimo.ok ? 'arriba' : 'caído'}
                </span>
                <span className="titulo">{p.name}</span>
                <span className="mono">
                  {p.ultimo
                    /* El motivo del fallo importa más que el código: "sin
                       respuesta en 8s" y "500" se arreglan de forma distinta. */
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
