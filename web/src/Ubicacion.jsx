/* Where I'm asking from and where I search for leads.

   TWO places, not one. You live in one place and sell in another, and putting
   them in a single field forces you to choose which one to lose. An empty
   target inherits the base — "find leads" without saying where means "where I
   am" — but not the other way round: looking for clients in Miami doesn't
   mean being in Miami.

   The value lives up in the chat, not in here: the chat sends the location
   with every message, so it can be changed for ONE query without saving it.
   The save button is what makes it the default. */

import { useEffect, useState } from 'react';
import { api } from './api.js';
import { PAISES, FRECUENTES, nombrePais } from './paises.js';
import { t, registrar } from './i18n.js';

registrar({
  'Country': 'País', 'Country…': 'País…', 'City': 'Ciudad', 'not set': 'sin definir',
  '{base} · searching in {target}': '{base} · busca en {target}',
  'not set — the agent will search wherever it likes': 'sin definir — el agente buscará donde le parezca',
  'Saved. It will be used in the next queries.': 'Guardada. Se usará en las próximas consultas.',
  'Could not save it: {msg}': 'No pude guardarla: {msg}', 'Asking from': 'Consulto desde',
  'Your area: the time zone and market you ask from.': 'Tu zona: huso horario y mercado desde el que preguntas.',
  'Search for leads in': 'Buscar leads en', 'Leave it empty to search where you are.': 'Déjalo vacío para buscar donde estás.',
  'Saving…': 'Guardando…', 'Save as default': 'Guardar como predeterminada',
  'Without saving, the change only applies to the next message.': 'Sin guardar, el cambio vale solo para el próximo mensaje.',
  'Location': 'Ubicación',
});

const VACIA = { base: { city: '', country: '' }, target: { city: '', country: '' } };

export function textoDe(sitio) {
  if (!sitio) return '';
  const p = sitio.country ? nombrePais(sitio.country) : '';
  if (sitio.city && p) return `${sitio.city} (${p})`;
  return sitio.city || p;
}

/* Loads the saved location once and hands it to whoever uses it. It also
   returns the setter, so the component doesn't need to know about routes. */
export function useUbicacion() {
  const [ubic, setUbic] = useState(VACIA);
  const [ciudades, setCiudades] = useState([]);
  const [cargada, setCargada] = useState(false);

  useEffect(() => {
    let vivo = true;
    api('/api/location')
      .then((d) => {
        if (!vivo) return;
        setUbic({
          base:   { city: d.base.city || '',   country: d.base.country || '' },
          target: { city: d.target.city || '', country: d.target.country || '' }
        });
        setCiudades(d.ciudades || []);
        setCargada(true);
      })
      /* Failing to read the setting can't leave you without a chat: carry on
         with empty fields, exactly how things were before this existed. */
      .catch(() => vivo && setCargada(true));
    return () => { vivo = false; };
  }, []);

  return { ubic, setUbic, ciudades, cargada };
}

function Pais({ value, onChange, id }) {
  const resto = PAISES.filter((p) => !FRECUENTES.includes(p.code));
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('Country')}>
      <option value="">{t('Country…')}</option>
      {FRECUENTES.map((c) => <option key={c} value={c}>{nombrePais(c)}</option>)}
      <option disabled>──────────</option>
      {resto.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
    </select>
  );
}

function Sitio({ etiqueta, pista, sitio, onChange, idBase }) {
  return (
    <div className="sitio">
      <label htmlFor={`${idBase}-ciudad`}>{etiqueta}</label>
      <div className="campos">
        <input
          id={`${idBase}-ciudad`}
          list="apm-ciudades"
          value={sitio.city}
          onChange={(e) => onChange({ ...sitio, city: e.target.value })}
          placeholder={t('City')}
          /* Typed by hand, not picked from a list: "Bronx, NY" and "Newark,
             NJ" are the two things needed, and no free city database gets
             both right at once. */
          maxLength={80}
        />
        <Pais value={sitio.country} onChange={(c) => onChange({ ...sitio, country: c })}
          id={`${idBase}-pais`} />
      </div>
      {pista && <p className="pista">{pista}</p>}
    </div>
  );
}

export default function Ubicacion({ ubic, setUbic, ciudades, compacto = true }) {
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);

  const destino = ubic.target.city || ubic.target.country ? ubic.target : ubic.base;
  const resumen = textoDe(ubic.base) || textoDe(ubic.target)
    ? t('{base} · searching in {target}', { base: textoDe(ubic.base) || t('not set'), target: textoDe(destino) || t('not set') })
    : t('not set — the agent will search wherever it likes');

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    try {
      await api('/api/location', { method: 'PUT', body: JSON.stringify(ubic) });
      setAviso(t('Saved. It will be used in the next queries.'));
    } catch (e) {
      setAviso(t('Could not save it: {msg}', { msg: e.message }));
    } finally {
      setGuardando(false);
    }
  }

  const cuerpo = (
    <div className="ubicacion-cuerpo">
      {/* One datalist for both fields: two elements with the same id isn't a
          style issue — the browser keeps one and the other field silently
          stops suggesting. */}
      <datalist id="apm-ciudades">
        {ciudades.map((c) => <option key={c} value={c} />)}
      </datalist>
      <Sitio
        etiqueta={t('Asking from')}
        pista={t('Your area: the time zone and market you ask from.')}
        sitio={ubic.base}
        onChange={(s) => setUbic({ ...ubic, base: s })}
        idBase="base"
      />
      <Sitio
        etiqueta={t('Search for leads in')}
        pista={t('Leave it empty to search where you are.')}
        sitio={ubic.target}
        onChange={(s) => setUbic({ ...ubic, target: s })}
        idBase="target"
      />
      <div className="controles">
        <button className="btn ghost" type="button" onClick={guardar} disabled={guardando}>
          {guardando ? t('Saving…') : t('Save as default')}
        </button>
        <span className="pista">
          {t('Without saving, the change only applies to the next message.')}
        </span>
      </div>
      {aviso && <p className="pista">{aviso}</p>}
    </div>
  );

  if (!compacto) return <div className="ubicacion">{cuerpo}</div>;

  return (
    <details className="ubicacion">
      <summary>
        <span className="etiqueta">{t('Location')}</span>
        <span className="mono">{resumen}</span>
      </summary>
      {cuerpo}
    </details>
  );
}
