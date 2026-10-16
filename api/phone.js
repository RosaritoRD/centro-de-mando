/* US phone numbers in E.164 (+1XXXXXXXXXX).

   It's the leads' dedup key: if "(347) 555-0174" and "+1 347-555-0174" don't
   come out the same, the same business gets in twice and gets called twice.
   Anything doubtful (extensions, other countries, impossible NANP numbers) is
   rejected instead of guessed: one lead fewer beats a call to the wrong person. */

export function normalizarTelefono(valor) {
  if (valor == null) return null;
  const texto = String(valor).trim();
  if (!texto || /ext|x\s*\d|#/i.test(texto)) return null;
  if (texto.startsWith('+') && !texto.startsWith('+1')) return null;
  let d = texto.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return null;
  // NANP: neither the area code nor the exchange starts with 0 or 1.
  if (/^[01]/.test(d) || /^[01]/.test(d.slice(3))) return null;
  return `+1${d}`;
}

export function telefonoVisible(e164) {
  const d = String(e164 || '').replace(/^\+1/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(e164 || '');
}
