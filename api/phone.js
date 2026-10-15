/* Teléfonos de EE. UU. en E.164 (+1XXXXXXXXXX).

   Es la clave de deduplicación de los leads: si "(347) 555-0174" y
   "+1 347-555-0174" no dan lo mismo, el mismo negocio entra dos veces y se le
   llama dos veces. Se rechaza todo lo dudoso (extensiones, otros países,
   números NANP imposibles) en vez de adivinar: un lead menos es mejor que una
   llamada a quien no era. */

export function normalizarTelefono(valor) {
  if (valor == null) return null;
  const texto = String(valor).trim();
  if (!texto || /ext|x\s*\d|#/i.test(texto)) return null;
  if (texto.startsWith('+') && !texto.startsWith('+1')) return null;
  let d = texto.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return null;
  // NANP: ni el prefijo de zona ni la central empiezan por 0 o 1.
  if (/^[01]/.test(d) || /^[01]/.test(d.slice(3))) return null;
  return `+1${d}`;
}

export function telefonoVisible(e164) {
  const d = String(e164 || '').replace(/^\+1/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(e164 || '');
}
