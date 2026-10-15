/* Prospección por llamadas (Fase 3). Spec: .planning/specs/apm-prospeccion-llamadas.md

   Pensado para el pulgar: el dueño llama desde SU teléfono (enlace tel:) y aquí
   solo marca qué pasó con botones grandes, escribe una nota y decide si volver
   a llamar. Nada de marcador automático ni voz de IA (TCPA).

   Cinco vistas: Llamar · Lista · Importar · Guiones · Scoreboard. */

import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Ubicacion, { useUbicacion } from './Ubicacion.jsx';
import { enlaceDemo, esSalud, textoDemo } from './demo-texto.js';

const VISTAS = [
  { id: 'llamar', label: 'Llamar' },
  { id: 'lista', label: 'Lista' },
  { id: 'importar', label: 'Importar' },
  { id: 'guiones', label: 'Guiones' },
  { id: 'score', label: 'Scoreboard' }
];

/* Cada botón con su "volver a llamar" sugerido. Los de supresión no se pueden
   programar: la API lo fuerza igualmente, aquí solo se deja claro. */
const RESULTADOS = [
  { id: 'no_contesto', label: 'No contestó', sugerido: 1 },
  { id: 'buzon', label: 'Buzón de voz', sugerido: 3 },
  { id: 'no_interesa', label: 'No le interesa', sugerido: null },
  { id: 'interesado', label: 'Interesado', sugerido: 1, tono: 'ok' },
  { id: 'llamar_luego', label: 'Llamar luego', sugerido: 1 },
  { id: 'demo', label: 'Demo agendada', sugerido: 1, tono: 'ok' },
  { id: 'no_llamar', label: 'No llamar más', bloquea: true, tono: 'bad' },
  { id: 'numero_malo', label: 'Número malo', bloquea: true, tono: 'bad' }
];
const ETIQUETA = Object.fromEntries(RESULTADOS.map((r) => [r.id, r.label]));
const ATAJOS = [{ dias: 1, label: 'Mañana' }, { dias: 3, label: '3 días' }, { dias: 7, label: '1 semana' }];

