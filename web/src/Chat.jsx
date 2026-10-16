/* Chat with the orchestrator — Phase 2, with an openable history.

   Plain React + EventSource, no assistant-ui. The backend's SSE contract is
   simple (one named event per type) and a chat library would bring bundle
   weight and UI decisions that aren't needed here.

   EventSource doesn't allow headers, and doesn't need them: the __session
   cookie has Domain .your-domain.com and this is served from apm.your-domain.com,
   so it travels on its own with the stream request.

   Two things make this chat different:

   1. A reply can STOP to ask for permission and stay that way for hours.
      That's why the approval is rendered inline, at the exact point where the
      agent stopped.
   2. The conversation does NOT live in the browser. It lives in `run_event`,
      and the stream replays it in full on connect. That's why opening a chat
      from the day before yesterday is exactly the same as following the
      current one: the stream points at another run and the server tells what
      happened. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Ubicacion, { useUbicacion, textoDe } from './Ubicacion.jsx';
import { t, registrar, LOCALE } from './i18n.js';

registrar({
  'result': 'resultado', 'error': 'error', 'Needs your permission': 'Necesita tu permiso', 'Use {tool}': 'Usar {tool}',
  'Approve': 'Aprobar', 'Deny': 'Denegar', 'Recent chats': 'Chats recientes', '+ New chat': '+ Chat nuevo',
  'Loading…': 'Cargando…', 'None yet.': 'Todavía no hay ninguno.', 'Untitled': 'Sin título',
  'Could not open that conversation: {msg}': 'No pude abrir esa conversación: {msg}',
  'Connection interrupted, retrying…': 'Conexión interrumpida, reintentando…',
  "{msg}. It's the cap, not a failure.": '{msg}. Es el tope, no un fallo.',
  '{msg}. Start a new chat.': '{msg}. Empieza un chat nuevo.', 'Could not start: {msg}': 'No pude arrancar: {msg}',
  'That approval was already decided.': 'Esa aprobación ya estaba decidida.', 'searching in {place}': 'busca en {place}',
  'Ask the orchestrator for something.': 'Pídele algo al orquestador.',
  'It can read, search and run things. Anything that writes or touches the system stops to ask your permission first.': 'Puede leer, buscar y ejecutar. Todo lo que escriba o toque el sistema se para a pedirte permiso antes de hacerlo.',
  'working…': 'trabajando…', 'waiting for your decision…': 'esperando tu decisión…',
  'This conversation cannot be continued (no session was left to resume). Start a new chat.': 'Esta conversación no se puede continuar (no quedó sesión que reanudar). Empieza un chat nuevo.',
  'Continue the conversation…': 'Sigue la conversación…', 'What do you need…': 'Qué necesitas…', 'Model': 'Modelo',
  'Default (cheap)': 'Por defecto (barato)', 'Continue': 'Seguir', 'Send': 'Enviar',
  'done': 'completada', 'failed': 'con error', 'running': 'en curso', 'queued': 'en cola',
  'awaiting_approval': 'espera aprobación', 'interrupted': 'interrumpida',
});

/* The types the backend emits (api/runs.js). Listed explicitly because
   EventSource requires subscribing by name: a generic `onmessage` doesn't get
   events that have their own `event:`. */
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
      {p.ok ? t('result') : t('error')} <span className="mono">{recorta(p.content)}</span>
    </div>;
  }
  if (ev.kind === 'error') return <div className="paso malo">{p.message}</div>;
  return null;
}

/* Text of the last `assistant` before position `i`, or null if there isn't one. */
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
  /* Just the time if it's today, the date otherwise: in a list of twenty,
     "14:20" repeated twenty times tells nothing apart. */
  return mismoDia
    ? d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(LOCALE, { day: '2-digit', month: 'short' });
};

/* The approval card. Inline and not a modal on purpose: a modal covers the
   conversation exactly when you need to read it to decide. */
function Aprobacion({ pendiente, onDecidir, ocupado }) {
  return (
    <div className="aprobacion">
      <div className="cabeza">{t('Needs your permission')}</div>
      <p>{pendiente.summary || t('Use {tool}', { tool: pendiente.tool })}</p>
      <pre className="mono">{recorta(JSON.stringify(pendiente.input, null, 2), 600)}</pre>
      <div className="acciones">
        <button className="btn" disabled={ocupado} onClick={() => onDecidir(pendiente.id, 'allow')}>
          {t('Approve')}
        </button>
        <button className="btn ghost" disabled={ocupado} onClick={() => onDecidir(pendiente.id, 'deny')}>
          {t('Deny')}
        </button>
      </div>
    </div>
  );
}

