/* APM belongs to one person. This file is what guarantees it.

   The interesting part isn't "the allowed UID gets in" — that's the easy bit —
   but the two ways of failing open:

   1. The empty allowlist. If APM_ALLOWED_UIDS didn't load (a typo in the .env,
      an env_file that wasn't mounted, a half-finished deploy), `allowlist.has()`
      on an empty Set returns false and it looks like we're safe... but only if
      someone remembered to check that case. Had we written "no allowlist, don't
      filter" instead — the convenient way to make it work locally — the command
      center would be open to any your-domain.com account without a single error
      in the logs.

   2. Mixing up 401 and 403. It's not cosmetic: 401 sends you to the sign-in
      screen, and returning 401 to someone who DOES have a session but isn't on
      the list sends them to a login they'll pass, only to bounce again. A loop —
      exactly the trap that already cost a bug in the dashboard.

   Run:  node --test auth.test.js  */

import test from 'node:test';
import assert from 'node:assert/strict';
import { decidirAcceso, parseAllowlist, sessionCookie } from './auth.js';

const DUENO = 'lx7jnsBAPNPnwDIrFfbf73em2GJ2';
const OTRO = 'eUUhymJcDiOfeoeRC4mxCeixCy53';

test('the listed UID gets in', () => {
  const r = decidirAcceso({ uid: DUENO, email: 'e@x.com' }, parseAllowlist(DUENO));
  assert.equal(r.ok, true);
  assert.equal(r.uid, DUENO);
});

test('a valid account that is not on the list gets 403, not 401', () => {
  const r = decidirAcceso({ uid: OTRO }, parseAllowlist(DUENO));
  assert.equal(r.ok, false);
  assert.equal(r.status, 403, "403 = I know who you are and you're not the one; 401 would send them to a login they'd pass");
  assert.equal(r.code, 'not_allowed');
});

test('no session is 401, so the screen sends you to sign in', () => {
  const r = decidirAcceso(null, parseAllowlist(DUENO));
  assert.equal(r.status, 401);
  assert.equal(r.code, 'no_session');
});

test('an empty allowlist shuts the door, it does not open it', () => {
  /* The case that matters: the variable didn't load. Nobody gets in, not even
     the owner. Better that the owner can't get in and says so than that anyone
     gets in and nobody says a thing. */
  for (const raw of ['', undefined, null, '   ', ',,,']) {
    const r = decidirAcceso({ uid: DUENO }, parseAllowlist(raw));
    assert.equal(r.ok, false, `with APM_ALLOWED_UIDS=${JSON.stringify(raw)} nobody may get in`);
    assert.equal(r.code, 'allowlist_empty');
  }
});

test('the allowlist tolerates extra spaces and commas', () => {
  const lista = parseAllowlist(` ${DUENO} , , ${OTRO} `);
  assert.equal(lista.size, 2);
  assert.ok(lista.has(DUENO) && lista.has(OTRO));
});

test('a user without a uid does not pass even if the object exists', () => {
  /* A verifyIdToken that returns something odd can't sneak in just by being
     shaped like an object. */
  for (const u of [{}, { uid: '' }, { email: 'x@y.com' }]) {
    assert.equal(decidirAcceso(u, parseAllowlist(DUENO)).ok, false);
  }
});

test('the __session cookie is read among other cookies', () => {
  const req = { headers: { cookie: 'foo=1; __session=abc%20def; bar=2' } };
  assert.equal(sessionCookie(req), 'abc def');
});

test('no cookie returns an empty string, it does not crash', () => {
  assert.equal(sessionCookie({ headers: {} }), '');
  assert.equal(sessionCookie({ headers: { cookie: 'other=1' } }), '');
});
