/* Call prospecting (Phase 3). Spec: .planning/specs/apm-prospeccion-llamadas.md

   Built for the thumb: the owner calls from THEIR own phone (tel: link) and here only
   marks what happened with big buttons, writes a note and decides whether to
   call back. No auto-dialer and no AI voice (TCPA).

   Five views: Call · List · Import · Scripts · Scoreboard. */

import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Ubicacion, { useUbicacion } from './Ubicacion.jsx';
import { enlaceDemo, esSalud, textoDemo } from './demo-texto.js';
import { t, registrar, LOCALE } from './i18n.js';

registrar({
  'Call': 'Llamar', 'List': 'Lista', 'Import': 'Importar', 'Scripts': 'Guiones', 'Scoreboard': 'Scoreboard',
  'No answer': 'No contestó', 'Voicemail': 'Buzón de voz', 'Not interested': 'No le interesa', 'Interested': 'Interesado',
  'Call later': 'Llamar luego', 'Demo booked': 'Demo agendada', 'Do not call again': 'No llamar más', 'Bad number': 'Número malo',
  'Tomorrow': 'Mañana', '3 days': '3 días', '1 week': '1 semana', 'Niche': 'Nicho',
  'Clinic: because of HIPAA, no pilot or demo is offered. If you call, make it to close the loop politely: the clinic version doesn\'t exist yet.': 'Clínica: por HIPAA no se ofrece piloto ni demo. Si llamas, que sea para cerrar bien: la versión para clínicas aún no existe.',
  'Did they say yes? Copy the text with this business\'s demo and send it from your messages.': '¿Te dijo que sí? Copia el texto con la demo de este negocio y mándalo desde tus mensajes.',
  'Copied ✓': 'Copiado ✓', 'Text in English': 'Texto en inglés', 'Text in Spanish': 'Texto en español',
  'See their demo': 'Ver su demo', 'Text to copy': 'Texto para copiar', 'No leads yet.': 'Todavía no hay leads.',
  'Go to Import and bring in Bronx contractors from NYC Open Data.': 'Ve a Importar y trae contratistas del Bronx desde NYC Open Data.',
  '{due} due · {new} new': '{due} pendientes · {new} nuevos', '{n} today in this session': '{n} hoy en esta sesión',
  'Outside calling hours.': 'Fuera de horario.',
  'Calls only go out from 8:00 to 21:00 business time (TCPA). Opens {when}.': 'Solo se llama de 8:00 a 21:00 hora del negocio (TCPA). Se abre {when}.',
  'Nobody left to call right now in this niche.': 'No queda nadie a quien llamar ahora en este nicho.',
  'Import more or wait for the scheduled call-backs ({n}).': 'Importa más o espera a los "volver a llamar" programados ({n}).',
  'website': 'web', 'Tap the number to call from your phone. On a computer, dial it by hand.': 'Toca el número para llamar desde tu móvil. En el ordenador, márcalo a mano.',
  'Script: {title}': 'Guion: {title}', 'Call outcome': 'Resultado de la llamada',
  'Notes: who you spoke with, what they said, when suits them…': 'Notas: con quién hablaste, qué dijo, cuándo le viene bien…',
  'Call back?': '¿Volver a llamar?', 'No — added to the do-not-call list': 'No — se añade a la lista de no llamar',
  'Pick a date': 'Elegir fecha', 'No': 'No', 'Saving…': 'Guardando…', 'Save and next': 'Guardar y siguiente',
  'All niches': 'Todos los nichos', 'Status': 'Estado', 'All statuses': 'Todos los estados',
  'Search name or phone': 'Buscar nombre o teléfono', '{n} leads': '{n} leads', 'Loading…': 'Cargando…',
  'call back {when}': 'volver {when}', 'internal': 'interno', 'Sources: {list}': 'Fuentes: {list}',
  'No calls yet.': 'Sin llamadas todavía.', 'Close': 'Cerrar', 'Bring in leads': 'Traer leads', 'Source': 'Fuente',
  'NYC Open Data (free, legal)': 'NYC Open Data (gratis, legal)',
  'Google Maps (internal scraper, {n}/3 today)': 'Google Maps (scraper interno, {n}/3 hoy)',
  'Category': 'Categoría', 'Borough': 'Barrio', 'All of NYC': 'Toda NYC', 'ZIP (optional)': 'ZIP (opcional)',
  'What to search (e.g. plumbers)': 'Qué buscar (ej. plumbers)', 'Where (e.g. Bronx, NY)': 'Dónde (ej. Bronx, NY)',
  'Niche (e.g. plumbers)': 'Nicho (ej. plumbers)',
  'Gentle search: 1 at a time, max 100 results, 3 a day. Takes a few minutes. These leads are marked as internal.': 'Búsqueda suave: 1 a la vez, máx. 100 resultados, 3 al día. Tarda unos minutos. Estos leads quedan marcados como internos.',
  'Importing…': 'Importando…',
  'Done: {found} found · {inserted} new · {merged} already there · {suppressed} on "do not call" · {invalid} without a valid phone.': 'Listo: {found} encontrados · {inserted} nuevos · {merged} ya estaban · {suppressed} en "no llamar" · {invalid} sin teléfono válido.',
  'Failed: {msg}': 'Falló: {msg}', 'Latest imports': 'Últimas importaciones', ' · {inserted} new / {found}': ' · {inserted} nuevos / {found}',
  'Chat area': 'Zona del chat', 'No scripts.': 'Sin guiones.', 'They are seeded by migration 006.': 'Se siembran con la migración 006.',
  'Script': 'Guion', 'Title': 'Título', 'Save script': 'Guardar guion', 'Saved.': 'Guardado.',
  'Calls': 'Llamadas', 'Answered': 'Contestaron', 'Voicemail ': 'Buzón', 'Demos': 'Demos', 'Do not call': 'No llamar',
  'Contact rate': 'Tasa de contacto', 'Interest rate': 'Tasa de interés', 'Interested ': 'Interesados',
  'Previous week': 'Semana anterior', 'Next week': 'Semana siguiente', 'previous week: {n}': 'semana anterior: {n}',
  'Agreed experiment: 100 calls in 2 weeks; review the opener at 50. Without 100 calls, nothing can be concluded.': 'Experimento acordado: 100 llamadas en 2 semanas; revisar la apertura en la 50. Sin 100 llamadas no se concluye nada.',
});

