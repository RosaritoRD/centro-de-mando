/* Desde dónde consulto y dónde busco los leads.

   Son DOS sitios y no uno. Se vive en un lado y se vende en otro, y meterlos
   en un solo campo obliga a elegir cuál se pierde. El destino vacío hereda la
   base — "busca leads" sin decir dónde quiere decir "donde estoy" — pero al
   revés no: buscar clientes en Miami no significa estar en Miami.

   El valor vive arriba (en el chat) y no aquí dentro: el chat manda la
   ubicación con cada mensaje, así que se puede cambiar para UNA consulta sin
   guardarla. El botón de guardar es lo que la convierte en la de siempre. */

import { useEffect, useState } from 'react';
import { api } from './api.js';
import { PAISES, FRECUENTES, nombrePais } from './paises.js';

const VACIA = { base: { city: '', country: '' }, target: { city: '', country: '' } };

export function textoDe(sitio) {
  if (!sitio) return '';
  const p = sitio.country ? nombrePais(sitio.country) : '';
  if (sitio.city && p) return `${sitio.city} (${p})`;
  return sitio.city || p;
}

/* Carga la ubicación guardada una sola vez y la deja en manos de quien la
   use. Devuelve también el guardar, para que el componente no tenga que
   saber de rutas. */
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
      /* Que no se pueda leer el ajuste no puede dejar sin chat: se sigue con
         los campos vacíos, que es exactamente como estaba antes de esto. */
      .catch(() => vivo && setCargada(true));
    return () => { vivo = false; };
  }, []);

  return { ubic, setUbic, ciudades, cargada };
}

function Pais({ value, onChange, id }) {
  const resto = PAISES.filter((p) => !FRECUENTES.includes(p.code));
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-label="País">
      <option value="">País…</option>
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
          placeholder="Ciudad"
          /* Escrita a mano y no elegida de una lista: "Bronx, NY" y "Newark,
             NJ" son las dos cosas que hacen falta, y ninguna base de ciudades
             gratis las tiene bien a la vez. */
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
    ? `${textoDe(ubic.base) || 'sin definir'} · busca en ${textoDe(destino) || 'sin definir'}`
    : 'sin definir — el agente buscará donde le parezca';

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    try {
      await api('/api/location', { method: 'PUT', body: JSON.stringify(ubic) });
      setAviso('Guardada. Se usará en las próximas consultas.');
    } catch (e) {
      setAviso(`No pude guardarla: ${e.message}`);
    } finally {
      setGuardando(false);
    }
  }

  const cuerpo = (
    <div className="ubicacion-cuerpo">
      {/* Un solo datalist para los dos campos: dos elementos con el mismo id
          no es cosa de estilo — el navegador se queda con uno y el otro campo
          deja de sugerir sin decir nada. */}
      <datalist id="apm-ciudades">
        {ciudades.map((c) => <option key={c} value={c} />)}
      </datalist>
      <Sitio
        etiqueta="Consulto desde"
        pista="Tu zona: huso horario y mercado desde el que preguntas."
        sitio={ubic.base}
        onChange={(s) => setUbic({ ...ubic, base: s })}
        idBase="base"
      />
      <Sitio
        etiqueta="Buscar leads en"
        pista="Déjalo vacío para buscar donde estás."
        sitio={ubic.target}
        onChange={(s) => setUbic({ ...ubic, target: s })}
        idBase="target"
      />
      <div className="controles">
        <button className="btn ghost" type="button" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar como predeterminada'}
        </button>
        <span className="pista">
          Sin guardar, el cambio vale solo para el próximo mensaje.
        </span>
      </div>
      {aviso && <p className="pista">{aviso}</p>}
    </div>
  );

  if (!compacto) return <div className="ubicacion">{cuerpo}</div>;

  return (
    <details className="ubicacion">
      <summary>
        <span className="etiqueta">Ubicación</span>
        <span className="mono">{resumen}</span>
      </summary>
      {cuerpo}
    </details>
  );
}
