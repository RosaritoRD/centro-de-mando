/* Las credenciales de una petición, en un solo sitio.

   Esta regla viene prestada de tu web principal, donde no existir costó un bug caro:
   tres puntos armaban la cabecera a mano y los tres se dejaron una credencial,
   así que las fotos salían en gris sin un solo error visible. Aquí empieza
   centralizado desde el primer commit.

   De momento no hay cabecera que poner: la cookie __session viaja sola porque
   su Domain es .tu-dominio.com y esto se sirve desde apm.tu-dominio.com. Basta
   con `credentials: 'same-origin'`. Cuando haga falta un token de MFA o un
   X-Request-Id, se añade AQUÍ. */

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });

  let body = null;
  try { body = await res.json(); } catch { /* respuestas sin JSON */ }

  if (!res.ok) {
    const err = (body && body.error) || {};
    throw new ApiError(res.status, err.code, err.message);
  }
  return body;
}
