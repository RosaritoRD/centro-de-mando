/* tu empresa — APM · autenticación.

   APM no tiene login propio. Reusa la cookie de sesión `__session` que emite
   tu web principal con el Admin SDK: va con Domain=.tu-dominio.com, así que el
   navegador la manda también a apm.tu-dominio.com. Cero pantallas nuevas, cero
   segundo sistema de auth.

   ESTO ATA APM AL DOMINIO: el Domain de la cookie lo deriva tu web principal de su
   APP_BASE_URL. Mientras eso sea tu-dominio.com, APM sólo puede vivir en
   *.tu-dominio.com. Servirlo desde otro dominio no da un error visible — da
   401 en bucle, porque el navegador simplemente no manda la cookie. Pasó el
   14/08 con la migración de tu-dominio.com.

   Dos credenciales aceptadas, igual que en tu web principal: el Bearer con el ID
   token o la cookie. En ambos casos se comprueba SIEMPRE la revocación — una
   cuenta desactivada no puede seguir entrando con un token que aún no expiró.

   AUTORIZACIÓN: APM es de UNA persona. No basta con tener una cuenta válida
   de Firebase; el UID tiene que estar en APM_ALLOWED_UIDS. Que un empleado de
   un DSP con cuenta en tu-dominio.com pudiera entrar al centro de mando sería el
   fallo más caro posible, y "no le voy a pasar el enlace" no es un control. */

const COOKIE_NAME = '__session';

/* Lee una cookie del header sin cookie-parser. Mismo enfoque que tu web principal:
   una dependencia menos con acceso a las cabeceras. */
export function sessionCookie(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return '';
}

/* La allowlist se lee una vez al arrancar: cambiarla es editar el .env y
   reiniciar, que para un producto de un solo usuario es exactamente el nivel
   de ceremonia correcto. */
export function parseAllowlist(raw) {
  return new Set(
    String(raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/* Núcleo inyectable: decide si un usuario entra, sin tocar red ni Firebase.
   Se prueba entero con `node --test`.

   Devuelve el MOTIVO y no un booleano porque 401 y 403 son cosas distintas
   para quien depura: 401 es "no sé quién eres" (la cookie caducó, hay que
   volver a signin) y 403 es "sé quién eres y no eres tú". */
export function decidirAcceso(user, allowlist) {
  if (!user || !user.uid) return { ok: false, status: 401, code: 'no_session' };
  /* Allowlist vacía = nadie entra. El fallo seguro es cerrar, no abrir: una
     variable de entorno que no se cargó no puede convertir el centro de mando
     en una página pública. */
  if (allowlist.size === 0) return { ok: false, status: 403, code: 'allowlist_empty' };
  if (!allowlist.has(user.uid)) return { ok: false, status: 403, code: 'not_allowed' };
  return { ok: true, uid: user.uid, email: user.email || null };
}

/* Verifica cualquiera de las dos credenciales contra Firebase. */
export async function verificarCredencial(req, fbAuth) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token) return fbAuth.verifyIdToken(token, true);

  const cookie = sessionCookie(req);
  if (!cookie) return null;
  return fbAuth.verifySessionCookie(cookie, true);
}

/* El middleware. `fbAuth` entra por parámetro para poder montar la API sin
   Firebase en las pruebas. */
export function requireUser({ fbAuth, allowlist }) {
  return async (req, res, next) => {
    let user = null;
    try {
      user = await verificarCredencial(req, fbAuth);
    } catch (e) {
      /* Token caducado, revocado o mal firmado. No es un error del servidor:
         es que hay que volver a identificarse. */
      return res.status(401).json({ error: { code: 'invalid_session', message: e.code || 'invalid' } });
    }
    const veredicto = decidirAcceso(user, allowlist);
    if (!veredicto.ok) {
      return res.status(veredicto.status).json({ error: { code: veredicto.code, message: 'no autorizado' } });
    }
    req.user = { uid: veredicto.uid, email: veredicto.email };
    next();
  };
}