const VISTAS = [
  { id: 'llamar', label: t('Call') },
  { id: 'lista', label: t('List') },
  { id: 'importar', label: t('Import') },
  { id: 'guiones', label: t('Scripts') },
  { id: 'score', label: t('Scoreboard') }
];

/* Each button with its suggested call-back. Suppression ones can't be
   scheduled: the API enforces it anyway, here it's just made clear. */
const RESULTADOS = [
  { id: 'no_contesto', label: t('No answer'), sugerido: 1 },
  { id: 'buzon', label: t('Voicemail'), sugerido: 3 },
  { id: 'no_interesa', label: t('Not interested'), sugerido: null },
  { id: 'interesado', label: t('Interested'), sugerido: 1, tono: 'ok' },
  { id: 'llamar_luego', label: t('Call later'), sugerido: 1 },
  { id: 'demo', label: t('Demo booked'), sugerido: 1, tono: 'ok' },
  { id: 'no_llamar', label: t('Do not call again'), bloquea: true, tono: 'bad' },
  { id: 'numero_malo', label: t('Bad number'), bloquea: true, tono: 'bad' }
];
const ETIQUETA = Object.fromEntries(RESULTADOS.map((r) => [r.id, r.label]));
const ATAJOS = [{ dias: 1, label: t('Tomorrow') }, { dias: 3, label: t('3 days') }, { dias: 7, label: t('1 week') }];

