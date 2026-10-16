/* Pending approvals across ALL runs — Phase 2.

   The chat shows the approval for the conversation you're looking at. This
   screen exists for the other case, which is the normal one: you launched
   something hours ago, closed the browser, and the agent has been waiting
   ever since. It's the screen you open from your phone.

   It re-reads itself every 15 s. No SSE on purpose: there's no specific run to
   hook into here, and a short interval over a query with a partial index is
   cheaper than keeping one stream per tab. */

import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { t, registrar } from './i18n.js';

registrar({
  'Could not read the approvals: {msg}': 'No pude leer las aprobaciones: {msg}',
  'That one was already decided.': 'Esa ya estaba decidida.', 'Loading…': 'Cargando…',
  'Nothing waiting for permission.': 'Nada esperando permiso.',
  'When an agent wants to write, run or send something, it shows up here and waits — even if hours go by or the server restarts.': 'Cuando un agente quiera escribir, ejecutar o mandar algo, aparecerá aquí y se quedará esperando — aunque pasen horas o se reinicie el servidor.',
  '{n} waiting for your permission': '{n} esperando tu permiso', 'Use {tool}': 'Usar {tool}',
  'Approve': 'Aprobar', 'Deny': 'Denegar',
});

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
      setAviso(t('Could not read the approvals: {msg}', { msg: e.message }));
    }
  }, []);

  useEffect(() => {
    cargar();
    const id = setInterval(cargar, 15_000);
    return () => clearInterval(id);
  }, [cargar, refresco]);

  async function decidir(id, decision) {
    setOcupado(id);
    setAviso(null);
    try {
      await api(`/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision }) });
      setLista((l) => l.filter((a) => a.id !== id));
    } catch (e) {
      /* 409 = already decided. Happens when you tap twice on your phone, and
         it's no cause for alarm: just refresh. */
      setAviso(e.status === 409 ? t('That one was already decided.') : e.message);
      cargar();
    } finally {
      setOcupado(null);
    }
  }

  if (lista === null) return <div className="empty">{t('Loading…')}</div>;

  if (lista.length === 0) {
    return (
      <div className="empty">
        <strong>{t('Nothing waiting for permission.')}</strong>
        {t('When an agent wants to write, run or send something, it shows up here and waits — even if hours go by or the server restarts.')}
      </div>
    );
  }

  return (
    <>
      {aviso && <div className="aviso">{aviso}</div>}
      <h2 className="section-title">{t('{n} waiting for your permission', { n: lista.length })}</h2>
      {lista.map((a) => (
        <div key={a.id} className="aprobacion">
          <div className="cabeza">
            {a.tool} · <span className="mono">{a.runTitle || a.runId}</span>
          </div>
          <p>{a.summary || t('Use {tool}', { tool: a.tool })}</p>
          <pre className="mono">{recorta(a.input)}</pre>
          <div className="acciones">
            <button className="btn" disabled={ocupado === a.id}
              onClick={() => decidir(a.id, 'allow')}>{t('Approve')}</button>
            <button className="btn ghost" disabled={ocupado === a.id}
              onClick={() => decidir(a.id, 'deny')}>{t('Deny')}</button>
          </div>
        </div>
      ))}
    </>
  );
}
