/* Aprobaciones pendientes de TODAS las ejecuciones — Fase 2.

   El chat enseña la aprobación de la conversación que estás mirando. Esta
   pantalla existe para el otro caso, que es el normal: lanzaste algo hace
   horas, cerraste el navegador, y el agente lleva desde entonces esperando.
   Es la pantalla que se abre desde el móvil.

   Se relee sola cada 15 s. No usa SSE a propósito: aquí no hay una ejecución
   concreta a la que engancharse, y un intervalo corto sobre una consulta con
   índice parcial es más barato que mantener un stream por pestaña. */

import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

const recorta = (v, n = 400) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? '', null, 2);
  return s.length > n ? s.slice(0, n) + '…' : s;
};

export default function Approvals({ refresco = 0 }) {
  const [lista, setLista] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(null);

  const cargar = useCallback(async () => {
    try {
      setLista(await api('/api/approvals'));
    } catch (e) {
      setAviso(`No pude leer las aprobaciones: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 15_000);
    return () => clearInterval(t);
  }, [cargar, refresco]);

  async function decidir(id, decision) {
    setOcupado(id);
    setAviso(null);
    try {
      await api(`/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision }) });
      setLista((l) => l.filter((a) => a.id !== id));
    } catch (e) {
      /* 409 = ya decidida. Pasa al pulsar dos veces desde el móvil, y no es
         un error que merezca alarma: se refresca y ya. */
      setAviso(e.status === 409 ? 'Esa ya estaba decidida.' : e.message);
      cargar();
    } finally {
      setOcupado(null);
    }
  }

  if (lista === null) return <div className="empty">Cargando…</div>;

  if (lista.length === 0) {
    return (
      <div className="empty">
        <strong>Nada esperando permiso.</strong>
        Cuando un agente quiera escribir, ejecutar o mandar algo, aparecerá aquí
        y se quedará esperando — aunque pasen horas o se reinicie el servidor.
      </div>
    );
  }

  return (
    <>
      {aviso && <div className="aviso">{aviso}</div>}
      <h2 className="section-title">{lista.length} esperando tu permiso</h2>
      {lista.map((a) => (
        <div key={a.id} className="aprobacion">
          <div className="cabeza">
            {a.tool} · <span className="mono">{a.runTitle || a.runId}</span>
          </div>
          <p>{a.summary || `Usar ${a.tool}`}</p>
          <pre className="mono">{recorta(a.input)}</pre>
          <div className="acciones">
            <button className="btn" disabled={ocupado === a.id}
              onClick={() => decidir(a.id, 'allow')}>Aprobar</button>
            <button className="btn ghost" disabled={ocupado === a.id}
              onClick={() => decidir(a.id, 'deny')}>Denegar</button>
          </div>
        </div>
      ))}
    </>
  );
}