const CATEGORIA_A_NICHO = (c) => c.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const nichoBonito = (n) => n.replace(/_/g, ' ');
/* Second barrier (the API already filters): never an href that isn't http(s). */
const webSegura = (u) => (/^https?:\/\//i.test(String(u || '')) ? u : null);

/* At 10:00 on the chosen day: a reasonable time for a contractor. */
function enDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  d.setHours(10, 0, 0, 0);
  return d;
}
const paraInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const fechaCorta = (s) => (s ? new Date(s).toLocaleString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

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
    <select className="pl-select" value={valor} onChange={(e) => onChange(e.target.value)} aria-label={t('Niche')}>
      {nichos.map((n) => <option key={n.niche} value={n.niche}>{nichoBonito(n.niche)} ({n.total})</option>)}
    </select>
  );
}

// ── Send the demo ──────────────────────────────────────────────
/* Only if they say yes (TCPA): copies the text with THAT business's demo to
   paste into your messages. Nothing is sent from here on its own. */
function MandarDemo({ lead }) {
  const [copiado, setCopiado] = useState(null);   // 'en' | 'es' | null
  const [aMano, setAMano] = useState(null);       // the text, if the clipboard won't cooperate

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
    return <div className="aviso">{t("Clinic: because of HIPAA, no pilot or demo is offered. If you call, make it to close the loop politely: the clinic version doesn't exist yet.")}</div>;
  }
  return (
    <div className="pl-demo">
      <div className="pista">{t("Did they say yes? Copy the text with this business's demo and send it from your messages.")}</div>
      <div className="pl-volver">
        <button type="button" className="pl-atajo" onClick={() => copiar('en')}>{copiado === 'en' ? t('Copied ✓') : t('Text in English')}</button>
        <button type="button" className="pl-atajo" onClick={() => copiar('es')}>{copiado === 'es' ? t('Copied ✓') : t('Text in Spanish')}</button>
        <a className="pl-atajo pl-enlace" href={enlaceDemo(lead)} target="_blank" rel="noopener noreferrer">{t('See their demo')}</a>
      </div>
      {aMano && (
        <textarea className="pl-notas" readOnly rows={4} value={aMano} autoFocus
          onFocus={(e) => e.target.select()} aria-label={t('Text to copy')} />
      )}
    </div>
  );
}

