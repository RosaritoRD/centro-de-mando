/* Acme — APM · authentication.

   APM has no login of its own. It reuses the `__session` cookie that
   your main website issues with the Admin SDK: it's set with Domain=.your-domain.com,
   so the browser also sends it to apm.your-domain.com. Zero new screens, zero
   second auth system.

   THIS TIES APM TO THE DOMAIN: your main website derives the cookie's Domain from its
   APP_BASE_URL. As long as that's your-domain.com, APM can only live on
   *.your-domain.com. Serving it from another domain gives no visible error — it
   gives a 401 loop, because the browser simply doesn't send the cookie. It
   happened on 14/08 with the your-domain.com migration.

   Two credentials accepted, same as your main website: a Bearer ID token or the
   cookie. Revocation is ALWAYS checked in both cases — a disabled account
   can't keep getting in with a token that hasn't expired yet.

   AUTHORIZATION: APM belongs to ONE person. A valid Firebase account isn't
   enough; the UID must be in APM_ALLOWED_UIDS. A DSP employee with a
   your-domain.com account getting into the command center would be the most
   expensive failure possible, and "I won't send them the link" isn't a control. */

const COOKIE_NAME = '__session';

/* Reads a cookie from the header without cookie-parser. Same approach as
   your main website: one less dependency with access to the headers. */
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

/* The allowlist is read once at startup: changing it means editing the .env
   and restarting, which for a single-user product is exactly the right amount
   of ceremony. */
export function parseAllowlist(raw) {
  return new Set(
    String(raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/* Injectable core: decides whether a user gets in, without touching the
   network or Firebase. Fully tested with `node --test`.

   It returns the REASON and not a boolean because 401 and 403 mean different
   things to whoever is debugging: 401 is "I don't know who you are" (the
   cookie expired, go back to sign-in) and 403 is "I know who you are and
   you're not the one". */
export function decidirAcceso(user, allowlist) {
  if (!user || !user.uid) return { ok: false, status: 401, code: 'no_session' };
  /* Empty allowlist = nobody gets in. The safe failure is to close, not open:
     an environment variable that didn't load can't turn the command center
     into a public page. */
  if (allowlist.size === 0) return { ok: false, status: 403, code: 'allowlist_empty' };
  if (!allowlist.has(user.uid)) return { ok: false, status: 403, code: 'not_allowed' };
  return { ok: true, uid: user.uid, email: user.email || null };
}

/* Verifies either credential against Firebase. */
export async function verificarCredencial(req, fbAuth) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token) return fbAuth.verifyIdToken(token, true);

  const cookie = sessionCookie(req);
  if (!cookie) return null;
  return fbAuth.verifySessionCookie(cookie, true);
}

/* The middleware. `fbAuth` comes in as a parameter so the API can be mounted
   without Firebase in tests. */
export function requireUser({ fbAuth, allowlist }) {
  return async (req, res, next) => {
    let user = null;
    try {
      user = await verificarCredencial(req, fbAuth);
    } catch (e) {
      /* Expired, revoked or badly signed token. Not a server error: you just
         have to identify yourself again. */
      return res.status(401).json({ error: { code: 'invalid_session', message: e.code || 'invalid' } });
    }
    const veredicto = decidirAcceso(user, allowlist);
    if (!veredicto.ok) {
      return res.status(veredicto.status).json({ error: { code: veredicto.code, message: 'not authorized' } });
    }
    req.user = { uid: veredicto.uid, email: veredicto.email };
    next();
  };
}