const CATEGORIA_A_NICHO = (c) => c.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const nichoBonito = (n) => n.replace(/_/g, ' ');
/* Segunda barrera (la API ya filtra): nunca un href que no sea http(s). */
const webSegura = (u) => (/^https?:\/\//i.test(String(u || '')) ? u : null);

/* A las 10:00 del día que toque: hora razonable para un contratista. */
function enDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  d.setHours(10, 0, 0, 0);
  return d;
}
const paraInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const fechaCorta = (s) => (s ? new Date(s).toLocaleString('es-US', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

function useNichos(refresco) {
  const [nichos, setNichos] = useState([]);
  useEffect(() => {
    api('/api/leads/niches').then((d) => setNichos(d.niches)).catch(() => {});
  }, [refresco]);
  return nichos;
}

function SelectorNicho({ nichos, valor, onChange }) {
  if (!nichos.length) return null;
  return (
    <select className="pl-select" value={valor} onChange={(e) => onChange(e.target.value)} aria-label="Nicho">
      {nichos.map((n) => <option key={n.niche} value={n.niche}>{nichoBonito(n.niche)} ({n.total})</option>)}
    </select>
  );
}

// ── Mandar la demo ─────────────────────────────────────────────
/* Solo si te dice que sí (TCPA): copia el texto con la demo de ESE negocio
   para pegarlo en tus mensajes. Desde aquí no sale nada solo. */
function MandarDemo({ lead }) {
  const [copiado, setCopiado] = useState(null);   // 'en' | 'es' | null
  const [aMano, setAMano] = useState(null);       // el texto, si el portapapeles no deja

  async function copiar(idioma) {
    const texto = textoDemo(lead, idioma);
    setAMano(null);
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(idioma);
      setTimeout(() => setCopiado((c) => (c === idioma ? null : c)), 2000);
    } catch {
      setAMano(texto);
    }
  }

  if (esSalud(lead.niche)) {
    return <div className="aviso">Clínica: por HIPAA no se ofrece piloto ni demo. Si llamas, que sea para cerrar bien: la versión para clínicas aún no existe.</div>;
  }
  return (
    <div className="pl-demo">
      <div className="pista">¿Te dijo que sí? Copia el texto con la demo de este negocio y mándalo desde tus mensajes.</div>
      <div className="pl-volver">
        <button type="button" className="pl-atajo" onClick={() => copiar('en')}>{copiado === 'en' ? 'Copiado ✓' : 'Texto en inglés'}</button>
        <button type="button" className="pl-atajo" onClick={() => copiar('es')}>{copiado === 'es' ? 'Copiado ✓' : 'Texto en español'}</button>
        <a className="pl-atajo pl-enlace" href={enlaceDemo(lead)} target="_blank" rel="noopener noreferrer">Ver su demo</a>
      </div>
      {aMano && (
        <textarea className="pl-notas" readOnly rows={4} value={aMano} autoFocus
          onFocus={(e) => e.target.select()} aria-label="Texto para copiar" />
      )}
    </div>
  );
}

// ── Llamar ─────────────────────────────────────────────────────
function Llamar({ nichos, nicho, setNicho }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [notas, setNotas] = useState('');
  const [volver, setVolver] = useState(null);   // Date | null
  const [guardando, setGuardando] = useState(false);
  const [hechas, setHechas] = useState(0);

  const cargar = useCallback(async () => {
    if (!nicho) return;
    setError(null);
    try {
      setDatos(await api(`/api/leads/next?niche=${encodeURIComponent(nicho)}`));
      setResultado(null); setNotas(''); setVolver(null);
    } catch (e) { setError(e.message); }
  }, [nicho]);

  useEffect(() => { cargar(); }, [cargar]);

  function elegir(r) {
    setResultado(r.id);
    setVolver(r.bloquea || r.sugerido == null ? null : enDias(r.sugerido));
  }

  async function guardar() {
    if (!resultado || !datos?.lead) return;
    setGuardando(true); setError(null);
    try {
      await api(`/api/leads/${datos.lead.id}/calls`, {
        method: 'POST',
        body: JSON.stringify({ outcome: resultado, notes: notas, callAgain: Boolean(volver), nextCallAt: volver ? volver.toISOString() : null })
      });
      setHechas((n) => n + 1);
      await cargar();
    } catch (e) { setError(e.message); } finally { setGuardando(false); }
  }

  if (!nichos.length) {
    return <div className="empty"><strong>Todavía no hay leads.</strong> Ve a <b>Importar</b> y trae contratistas del Bronx desde NYC Open Data.</div>;
  }
  const r = RESULTADOS.find((x) => x.id === resultado);
  const lead = datos?.lead;

  return (
    <>
      <div className="pl-barra">
        <SelectorNicho nichos={nichos} valor={nicho} onChange={setNicho} />
        {datos?.queue && <span className="chip">{datos.queue.due} pendientes · {datos.queue.new} nuevos</span>}
        {hechas > 0 && <span className="chip ok">{hechas} hoy en esta sesión</span>}
      </div>
      {error && <div className="aviso">{error}</div>}

      {!lead && datos && (
        <div className="empty">
          {datos.reason === 'outside_hours'
            ? <><strong>Fuera de horario.</strong> Solo se llama de 8:00 a 21:00 hora del negocio (TCPA). Se abre {fechaCorta(datos.opensAt)}.</>
            : <><strong>No queda nadie a quien llamar ahora en este nicho.</strong> Importa más o espera a los "volver a llamar" programados ({datos.queue?.scheduled || 0}).</>}
        </div>
      )}

      {lead && (
        <div className="card pl-tarjeta">
          <div className="pl-negocio">{lead.businessName}</div>
          <div className="sub">{[lead.boroughCity, lead.zip].filter(Boolean).join(' · ')}{webSegura(lead.website) && <> · <a href={webSegura(lead.website)} target="_blank" rel="noopener noreferrer">web</a></>}</div>
          <a className="pl-telefono" href={`tel:${lead.phone}`}>{lead.phoneDisplay}</a>
          <div className="pista">Toca el número para llamar desde tu móvil. En el ordenador, márcalo a mano.</div>

          <MandarDemo key={lead.id} lead={lead} />

          {lead.history?.length > 0 && (
            <div className="pl-historial">
              {lead.history.map((h) => (
                <div key={h.id} className="pl-hist">
                  <b>{ETIQUETA[h.outcome] || h.outcome}</b> · {fechaCorta(h.createdAt)}{h.notes && <div>{h.notes}</div>}
                </div>
              ))}
            </div>
          )}

          {datos.script && (
            <details className="pl-guion">
              <summary>Guion: {datos.script.title}</summary>
              <div className="pl-guion-texto">{datos.script.body}</div>
            </details>
          )}

          <div className="pl-resultados" role="group" aria-label="Resultado de la llamada">
            {RESULTADOS.map((x) => (
              <button key={x.id} type="button" className={`pl-res ${x.tono || ''}`} aria-pressed={resultado === x.id} onClick={() => elegir(x)}>
                {x.label}
              </button>
            ))}
          </div>

          <textarea className="pl-notas" rows={3} maxLength={5000} placeholder="Notas: con quién hablaste, qué dijo, cuándo le viene bien…"
            value={notas} onChange={(e) => setNotas(e.target.value)} />

          <div className="pl-volver">
            <span>¿Volver a llamar?</span>
            {r?.bloquea
              ? <span className="chip bad">No — se añade a la lista de no llamar</span>
              : (
                <>
                  {ATAJOS.map((a) => (
                    <button key={a.dias} type="button" className="pl-atajo" aria-pressed={volver && Math.round((volver - enDias(0)) / 86400000) === a.dias}
                      onClick={() => setVolver(enDias(a.dias))}>{a.label}</button>
                  ))}
                  <input type="datetime-local" className="pl-fecha" aria-label="Elegir fecha"
                    value={volver ? paraInput(volver) : ''} onChange={(e) => setVolver(e.target.value ? new Date(e.target.value) : null)} />
                  <button type="button" className="pl-atajo" aria-pressed={!volver} onClick={() => setVolver(null)}>No</button>
                </>
              )}
          </div>

          <button type="button" className="btn pl-guardar" disabled={!resultado || guardando} onClick={guardar}>
            {guardando ? 'Guardando…' : 'Guardar y siguiente'}
          </button>
        </div>
      )}
    </>
  );
}

// ── Lista ──────────────────────────────────────────────────────
function Lista({ nichos }) {
  const [filtros, setFiltros] = useState({ niche: '', status: '', q: '' });
  const [datos, setDatos] = useState(null);
  const [ficha, setFicha] = useState(null);
  const qs = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();

  useEffect(() => {
    const t = setTimeout(() => api(`/api/leads?${qs}`).then(setDatos).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [qs]);

  const cambiar = (k) => (e) => setFiltros((f) => ({ ...f, [k]: e.target.value }));
  return (
    <>
      <div className="pl-barra">
        <select className="pl-select" value={filtros.niche} onChange={cambiar('niche')} aria-label="Nicho">
          <option value="">Todos los nichos</option>
          {nichos.map((n) => <option key={n.niche} value={n.niche}>{nichoBonito(n.niche)}</option>)}
        </select>
        <select className="pl-select" value={filtros.status} onChange={cambiar('status')} aria-label="Estado">
          <option value="">Todos los estados</option>
          {['nuevo', 'llamado', 'interesado', 'demo', 'cliente', 'descartado'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input className="pl-select" placeholder="Buscar nombre o teléfono" value={filtros.q} onChange={cambiar('q')} />
        <a className="btn" href={`/api/leads?${qs}${qs ? '&' : ''}format=csv`}>CSV</a>
      </div>
      <div className="sub" style={{ margin: '6px 0' }}>{datos ? `${datos.total} leads` : 'Cargando…'}</div>
      <div className="pl-lista">
        {datos?.leads.map((l) => (
          <button key={l.id} type="button" className="card pl-fila" onClick={() => api(`/api/leads/${l.id}`).then(setFicha)}>
            <b>{l.businessName}</b>
            <span>{l.phoneDisplay} · {l.boroughCity || '—'} · {l.status}{l.nextCallAt ? ` · volver ${fechaCorta(l.nextCallAt)}` : ''}{l.internalOnly ? ' · interno' : ''}</span>
          </button>
        ))}
      </div>
      {ficha && (
        <div className="card pl-tarjeta" style={{ marginTop: 12 }}>
          <div className="pl-negocio">{ficha.businessName}</div>
          <a className="pl-telefono" href={`tel:${ficha.phone}`}>{ficha.phoneDisplay}</a>
          <div className="sub">Fuentes: {ficha.sources.join(', ')}</div>
          <div className="pl-historial">
            {ficha.history.length === 0 && <div className="sub">Sin llamadas todavía.</div>}
            {ficha.history.map((h) => (
              <div key={h.id} className="pl-hist"><b>{ETIQUETA[h.outcome]}</b> · {fechaCorta(h.createdAt)}{h.notes && <div>{h.notes}</div>}</div>
            ))}
          </div>
          <button type="button" className="btn" onClick={() => setFicha(null)}>Cerrar</button>
        </div>
      )}
    </>
  );
}

// ── Importar ───────────────────────────────────────────────────
function Importar({ nichos, alTerminar }) {
  const [meta, setMeta] = useState(null);
  const [fuente, setFuente] = useState('nyc_open_data');
  const [nyc, setNyc] = useState({ category: 'Home Improvement Contractor', borough: 'Bronx', zip: '' });
  const [gm, setGm] = useState({ query: '', location: 'Bronx, NY', niche: '' });
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const { ubic, setUbic, ciudades } = useUbicacion();

  const recargar = useCallback(() => api('/api/leads/runs').then(setMeta).catch(() => {}), []);
  useEffect(() => { recargar(); }, [recargar]);

  // Sondeo del run hasta que termine.
  useEffect(() => {
    if (!run || run.status !== 'running') return undefined;
    const t = setInterval(async () => {
      try {
        const r = await api(`/api/leads/import/${run.id}`);
        setRun(r);
        if (r.status !== 'running') { recargar(); alTerminar(); }
      } catch { /* siguiente vuelta */ }
    }, 3000);
    return () => clearInterval(t);
  }, [run, recargar, alTerminar]);

  async function lanzar() {
    setError(null);
    const body = fuente === 'nyc_open_data'
      ? { source: fuente, niche: CATEGORIA_A_NICHO(nyc.category), params: { category: nyc.category, borough: nyc.borough || undefined, zip: nyc.zip || undefined } }
      : { source: fuente, niche: gm.niche || CATEGORIA_A_NICHO(gm.query), params: { query: gm.query, location: gm.location } };
    try {
      const r = await api('/api/leads/import', { method: 'POST', body: JSON.stringify(body) });
      setRun({ id: r.runId, status: 'running', source: fuente });
    } catch (e) { setError(e.message); }
  }

  const gmHoy = meta?.gmapsToday ?? 0;
  return (
    <>
      <div className="card">
        <h3>Traer leads</h3>
        <div className="pl-barra">
          <select className="pl-select" value={fuente} onChange={(e) => setFuente(e.target.value)} aria-label="Fuente">
            <option value="nyc_open_data">NYC Open Data (gratis, legal)</option>
            <option value="google_maps">Google Maps (scraper interno, {gmHoy}/3 hoy)</option>
          </select>
        </div>
        {fuente === 'nyc_open_data' ? (
          <div className="pl-barra">
            <select className="pl-select" value={nyc.category} onChange={(e) => setNyc({ ...nyc, category: e.target.value })} aria-label="Categoría">
              {(meta?.categories || [nyc.category]).map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className="pl-select" value={nyc.borough} onChange={(e) => setNyc({ ...nyc, borough: e.target.value })} aria-label="Barrio">
              <option value="">Toda NYC</option>
              {(meta?.boroughs || []).map((b) => <option key={b}>{b}</option>)}
            </select>
            <input className="pl-select" inputMode="numeric" maxLength={5} placeholder="ZIP (opcional)" value={nyc.zip} onChange={(e) => setNyc({ ...nyc, zip: e.target.value })} />
          </div>
        ) : (
          <>
            <div className="pl-barra">
              <input className="pl-select" placeholder="Qué buscar (ej. plumbers)" maxLength={60} value={gm.query} onChange={(e) => setGm({ ...gm, query: e.target.value })} />
              <input className="pl-select" placeholder="Dónde (ej. Bronx, NY)" maxLength={60} value={gm.location} onChange={(e) => setGm({ ...gm, location: e.target.value })} />
              <input className="pl-select" placeholder="Nicho (ej. plumbers)" list="pl-nichos" value={gm.niche} onChange={(e) => setGm({ ...gm, niche: CATEGORIA_A_NICHO(e.target.value) })} />
              <datalist id="pl-nichos">{nichos.map((n) => <option key={n.niche} value={n.niche} />)}</datalist>
            </div>
            <div className="pista">Búsqueda suave: 1 a la vez, máx. 100 resultados, 3 al día. Tarda unos minutos. Estos leads quedan marcados como internos.</div>
          </>
        )}
        <button type="button" className="btn" disabled={run?.status === 'running' || (fuente === 'google_maps' && (gmHoy >= 3 || gm.query.trim().length < 2))} onClick={lanzar}>
          {run?.status === 'running' ? 'Importando…' : 'Importar'}
        </button>
        {error && <div className="aviso">{error}</div>}
        {run && run.status !== 'running' && (
          <div className={`aviso ${run.status === 'done' ? 'ok' : ''}`}>
            {run.status === 'done'
              ? `Listo: ${run.found} encontrados · ${run.inserted} nuevos · ${run.merged} ya estaban · ${run.suppressed} en "no llamar" · ${run.invalid} sin teléfono válido.`
              : `Falló: ${run.error}`}
          </div>
        )}
      </div>

      {meta?.runs?.length > 0 && (
        <>
          <h2 className="section-title">Últimas importaciones</h2>
          {meta.runs.map((r) => (
            <div key={r.id} className="sub pl-hist">
              {fechaCorta(r.startedAt)} · {r.source} · {nichoBonito(r.niche)} · <b>{r.status}</b>
              {r.status === 'done' && ` · ${r.inserted} nuevos / ${r.found}`}{r.error && ` · ${r.error}`}
            </div>
          ))}
        </>
      )}

      <h2 className="section-title">Zona del chat</h2>
      <Ubicacion ubic={ubic} setUbic={setUbic} ciudades={ciudades} compacto />
    </>
  );
}

// ── Guiones ────────────────────────────────────────────────────
function Guiones() {
  const [guiones, setGuiones] = useState([]);
  const [sel, setSel] = useState(null);
  const [estado, setEstado] = useState(null);

  useEffect(() => {
    api('/api/scripts').then((d) => { setGuiones(d.scripts); setSel(d.scripts[0] || null); }).catch(() => {});
  }, []);

  async function guardar() {
    setEstado('guardando');
    try {
      const g = await api(`/api/scripts/${sel.niche}`, { method: 'PUT', body: JSON.stringify({ title: sel.title, body: sel.body }) });
      setGuiones((gs) => gs.map((x) => (x.niche === g.niche ? g : x)));
      setEstado('guardado');
    } catch (e) { setEstado(e.message); }
  }

  if (!sel) return <div className="empty"><strong>Sin guiones.</strong> Se siembran con la migración 006.</div>;
  return (
    <div className="card">
      <div className="pl-barra">
        <select className="pl-select" value={sel.niche} onChange={(e) => { setSel(guiones.find((g) => g.niche === e.target.value)); setEstado(null); }} aria-label="Guion">
          {guiones.map((g) => <option key={g.niche} value={g.niche}>{nichoBonito(g.niche)}</option>)}
        </select>
      </div>
      <input className="pl-select" style={{ width: '100%' }} maxLength={120} value={sel.title} onChange={(e) => setSel({ ...sel, title: e.target.value })} aria-label="Título" />
      <textarea className="pl-notas pl-editor" value={sel.body} onChange={(e) => setSel({ ...sel, body: e.target.value })} aria-label="Guion" />
      <button type="button" className="btn" onClick={guardar} disabled={estado === 'guardando'}>Guardar guion</button>
      {estado && estado !== 'guardando' && <span className="sub" style={{ marginLeft: 8 }}>{estado === 'guardado' ? 'Guardado.' : estado}</span>}
    </div>
  );
}

// ── Scoreboard ─────────────────────────────────────────────────
function semanaDesplazada(iso, delta) {
  const [a, w] = iso.split('-W').map(Number);
  const d = new Date(Date.UTC(a, 0, 4 + (w - 1 + delta) * 7));
  const dia = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dia);
  const inicio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - inicio) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

function Scoreboard({ refresco }) {
  const [semana, setSemana] = useState(null);
  const [d, setD] = useState(null);
  useEffect(() => {
    api(`/api/scoreboard${semana ? `?week=${semana}` : ''}`).then((x) => { setD(x); if (!semana) setSemana(x.week); }).catch(() => {});
  }, [semana, refresco]);
  if (!d) return <p className="sub">Cargando…</p>;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const celdas = [
    ['Llamadas', d.calls, d.previous.calls], ['Contestaron', d.answered, d.previous.answered],
    ['Buzón', d.voicemail, d.previous.voicemail], ['Interesados', d.interested, d.previous.interested],
    ['Demos', d.demos, d.previous.demos], ['No llamar', d.doNotCall, d.previous.doNotCall],
    ['Tasa de contacto', pct(d.contactRate), pct(d.previous.contactRate)], ['Tasa de interés', pct(d.interestRate), pct(d.previous.interestRate)]
  ];
  return (
    <>
      <div className="pl-barra">
        <button type="button" className="iconbtn" onClick={() => setSemana(semanaDesplazada(d.week, -1))} aria-label="Semana anterior">‹</button>
        <b>{d.week}</b>
        <button type="button" className="iconbtn" onClick={() => setSemana(semanaDesplazada(d.week, 1))} aria-label="Semana siguiente">›</button>
      </div>
      <div className="grid">
        {celdas.map(([k, v, prev]) => (
          <div key={k} className="card"><h3>{k}</h3><div className="big">{v}</div><div className="sub">semana anterior: {prev}</div></div>
        ))}
      </div>
      <div className="pista">Experimento acordado: 100 llamadas en 2 semanas; revisar la apertura en la 50. Sin 100 llamadas no se concluye nada.</div>
    </>
  );
}

export default function Leads({ refresco = 0 }) {
  const [vista, setVista] = useState('llamar');
  const [local, setLocal] = useState(0);
  const nichos = useNichos(refresco + local);
  const [nicho, setNicho] = useState('');
  useEffect(() => { if (!nicho && nichos[0]) setNicho(nichos[0].niche); }, [nichos, nicho]);
  const alTerminar = useCallback(() => setLocal((n) => n + 1), []);

  return (
    <>
      <nav className="nav pl-subnav">
        {VISTAS.map((v) => (
          <button key={v.id} onClick={() => setVista(v.id)} aria-current={vista === v.id ? 'page' : undefined}>{v.label}</button>
        ))}
      </nav>
      {vista === 'llamar' && <Llamar nichos={nichos} nicho={nicho} setNicho={setNicho} />}
      {vista === 'lista' && <Lista nichos={nichos} />}
      {vista === 'importar' && <Importar nichos={nichos} alTerminar={alTerminar} />}
      {vista === 'guiones' && <Guiones />}
      {vista === 'score' && <Scoreboard refresco={refresco} />}
    </>
  );
}
