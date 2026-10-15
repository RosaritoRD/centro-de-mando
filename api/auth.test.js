/* APM es de una persona. Este archivo es el que lo garantiza.

   La parte interesante no es "el UID permitido entra" —eso es lo fácil— sino
   los dos modos de fallar en abierto:

   1. La allowlist vacía. Si APM_ALLOWED_UIDS no se cargó (typo en el .env, el
      env_file que no se montó, un despliegue a medias), un `allowlist.has()`
      sobre un Set vacío devuelve false y parecería que estamos a salvo... pero
      solo si alguien se acordó de comprobar el caso. Si en su lugar hubiéramos
      escrito "si no hay allowlist, no filtres" —que es la forma cómoda de que
      funcione en local— el centro de mando quedaría abierto a cualquier cuenta
      de tu-dominio.com sin un solo error en los logs.

   2. Confundir 401 con 403. No es cosmético: 401 manda a la pantalla de
      identificarse, y si se devuelve 401 a alguien que SÍ tiene sesión pero no
      está en la lista, lo mandamos a un login que va a superar, para volver a
      rebotar. Un bucle, que es justo la trampa que ya costó un bug en el panel.

   Correr:  node --test auth.test.js  */

import test from 'node:test';
import assert from 'node:assert/strict';
import { decidirAcceso, parseAllowlist, sessionCookie } from './auth.js';

const DUENO = 'lx7jnsBAPNPnwDIrFfbf73em2GJ2';
const OTRO = 'eUUhymJcDiOfeoeRC4mxCeixCy53';

test('el UID de la lista entra', () => {
  const r = decidirAcceso({ uid: DUENO, email: 'e@x.com' }, parseAllowlist(DUENO));
  assert.equal(r.ok, true);
  assert.equal(r.uid, DUENO);
});

test('una cuenta válida que no está en la lista recibe 403, no 401', () => {
  const r = decidirAcceso({ uid: OTRO }, parseAllowlist(DUENO));
  assert.equal(r.ok, false);
  assert.equal(r.status, 403, '403 = sé quién eres y no eres tú; 401 lo mandaría a un login que va a superar');
  assert.equal(r.code, 'not_allowed');
});

test('sin sesión es 401, para que la pantalla mande a identificarse', () => {
  const r = decidirAcceso(null, parseAllowlist(DUENO));
  assert.equal(r.status, 401);
  assert.equal(r.code, 'no_session');
});

test('allowlist vacía cierra la puerta, no la abre', () => {
  /* El caso que importa: la variable no se cargó. Nadie entra, ni siquiera
     el dueño. Prefiero que el dueño no pueda entrar y lo diga a que entre
     cualquiera y no lo diga nadie. */
  for (const raw of ['', undefined, null, '   ', ',,,']) {
    const r = decidirAcceso({ uid: DUENO }, parseAllowlist(raw));
    assert.equal(r.ok, false, `con APM_ALLOWED_UIDS=${JSON.stringify(raw)} no puede entrar nadie`);
    assert.equal(r.code, 'allowlist_empty');
  }
});

test('la allowlist tolera espacios y comas de más', () => {
  const lista = parseAllowlist(` ${DUENO} , , ${OTRO} `);
  assert.equal(lista.size, 2);
  assert.ok(lista.has(DUENO) && lista.has(OTRO));
});

test('un usuario sin uid no pasa aunque el objeto exista', () => {
  /* Un verifyIdToken que devuelve algo raro no puede colarse por tener forma
     de objeto. */
  for (const u of [{}, { uid: '' }, { email: 'x@y.com' }]) {
    assert.equal(decidirAcceso(u, parseAllowlist(DUENO)).ok, false);
  }
});

test('la cookie __session se lee entre otras cookies', () => {
  const req = { headers: { cookie: 'foo=1; __session=abc%20def; bar=2' } };
  assert.equal(sessionCookie(req), 'abc def');
});

test('sin cookie devuelve cadena vacía, no revienta', () => {
  assert.equal(sessionCookie({ headers: {} }), '');
  assert.equal(sessionCookie({ headers: { cookie: 'otra=1' } }), '');
});