/* The history. It's a list of runs, which is the same as a list of
   conversations: each one keeps its whole thread and its location. */
function Recientes({ lista, actual, onAbrir, onNuevo, abierta, setAbierta }) {
  return (
    <aside className="chats">
      <details open={abierta} onToggle={(e) => setAbierta(e.currentTarget.open)}>
        <summary>
          <span className="etiqueta">{t('Recent chats')}</span>
          <span className="mono">{lista ? lista.length : '…'}</span>
        </summary>
        <div className="chats-cuerpo">
          <button className="btn ghost nuevo" type="button" onClick={onNuevo}>{t('+ New chat')}</button>
          {lista === null && <p className="pista">{t('Loading…')}</p>}
          {lista && lista.length === 0 && <p className="pista">{t('None yet.')}</p>}
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
                <span className="titulo">{r.title || t('Untitled')}</span>
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
  /* The backend picks the default model (Haiku). This selector exists to move
     up occasionally when the work calls for it, not to choose every time: 90%
     of what gets asked here doesn't need Sonnet. */
  const [modelo, setModelo] = useState('');
  const [modelos, setModelos] = useState([]);
  /* `origen` drives the stream: which run is followed and from which event.
     They go together on purpose — kept apart, switching chats opens the new
     stream with the previous one's `desde` and half the conversation is lost. */
  const [origen, setOrigen] = useState(null);
  const [meta, setMeta] = useState(null);
  const [estado, setEstado] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [pendientes, setPendientes] = useState([]);
  const [recientes, setRecientes] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [listaAbierta, setListaAbierta] = useState(
    /* On a phone the history starts collapsed: it's a side panel on desktop,
       but at 390 px it would be a whole screen before the chat. */
    () => !window.matchMedia('(max-width: 900px)').matches);
  const fin = useRef(null);

  const { ubic, setUbic, ciudades } = useUbicacion();
  const runId = origen?.id || null;

  /* Autoscroll only when new things arrive. */
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

  /* Re-read with the dashboard's refresh button and whenever the open
     conversation changes state: a chat that just finished must stop showing
     as "working" in the list without reloading the page. */
  useEffect(() => { cargarRecientes(); }, [cargarRecientes, refresco]);

  const cargarPendientes = useCallback(async (id) => {
    try {
      const todas = await api('/api/approvals');
      setPendientes(todas.filter((a) => a.runId === id));
    } catch { /* must not break the chat */ }
  }, []);

  /* Open a conversation from the list. Its events are fetched over HTTP and
     the stream hooks in AFTER the last one: left at 0, the server would replay
     everything again and every message would show up twice. */
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
      setAviso(t('Could not open that conversation: {msg}', { msg: e.message }));
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

  /* One EventSource per run. Closed when switching runs or unmounting:
     leaving it open would keep a stream alive on the server. */
  useEffect(() => {
    if (!origen) return undefined;
    const fuente = new EventSource(`/api/runs/${origen.id}/stream?desde=${origen.desde}`);

    const onEvento = (kind) => (e) => {
      let payload = {};
      try { payload = JSON.parse(e.data); } catch { /* ping or other */ }
      if (kind === 'status') {
        setEstado(payload.status);
        /* Back to 'running' after approving, the card no longer applies. */
        if (payload.status !== 'awaiting_approval') setPendientes([]);
        if (!TRABAJANDO.includes(payload.status)) {
          /* Finished: the list and the detail are re-read so the
             keep-writing button only appears when it truly can. */
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

    /* EventSource reconnects on its own and sends Last-Event-ID; the backend
       replays from there, so a network drop neither loses nor duplicates messages. */
    fuente.onerror = () => setAviso(t('Connection interrupted, retrying…'));
    fuente.onopen = () => setAviso(null);

    return () => { quitar.forEach((f) => f()); fuente.close(); };
  }, [origen, cargarPendientes, cargarRecientes]);

  const trabajando = TRABAJANDO.includes(estado);
  /* Continue the open conversation or start another: the server decides,
     since it knows whether there's an SDK session left to resume. */
  const puedeSeguir = Boolean(runId) && meta?.continuable && !trabajando;

  async function enviar(e) {
    e.preventDefault();
    const prompt = texto.trim();
    if (!prompt || ocupado || trabajando) return;
    setOcupado(true);
    setAviso(null);
    try {
      if (puedeSeguir) {
        /* Same thread: `origen` isn't touched, the stream is already open and
           new messages come in through it. */
        await api(`/api/runs/${runId}/messages`, { method: 'POST', body: JSON.stringify({ prompt }) });
        setEstado('running');
      } else {
        const run = await api('/api/runs', {
          method: 'POST',
          body: JSON.stringify({ prompt, ...(modelo ? { model: modelo } : {}), location: ubic })
        });
        /* The message isn't drawn by hand: it's already in `run_event` and
           the stream replays it from 0. Seeding it here showed it twice. */
        setEventos([]);
        setPendientes([]);
        setMeta(null);
        setEstado(run.status);
        setOrigen({ id: run.id, desde: 0 });
      }
      setTexto('');
      cargarRecientes();
    } catch (err) {
      /* A 429 isn't a red error: it's the handbrake working. */
      setAviso(err.status === 429
        ? t("{msg}. It's the cap, not a failure.", { msg: err.message })
        : err.status === 409
        ? t('{msg}. Start a new chat.', { msg: err.message })
        : t('Could not start: {msg}', { msg: err.message }));
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
      setAviso(err.status === 409 ? t('That approval was already decided.') : err.message);
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
              <span className="chip">{t('searching in {place}', { place: textoDe(meta.ubicacion.target) })}</span>
            )}
            <span className={'chip ' + (estado === 'done' ? 'ok' : estado === 'failed' ? 'bad' : '')}>
              {t(estado)}
            </span>
          </div>
        )}

        <div className="hilo">
          {eventos.length === 0 && !runId && (
            <div className="empty">
              <strong>{t('Ask the orchestrator for something.')}</strong>
              {t('It can read, search and run things. Anything that writes or touches the system stops to ask your permission first.')}
            </div>
          )}
          {eventos.map((ev, i) => (
            /* The SDK closes each turn with a `final` whose text is the same
               as the last `assistant`: drawing both showed every reply twice.
               `final` is only drawn when it says something different. */
            ev.kind === 'final' && ultimoAsistente(eventos, i) === (ev.payload?.text ?? '')
              ? null
              : <Burbuja key={ev.key} ev={ev} />
          ))}
          {pendientes.map((p) => (
            <Aprobacion key={p.id} pendiente={p} onDecidir={decidir} ocupado={ocupado} />
          ))}
          {trabajando && estado !== 'awaiting_approval' && <div className="paso pensando">{t('working…')}</div>}
          {estado === 'awaiting_approval' && pendientes.length === 0 && (
            <div className="paso">{t('waiting for your decision…')}</div>
          )}
          {runId && !trabajando && meta && !meta.continuable && (
            <div className="paso">
              {t('This conversation cannot be continued (no session was left to resume). Start a new chat.')}
            </div>
          )}
          <div ref={fin} />
        </div>

        {aviso && <div className="aviso">{aviso}</div>}

        {/* The location sits right by the text box rather than in a hidden
            setting: it's part of the question, just like the model. */}
        {!puedeSeguir && <Ubicacion ubic={ubic} setUbic={setUbic} ciudades={ciudades} />}

        <form className="entrada" onSubmit={enviar}>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              /* Enter sends, Shift+Enter adds a new line. */
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(e); }
            }}
            placeholder={puedeSeguir ? t('Continue the conversation…') : t('What do you need…')}
            rows={2}
            disabled={ocupado || trabajando}
          />
          <div className="controles">
            {!puedeSeguir && (
              <select value={modelo} onChange={(e) => setModelo(e.target.value)} disabled={ocupado}
                aria-label={t('Model')}>
                <option value="">{t('Default (cheap)')}</option>
                {modelos.map((m) => (
                  <option key={m.model} value={m.model}>{m.model}</option>
                ))}
              </select>
            )}
            <button className="btn" type="submit" disabled={ocupado || trabajando || !texto.trim()}>
              {puedeSeguir ? t('Continue') : t('Send')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
