/* Chat con el orquestador — Fase 2, con historial abrible.

   React plano + EventSource, sin assistant-ui. El contrato SSE del backend es
   simple (un evento con nombre por tipo) y una librería de chat traería
   bundle y decisiones de UI que aquí no hacen falta.

   EventSource no permite cabeceras, y no las necesita: la cookie __session
   tiene Domain .tu-dominio.com y esto se sirve desde apm.tu-dominio.com, así
   que viaja sola en la petición del stream.

   Dos cosas hacen distinto a este chat:

   1. Una respuesta puede PARARSE a pedir permiso y quedarse así horas. Por
      eso la aprobación se pinta en línea, en el punto exacto donde el agente
      se detuvo.
   2. La conversación NO vive en el navegador. Vive en `run_event`, y el
      stream la reproduce entera al conectarse. Por eso abrir un chat de
      antesdeayer es exactamente lo mismo que seguir el de ahora: se apunta
      el stream a otra ejecución y el servidor cuenta lo que pasó. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Ubicacion, { useUbicacion, textoDe } from './Ubicacion.jsx';

/* Los tipos que emite el backend (api/runs.js). Se listan explícitamente
   porque EventSource obliga a suscribirse por nombre: un `onmessage` genérico
   no recibe eventos con `event:` propio. */
const TIPOS = ['user', 'assistant', 'tool_use', 'tool_result', 'approval_requested',
  'approval_decided', 'system', 'final', 'error', 'status'];

const TRABAJANDO = ['running', 'queued', 'awaiting_approval'];

function Burbuja({ ev }) {
  const p = ev.payload || {};
  if (ev.kind === 'user') return <div className="msg yo"><p>{p.text}</p></div>;
  if (ev.kind === 'assistant' || ev.kind === 'final') {
    return <div className="msg agente"><p>{p.text}</p></div>;
  }
  if (ev.kind === 'tool_use') {
    return <div className="paso"><b>{p.name}</b> <span className="mono">{resumeInput(p.input)}</span></div>;
  }
  if (ev.kind === 'tool_result') {
    return <div className={'paso ' + (p.ok ? '' : 'malo')}>
      {p.ok ? 'resultado' : 'error'} <span className="mono">{recorta(p.content)}</span>
    </div>;
  }
  if (ev.kind === 'error') return <div className="paso malo">{p.message}</div>;
  return null;
}

/* Texto del último `assistant` antes de la posición `i`, o null si no hay. */
const ultimoAsistente = (evs, i) => {
  for (let j = i - 1; j >= 0; j--) {
    if (evs[j].kind === 'assistant') return evs[j].payload?.text ?? '';
    if (evs[j].kind === 'user' || evs[j].kind === 'final') return null;
  }
  return null;
};

const recorta = (v, n = 240) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
};
const resumeInput = (i) => recorta(i && (i.command || i.file_path || i.pattern || i.query) || i, 120);

const cuando = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  /* La hora sola si es de hoy, el día si no: en una lista de veinte, "14:20"
     repetido veinte veces no distingue nada. */
  return mismoDia
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: '2-digit', month: 'short' });
};

/* La tarjeta de aprobación. Va en línea y no en un modal a propósito: el
   modal tapa la conversación justo cuando hace falta leerla para decidir. */
function Aprobacion({ pendiente, onDecidir, ocupado }) {
  return (
    <div className="aprobacion">
      <div className="cabeza">Necesita tu permiso</div>
      <p>{pendiente.summary || `Usar ${pendiente.tool}`}</p>
      <pre className="mono">{recorta(JSON.stringify(pendiente.input, null, 2), 600)}</pre>
      <div className="acciones">
        <button className="btn" disabled={ocupado} onClick={() => onDecidir(pendiente.id, 'allow')}>
          Aprobar
        </button>
        <button className="btn ghost" disabled={ocupado} onClick={() => onDecidir(pendiente.id, 'deny')}>
          Denegar
        </button>
      </div>
    </div>
  );
}

/* El historial. Es una lista de ejecuciones, que es lo mismo que una lista de
   conversaciones: cada una guarda su hilo entero y su ubicación. */