// ── Call ───────────────────────────────────────────────────────
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
    return <div className="empty"><strong>{t('No leads yet.')}</strong> {t('Go to Import and bring in Bronx contractors from NYC Open Data.')}</div>;
  }
  const r = RESULTADOS.find((x) => x.id === resultado);
  const lead = datos?.lead;

  return (
    <>
      <div className="pl-barra">
        <SelectorNicho nichos={nichos} valor={nicho} onChange={setNicho} />
        {datos?.queue && <span className="chip">{t('{due} due · {new} new', { due: datos.queue.due, new: datos.queue.new })}</span>}
        {hechas > 0 && <span className="chip ok">{t('{n} today in this session', { n: hechas })}</span>}
      </div>
      {error && <div className="aviso">{error}</div>}

      {!lead && datos && (
        <div className="empty">
          {datos.reason === 'outside_hours'
            ? <><strong>{t('Outside calling hours.')}</strong> {t('Calls only go out from 8:00 to 21:00 business time (TCPA). Opens {when}.', { when: fechaCorta(datos.opensAt) })}</>
            : <><strong>{t('Nobody left to call right now in this niche.')}</strong> {t('Import more or wait for the scheduled call-backs ({n}).', { n: datos.queue?.scheduled || 0 })}</>}
        </div>
      )}

      {lead && (
        <div className="card pl-tarjeta">
          <div className="pl-negocio">{lead.businessName}</div>
          <div className="sub">{[lead.boroughCity, lead.zip].filter(Boolean).join(' · ')}{webSegura(lead.website) && <> · <a href={webSegura(lead.website)} target="_blank" rel="noopener noreferrer">{t('website')}</a></>}</div>
          <a className="pl-telefono" href={`tel:${lead.phone}`}>{lead.phoneDisplay}</a>
          <div className="pista">{t('Tap the number to call from your phone. On a computer, dial it by hand.')}</div>

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
              <summary>{t('Script: {title}', { title: datos.script.title })}</summary>
              <div className="pl-guion-texto">{datos.script.body}</div>
            </details>
          )}

          <div className="pl-resultados" role="group" aria-label={t('Call outcome')}>
            {RESULTADOS.map((x) => (
              <button key={x.id} type="button" className={`pl-res ${x.tono || ''}`} aria-pressed={resultado === x.id} onClick={() => elegir(x)}>
                {x.label}
              </button>
            ))}
          </div>

          <textarea className="pl-notas" rows={3} maxLength={5000} placeholder={t('Notes: who you spoke with, what they said, when suits them…')}
            value={notas} onChange={(e) => setNotas(e.target.value)} />

          <div className="pl-volver">
            <span>{t('Call back?')}</span>
            {r?.bloquea
              ? <span className="chip bad">{t('No — added to the do-not-call list')}</span>
              : (
                <>
                  {ATAJOS.map((a) => (
                    <button key={a.dias} type="button" className="pl-atajo" aria-pressed={volver && Math.round((volver - enDias(0)) / 86400000) === a.dias}
                      onClick={() => setVolver(enDias(a.dias))}>{a.label}</button>
                  ))}
                  <input type="datetime-local" className="pl-fecha" aria-label={t('Pick a date')}
                    value={volver ? paraInput(volver) : ''} onChange={(e) => setVolver(e.target.value ? new Date(e.target.value) : null)} />
                  <button type="button" className="pl-atajo" aria-pressed={!volver} onClick={() => setVolver(null)}>{t('No')}</button>
                </>
              )}
          </div>

          <button type="button" className="btn pl-guardar" disabled={!resultado || guardando} onClick={guardar}>
            {guardando ? t('Saving…') : t('Save and next')}
          </button>
        </div>
      )}
    </>
  );
}

