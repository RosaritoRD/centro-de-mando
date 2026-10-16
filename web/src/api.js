/* A request's credentials, in one place.

   This rule is borrowed from your main website, where its absence cost an expensive
   bug: three places built the header by hand and all three left out a
   credential, so photos came out grey without a single visible error. Here it
   starts centralized from the first commit.

   For now there's no header to set: the __session cookie travels on its own
   because its Domain is .your-domain.com and this is served from
   apm.your-domain.com. `credentials: 'same-origin'` is enough. When an MFA token
   or an X-Request-Id is needed, it gets added HERE. */

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
  try { body = await res.json(); } catch { /* responses without JSON */ }

  if (!res.ok) {
    const err = (body && body.error) || {};
    throw new ApiError(res.status, err.code, err.message);
  }
  return body;
}