function Recientes({ lista, actual, onAbrir, onNuevo, abierta, setAbierta }) {
  return (
    <aside className="chats">
      <details open={abierta} onToggle={(e) => setAbierta(e.currentTarget.open)}>
        <summary>
          <span className="etiqueta">Chats recientes</span>
          <span className="mono">{lista ? lista.length : '…'}</span>
        </summary>
        <div className="chats-cuerpo">
          <button className="btn ghost nuevo" type="button" onClick={onNuevo}>+ Chat nuevo</button>
          {lista === null && <p className="pista">Cargando…</p>}
          {lista && lista.length === 0 && <p className="pista">Todavía no hay ninguno.</p>}
          {(lista || []).map((r) => (
            <button
              key={r.id}
              type="button"
              className={'chat-item' + (r.id === actual ? ' activo' : '')}
              onClick={() => onAbrir(r.id)}
              aria-current={r.id === actual ? 'true' : undefined}
            >
              <span className="linea1">
                <span className={'punto ' + (TRABAJANDO.includes(r.status) ? 'vivo'
                  : r.status === 'failed' ? 'malo' : '')} />
                <span className="titulo">{r.title || 'Sin título'}</span>
              </span>
              <span className="linea2 mono">
                {cuando(r.createdAt)} · ${r.costUsd.toFixed(3)}
                {r.buscaEn ? ` · ${r.buscaEn}` : ''}
              </span>
            </button>
          ))}
        </div>
      </details>
    </aside>
  );
}