// ── List ───────────────────────────────────────────────────────
function Lista({ nichos }) {
  const [filtros, setFiltros] = useState({ niche: '', status: '', q: '' });
  const [datos, setDatos] = useState(null);
  const [ficha, setFicha] = useState(null);
  const qs = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();

  useEffect(() => {
    const id = setTimeout(() => api(`/api/leads?${qs}`).then(setDatos).catch(() => {}), 250);
    return () => clearTimeout(id);
  }, [qs]);

  const cambiar = (k) => (e) => setFiltros((f) => ({ ...f, [k]: e.target.value }));
  return (
    <>
      <div className="pl-barra">
        <select className="pl-select" value={filtros.niche} onChange={cambiar('niche')} aria-label={t('Niche')}>
          <option value="">{t('All niches')}</option>
          {nichos.map((n) => <option key={n.niche} value={n.niche}>{nichoBonito(n.niche)}</option>)}
        </select>
        <select className="pl-select" value={filtros.status} onChange={cambiar('status')} aria-label={t('Status')}>
          <option value="">{t('All statuses')}</option>
          {['nuevo', 'llamado', 'interesado', 'demo', 'cliente', 'descartado'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input className="pl-select" placeholder={t('Search name or phone')} value={filtros.q} onChange={cambiar('q')} />
        <a className="btn" href={`/api/leads?${qs}${qs ? '&' : ''}format=csv`}>CSV</a>
      </div>
      <div className="sub" style={{ margin: '6px 0' }}>{datos ? t('{n} leads', { n: datos.total }) : t('Loading…')}</div>
      <div className="pl-lista">
        {datos?.leads.map((l) => (
          <button key={l.id} type="button" className="card pl-fila" onClick={() => api(`/api/leads/${l.id}`).then(setFicha)}>
            <b>{l.businessName}</b>
            <span>{l.phoneDisplay} · {l.boroughCity || '—'} · {l.status}{l.nextCallAt ? ` · ${t('call back {when}', { when: fechaCorta(l.nextCallAt) })}` : ''}{l.internalOnly ? ` · ${t('internal')}` : ''}</span>
          </button>
        ))}
      </div>
      {ficha && (
        <div className="card pl-tarjeta" style={{ marginTop: 12 }}>
          <div className="pl-negocio">{ficha.businessName}</div>
          <a className="pl-telefono" href={`tel:${ficha.phone}`}>{ficha.phoneDisplay}</a>
          <div className="sub">{t('Sources: {list}', { list: ficha.sources.join(', ') })}</div>
          <div className="pl-historial">
            {ficha.history.length === 0 && <div className="sub">{t('No calls yet.')}</div>}
            {ficha.history.map((h) => (
              <div key={h.id} className="pl-hist"><b>{ETIQUETA[h.outcome]}</b> · {fechaCorta(h.createdAt)}{h.notes && <div>{h.notes}</div>}</div>
            ))}
          </div>
          <button type="button" className="btn" onClick={() => setFicha(null)}>{t('Close')}</button>
        </div>
      )}
    </>
  );
}

// ── Import ─────────────────────────────────────────────────────
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

  // Poll the run until it finishes.
  useEffect(() => {
    if (!run || run.status !== 'running') return undefined;
    const id = setInterval(async () => {
      try {
        const r = await api(`/api/leads/import/${run.id}`);
        setRun(r);
        if (r.status !== 'running') { recargar(); alTerminar(); }
      } catch { /* next round */ }
    }, 3000);
    return () => clearInterval(id);
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
        <h3>{t('Bring in leads')}</h3>
        <div className="pl-barra">
          <select className="pl-select" value={fuente} onChange={(e) => setFuente(e.target.value)} aria-label={t('Source')}>
            <option value="nyc_open_data">{t('NYC Open Data (free, legal)')}</option>
            <option value="google_maps">{t('Google Maps (internal scraper, {n}/3 today)', { n: gmHoy })}</option>
          </select>
        </div>
        {fuente === 'nyc_open_data' ? (
          <div className="pl-barra">
            <select className="pl-select" value={nyc.category} onChange={(e) => setNyc({ ...nyc, category: e.target.value })} aria-label={t('Category')}>
              {(meta?.categories || [nyc.category]).map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className="pl-select" value={nyc.borough} onChange={(e) => setNyc({ ...nyc, borough: e.target.value })} aria-label={t('Borough')}>
              <option value="">{t('All of NYC')}</option>
              {(meta?.boroughs || []).map((b) => <option key={b}>{b}</option>)}
            </select>
            <input className="pl-select" inputMode="numeric" maxLength={5} placeholder={t('ZIP (optional)')} value={nyc.zip} onChange={(e) => setNyc({ ...nyc, zip: e.target.value })} />
          </div>
        ) : (
          <>
            <div className="pl-barra">
              <input className="pl-select" placeholder={t('What to search (e.g. plumbers)')} maxLength={60} value={gm.query} onChange={(e) => setGm({ ...gm, query: e.target.value })} />
              <input className="pl-select" placeholder={t('Where (e.g. Bronx, NY)')} maxLength={60} value={gm.location} onChange={(e) => setGm({ ...gm, location: e.target.value })} />
              <input className="pl-select" placeholder={t('Niche (e.g. plumbers)')} list="pl-nichos" value={gm.niche} onChange={(e) => setGm({ ...gm, niche: CATEGORIA_A_NICHO(e.target.value) })} />
              <datalist id="pl-nichos">{nichos.map((n) => <option key={n.niche} value={n.niche} />)}</datalist>
            </div>
            <div className="pista">{t('Gentle search: 1 at a time, max 100 results, 3 a day. Takes a few minutes. These leads are marked as internal.')}</div>
          </>
        )}
        <button type="button" className="btn" disabled={run?.status === 'running' || (fuente === 'google_maps' && (gmHoy >= 3 || gm.query.trim().length < 2))} onClick={lanzar}>
          {run?.status === 'running' ? t('Importing…') : t('Import')}
        </button>
        {error && <div className="aviso">{error}</div>}
        {run && run.status !== 'running' && (
          <div className={`aviso ${run.status === 'done' ? 'ok' : ''}`}>
            {run.status === 'done'
              ? t('Done: {found} found · {inserted} new · {merged} already there · {suppressed} on "do not call" · {invalid} without a valid phone.', run)
              : t('Failed: {msg}', { msg: run.error })}
          </div>
        )}
      </div>

      {meta?.runs?.length > 0 && (
        <>
          <h2 className="section-title">{t('Latest imports')}</h2>
          {meta.runs.map((r) => (
            <div key={r.id} className="sub pl-hist">
              {fechaCorta(r.startedAt)} · {r.source} · {nichoBonito(r.niche)} · <b>{r.status}</b>
              {r.status === 'done' && t(' · {inserted} new / {found}', r)}{r.error && ` · ${r.error}`}
            </div>
          ))}
        </>
      )}

      <h2 className="section-title">{t('Chat area')}</h2>
      <Ubicacion ubic={ubic} setUbic={setUbic} ciudades={ciudades} compacto />
    </>
  );
}

// ── Scripts ────────────────────────────────────────────────────
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

  if (!sel) return <div className="empty"><strong>{t('No scripts.')}</strong> {t('They are seeded by migration 006.')}</div>;
  return (
    <div className="card">
      <div className="pl-barra">
        <select className="pl-select" value={sel.niche} onChange={(e) => { setSel(guiones.find((g) => g.niche === e.target.value)); setEstado(null); }} aria-label={t('Script')}>
          {guiones.map((g) => <option key={g.niche} value={g.niche}>{nichoBonito(g.niche)}</option>)}
        </select>
      </div>
      <input className="pl-select" style={{ width: '100%' }} maxLength={120} value={sel.title} onChange={(e) => setSel({ ...sel, title: e.target.value })} aria-label={t('Title')} />
      <textarea className="pl-notas pl-editor" value={sel.body} onChange={(e) => setSel({ ...sel, body: e.target.value })} aria-label={t('Script')} />
      <button type="button" className="btn" onClick={guardar} disabled={estado === 'guardando'}>{t('Save script')}</button>
      {estado && estado !== 'guardando' && <span className="sub" style={{ marginLeft: 8 }}>{estado === 'guardado' ? t('Saved.') : estado}</span>}
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
  if (!d) return <p className="sub">{t('Loading…')}</p>;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const celdas = [
    [t('Calls'), d.calls, d.previous.calls], [t('Answered'), d.answered, d.previous.answered],
    [t('Voicemail ').trim(), d.voicemail, d.previous.voicemail], [t('Interested ').trim(), d.interested, d.previous.interested],
    [t('Demos'), d.demos, d.previous.demos], [t('Do not call'), d.doNotCall, d.previous.doNotCall],
    [t('Contact rate'), pct(d.contactRate), pct(d.previous.contactRate)], [t('Interest rate'), pct(d.interestRate), pct(d.previous.interestRate)]
  ];
  return (
    <>
      <div className="pl-barra">
        <button type="button" className="iconbtn" onClick={() => setSemana(semanaDesplazada(d.week, -1))} aria-label={t('Previous week')}>‹</button>
        <b>{d.week}</b>
        <button type="button" className="iconbtn" onClick={() => setSemana(semanaDesplazada(d.week, 1))} aria-label={t('Next week')}>›</button>
      </div>
      <div className="grid">
        {celdas.map(([k, v, prev]) => (
          <div key={k} className="card"><h3>{k}</h3><div className="big">{v}</div><div className="sub">{t('previous week: {n}', { n: prev })}</div></div>
        ))}
      </div>
      <div className="pista">{t('Agreed experiment: 100 calls in 2 weeks; review the opener at 50. Without 100 calls, nothing can be concluded.')}</div>
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