export default function Chat({ refresco = 0 }) {
  const [texto, setTexto] = useState('');
  /* El modelo por defecto lo decide el backend (Haiku). Este selector existe
     para subir puntualmente cuando el trabajo lo pida, no para elegir cada
     vez: el 90% de lo que se pide aquí no necesita Sonnet. */
  const [modelo, setModelo] = useState('');
  const [modelos, setModelos] = useState([]);
  /* `origen` es lo que manda sobre el stream: qué ejecución se sigue y desde
     qué evento. Van juntos a propósito — separados, cambiar de chat abre el
     stream nuevo con el `desde` del anterior y se pierde media conversación. */
  const [origen, setOrigen] = useState(null);
  const [meta, setMeta] = useState(null);
  const [estado, setEstado] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [pendientes, setPendientes] = useState([]);
  const [recientes, setRecientes] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [listaAbierta, setListaAbierta] = useState(
    /* En el móvil el historial arranca plegado: es un panel lateral en el
       escritorio, pero en 390 px sería una pantalla entera antes del chat. */
    () => !window.matchMedia('(max-width: 900px)').matches);
  const fin = useRef(null);

  const { ubic, setUbic, ciudades } = useUbicacion();
  const runId = origen?.id || null;

  /* Autoscroll solo cuando llegan cosas nuevas. */
  useEffect(() => { fin.current?.scrollIntoView({ behavior: 'smooth' }); }, [eventos, pendientes]);

  useEffect(() => {
    let vivo = true;
    api('/api/models').then((m) => vivo && setModelos(m)).catch(() => {});
    return () => { vivo = false; };
  }, []);

  const cargarRecientes = useCallback(async () => {
    try {
      const d = await api('/api/runs?limit=25');
      setRecientes(d.runs);
    } catch { setRecientes([]); }
  }, []);

  /* Se relee con el botón de actualizar del panel y al cambiar de estado la
     conversación abierta: un chat que acaba de terminar tiene que dejar de
     verse "trabajando" en la lista sin recargar la página. */
  useEffect(() => { cargarRecientes(); }, [cargarRecientes, refresco]);

  const cargarPendientes = useCallback(async (id) => {
    try {
      const todas = await api('/api/approvals');
      setPendientes(todas.filter((a) => a.runId === id));
    } catch { /* que no rompa el chat */ }
  }, []);

  /* Abrir una conversación de la lista. Se piden sus eventos por HTTP y el
     stream se engancha DESPUÉS del último: si se dejara en 0, el servidor
     reproduciría todo otra vez y saldría cada mensaje por duplicado. */
  const abrir = useCallback(async (id) => {
    if (id === runId) return;
    setOcupado(true);
    setAviso(null);
    try {
      const d = await api(`/api/runs/${id}`);
      setEventos(d.events.map((e) => ({ kind: e.kind, payload: e.payload, key: `s${e.seq}` })));
      setPendientes(d.approvals.filter((a) => !a.decision));
      setEstado(d.status);
      setMeta(d);
      const ultimo = d.events.length ? d.events[d.events.length - 1].seq : 0;
      setOrigen({ id, desde: ultimo });
    } catch (e) {
      setAviso(`No pude abrir esa conversación: ${e.message}`);
    } finally {
      setOcupado(false);
    }
  }, [runId]);

  function nuevo() {
    setOrigen(null);
    setMeta(null);
    setEventos([]);
    setPendientes([]);
    setEstado(null);
    setAviso(null);
  }

  /* Un EventSource por ejecución. Se cierra al cambiar de ejecución o al
     desmontar: dejarlo abierto mantendría vivo un stream en el servidor. */
  useEffect(() => {
    if (!origen) return undefined;
    const fuente = new EventSource(`/api/runs/${origen.id}/stream?desde=${origen.desde}`);

    const onEvento = (kind) => (e) => {
      let payload = {};
      try { payload = JSON.parse(e.data); } catch { /* ping u otro */ }
      if (kind === 'status') {
        setEstado(payload.status);
        /* Al volver a 'running' tras aprobar, la tarjeta ya no aplica. */
        if (payload.status !== 'awaiting_approval') setPendientes([]);
        if (!TRABAJANDO.includes(payload.status)) {
          /* Terminó: la lista y la ficha se releen para que el botón de
             seguir escribiendo aparezca solo cuando de verdad se puede. */
          cargarRecientes();
          api(`/api/runs/${origen.id}`).then(setMeta).catch(() => {});
        }
        return;
      }
      if (kind === 'approval_requested') { cargarPendientes(origen.id); return; }
      if (kind === 'approval_decided') { setPendientes([]); return; }
      if (kind === 'system') return;
      setEventos((prev) => [...prev, { kind, payload, key: `${kind}-${e.lastEventId || prev.length}` }]);
    };

    const quitar = TIPOS.map((k) => {
      const h = onEvento(k);
      fuente.addEventListener(k, h);
      return () => fuente.removeEventListener(k, h);
    });

    /* EventSource reconecta solo y manda Last-Event-ID; el backend reproduce
       desde ahí, así que un corte de red no pierde ni duplica mensajes. */
    fuente.onerror = () => setAviso('Conexión interrumpida, reintentando…');
    fuente.onopen = () => setAviso(null);

    return () => { quitar.forEach((f) => f()); fuente.close(); };
  }, [origen, cargarPendientes, cargarRecientes]);

  const trabajando = TRABAJANDO.includes(estado);
  /* Continuar una conversación abierta o empezar otra: lo decide el servidor,
     que es quien sabe si queda sesión del SDK que reanudar. */
  const puedeSeguir = Boolean(runId) && meta?.continuable && !trabajando;

  async function enviar(e) {
    e.preventDefault();
    const prompt = texto.trim();
    if (!prompt || ocupado || trabajando) return;
    setOcupado(true);
    setAviso(null);
    try {
      if (puedeSeguir) {
        /* Mismo hilo: no se toca `origen`, el stream ya está abierto y los
           mensajes nuevos entran por él. */
        await api(`/api/runs/${runId}/messages`, { method: 'POST', body: JSON.stringify({ prompt }) });
        setEstado('running');
      } else {
        const run = await api('/api/runs', {
          method: 'POST',
          body: JSON.stringify({ prompt, ...(modelo ? { model: modelo } : {}), location: ubic })
        });
        /* No se pinta el mensaje a mano: ya está en `run_event` y el stream
           lo reproduce desde 0. Sembrarlo aquí lo enseñaba dos veces. */
        setEventos([]);
        setPendientes([]);
        setMeta(null);
        setEstado(run.status);
        setOrigen({ id: run.id, desde: 0 });
      }
      setTexto('');
      cargarRecientes();
    } catch (err) {
      /* El 429 no es un error rojo: es el freno de mano funcionando. */
      setAviso(err.status === 429
        ? `${err.message}. Es el tope, no un fallo.`
        : err.status === 409
        ? `${err.message}. Empieza un chat nuevo.`
        : `No pude arrancar: ${err.message}`);
    } finally {
      setOcupado(false);
    }
  }

  async function decidir(id, decision) {
    setOcupado(true);
    try {
      await api(`/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision }) });
      setPendientes((p) => p.filter((a) => a.id !== id));
    } catch (err) {
      setAviso(err.status === 409 ? 'Esa aprobación ya estaba decidida.' : err.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="chat-layout">
      <Recientes
        lista={recientes}
        actual={runId}
        onAbrir={abrir}
        onNuevo={nuevo}
        abierta={listaAbierta}
        setAbierta={setListaAbierta}
      />

      <div className="chat">
        {meta && (
          <div className="chat-cabeza">
            <span className="titulo">{meta.title}</span>
            {meta.ubicacion && textoDe(meta.ubicacion.target) && (
              <span className="chip">busca en {textoDe(meta.ubicacion.target)}</span>
            )}
            <span className={'chip ' + (estado === 'done' ? 'ok' : estado === 'failed' ? 'bad' : '')}>
              {estado}
            </span>
          </div>
        )}

        <div className="hilo">
          {eventos.length === 0 && !runId && (
            <div className="empty">
              <strong>Pídele algo al orquestador.</strong>
              Puede leer, buscar y ejecutar. Todo lo que escriba o toque el sistema
              se para a pedirte permiso antes de hacerlo.
            </div>
          )}
          {eventos.map((ev, i) => (
            /* El SDK cierra cada turno con un `final` cuyo texto es el mismo
               que el último `assistant`: pintar los dos enseñaba cada
               respuesta por duplicado. Se pinta `final` solo si dice algo
               distinto. */
            ev.kind === 'final' && ultimoAsistente(eventos, i) === (ev.payload?.text ?? '')
              ? null
              : <Burbuja key={ev.key} ev={ev} />
          ))}
          {pendientes.map((p) => (
            <Aprobacion key={p.id} pendiente={p} onDecidir={decidir} ocupado={ocupado} />
          ))}
          {trabajando && estado !== 'awaiting_approval' && <div className="paso pensando">trabajando…</div>}
          {estado === 'awaiting_approval' && pendientes.length === 0 && (
            <div className="paso">esperando tu decisión…</div>
          )}
          {runId && !trabajando && meta && !meta.continuable && (
            <div className="paso">
              Esta conversación no se puede continuar (no quedó sesión que reanudar).
              Empieza un chat nuevo.
            </div>
          )}
          <div ref={fin} />
        </div>

        {aviso && <div className="aviso">{aviso}</div>}

        {/* La ubicación va pegada a la caja de escribir y no en un ajuste
            escondido: es parte de la pregunta, igual que el modelo. */}
        {!puedeSeguir && <Ubicacion ubic={ubic} setUbic={setUbic} ciudades={ciudades} />}

        <form className="entrada" onSubmit={enviar}>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              /* Enter envía, Shift+Enter salta de línea. */
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(e); }
            }}
            placeholder={puedeSeguir ? 'Sigue la conversación…' : 'Qué necesitas…'}
            rows={2}
            disabled={ocupado || trabajando}
          />
          <div className="controles">
            {!puedeSeguir && (
              <select value={modelo} onChange={(e) => setModelo(e.target.value)} disabled={ocupado}
                aria-label="Modelo">
                <option value="">Por defecto (barato)</option>
                {modelos.map((m) => (
                  <option key={m.model} value={m.model}>{m.model}</option>
                ))}
              </select>
            )}
            <button className="btn" type="submit" disabled={ocupado || trabajando || !texto.trim()}>
              {puedeSeguir ? 'Seguir' : 'Enviar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
