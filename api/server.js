/* tu empresa — APM · servidor.

   Fase 1: el esqueleto. Salud, identidad y presupuesto. El runtime de agentes
   (Claude Agent SDK), el chat por SSE y las aprobaciones son la Fase 2, y no
   están aquí a propósito: un esqueleto que arranca, se despliega y se ve por
   HTTPS es lo que hay que verificar antes de meterle un agente dentro.

   Contratos completos en docs/ARCHITECTURE.md §4. */

import express from 'express';
/* Imports modulares y NO `import admin from 'firebase-admin'`: en la v14 el
   export por defecto no trae `.credential`, así que la forma antigua muere
   con "Cannot read properties of undefined (reading 'cert')" al arrancar. */
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { db, dbOk } from './db.js';
import { requireUser, parseAllowlist } from './auth.js';
import { rutasRuns } from './runs.js';
import { rutasProyectos, arrancarVigilancia } from './projects.js';
import { rutasN8n } from './n8n.js';
import { normalizarUbicacion, ubicacionEfectiva, comoTexto } from './location.js';
import { rutasLeads } from './leads.js';
import { crearRepoLeads } from './leads-repo.js';
import { buscarNyc } from './sources/nyc-open-data.js';
import { buscarGmaps } from './sources/google-maps.js';

const PORT = 3000;
const VERSION = '0.6.0';

/* ── Firebase ────────────────────────────────────────────────────
   Mismo proyecto que tu web principal: es lo que hace que la cookie __session del
   dominio padre valga aquí. Con credenciales incompletas el proceso NO
   arranca: una API de autenticación que se queda sin verificador y sigue
   sirviendo es peor que una caída, porque nadie se entera. */
const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  console.error('APM: faltan credenciales de Firebase. No arranco sin poder verificar sesiones.');
  process.exit(1);
}
initializeApp({
  credential: cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    /* Los \n llegan escapados desde el .env, igual que en tu web principal. */
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  })
});
const fbAuth = getAuth();

const allowlist = parseAllowlist(process.env.APM_ALLOWED_UIDS);
if (allowlist.size === 0) {
  /* No es fatal —la puerta queda cerrada, que es el fallo seguro— pero tiene
     que salir en los logs o alguien va a perder una tarde preguntándose por
     qué su propio panel le da 403. */
  console.warn('APM: APM_ALLOWED_UIDS está vacío. Nadie va a poder entrar.');
}

const app = express();
app.disable('x-powered-by');
/* Detrás de NPM: sin esto, req.ip es la IP del proxy. */
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

const auth = requireUser({ fbAuth, allowlist });

/* ── Salud ───────────────────────────────────────────────────────
   Sin autenticar: la comprueba el HEALTHCHECK del contenedor y el vigilante
   del host, que no tienen cookie. No revela nada: si la BD está caída dice
   que está caída, que es justo lo que un atacante ya sabría probando. */
app.get('/api/health', async (_req, res) => {
  const base = await dbOk();
  res.status(base.ok ? 200 : 503).json({
    ok: base.ok,
    db: base.ok ? 'up' : 'down',
    ...(base.ok ? {} : { detail: base.error }),
    version: VERSION
  });
});

/* ── Quién soy ───────────────────────────────────────────────────
   Es lo que usa el front para saber si pintar el panel o mandar a signin.
   Devuelve los topes junto a la identidad para que el shell pueda enseñarlos
   sin una segunda petición. */
app.get('/api/me', auth, (req, res) => {
  res.json({
    uid: req.user.uid,
    email: req.user.email,
    limits: {
      maxConcurrentRuns: Number(process.env.MAX_CONCURRENT_RUNS || 2),
      dailyBudgetUsd: Number(process.env.DAILY_BUDGET_USD || 5)
    }
  });
});

/* ── Presupuesto del día ─────────────────────────────────────────
   Existe ya en la Fase 1 aunque todavía no haya nada que gaste, porque el
   freno de mano tiene que estar puesto ANTES de que entre el primer agente,
   no después del primer susto. */
app.get('/api/budget', auth, async (_req, res) => {
  try {
    const limite = Number(process.env.DAILY_BUDGET_USD || 5);
    /* Se crea la fila del día al vuelo con el límite del entorno. ON CONFLICT
       para no pisar un límite que se haya cambiado desde el panel. */
    const { rows } = await db.query(
      `INSERT INTO budget_day (day, limit_usd)
            VALUES (CURRENT_DATE, $1)
       ON CONFLICT (day) DO UPDATE SET day = EXCLUDED.day
         RETURNING day, limit_usd, spent_usd`, [limite]);
    const r = rows[0];
    res.json({
      day: r.day,
      limitUsd: Number(r.limit_usd),
      spentUsd: Number(r.spent_usd),
      remainingUsd: Math.max(0, Number(r.limit_usd) - Number(r.spent_usd))
    });
  } catch (e) {
    console.error('budget:', e.message);
    res.status(500).json({ error: { code: 'db_error', message: 'no pude leer el presupuesto' } });
  }
});

app.put('/api/budget', auth, async (req, res) => {
  const limite = Number(req.body && req.body.limitUsd);
  if (!Number.isFinite(limite) || limite < 0 || limite > 1000) {
    return res.status(400).json({ error: { code: 'bad_limit', message: 'limitUsd entre 0 y 1000' } });
  }
  try {
    await db.query(
      `INSERT INTO budget_day (day, limit_usd) VALUES (CURRENT_DATE, $1)
       ON CONFLICT (day) DO UPDATE SET limit_usd = EXCLUDED.limit_usd, updated_at = now()`,
      [limite]);
    res.json({ ok: true, limitUsd: limite });
  } catch (e) {
    console.error('budget put:', e.message);
    res.status(500).json({ error: { code: 'db_error', message: 'no pude guardar el presupuesto' } });
  }
});

/* ── Modelos y precios ───────────────────────────────────────────
   Se sirven de la tabla y no de una constante: la promo de Sonnet 5 vence el
   31-ago-2026 y un precio en el código empezaría a mentir ese día en
   silencio. */
app.get('/api/models', auth, async (_req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT model, input_per_mtok, output_per_mtok, note FROM model_pricing ORDER BY input_per_mtok DESC');
    res.json(rows.map((r) => ({
      model: r.model,
      inputPerMTok: Number(r.input_per_mtok),
      outputPerMTok: Number(r.output_per_mtok),
      note: r.note
    })));
  } catch (e) {
    console.error('models:', e.message);
    res.status(500).json({ error: { code: 'db_error', message: 'no pude leer los precios' } });
  }
});

/* ── Ubicación ───────────────────────────────────────────────────
   Desde dónde se consulta y dónde se buscan los leads. Son dos sitios
   distintos y por eso son dos campos: se puede vivir en un lado y vender en
   otro, que es exactamente el caso de tu empresa.

   Se guarda en el servidor y no en el navegador: se entra desde el móvil y
   desde el escritorio, y una ubicación que solo existe en un localStorage
   significa que el agente busca en un sitio distinto según el aparato desde
   el que se le pregunte. */
app.get('/api/location', auth, async (_req, res) => {
  try {
    const { rows } = await db.query("SELECT value FROM setting WHERE key = 'location'");
    const guardada = ubicacionEfectiva(null, rows[0]?.value || null);
    /* Ciudades ya escritas, para el desplegable. Salen de las ejecuciones
       reales: escribir "Newark" bien una vez debería bastar para no volver a
       escribirlo, y una lista fija de ciudades no acertaría nunca. */
    const { rows: usadas } = await db.query(
      `SELECT DISTINCT ciudad FROM (
         SELECT base_city AS ciudad FROM run WHERE base_city IS NOT NULL
         UNION SELECT target_city FROM run WHERE target_city IS NOT NULL) t
       ORDER BY ciudad LIMIT 30`);
    res.json({
      ...guardada,
      resumen: { base: comoTexto(guardada.base), target: comoTexto(guardada.target) },
      ciudades: usadas.map((u) => u.ciudad)
    });
  } catch (e) {
    console.error('location get:', e.message);
    res.status(500).json({ error: { code: 'db_error', message: 'no pude leer la ubicación' } });
  }
});

app.put('/api/location', auth, async (req, res) => {
  /* Se normaliza ANTES de guardar: lo que entra en `setting` ya tiene la
     forma con la que se va a leer, y un país mal escrito se descarta aquí y
     no tres capas más abajo, dentro del system prompt. */
  const u = normalizarUbicacion(req.body);
  try {
    await db.query(
      `INSERT INTO setting (key, value) VALUES ('location', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(u)]);
    res.json({ ...u, resumen: { base: comoTexto(u.base), target: comoTexto(u.target) } });
  } catch (e) {
    console.error('location put:', e.message);
    res.status(500).json({ error: { code: 'db_error', message: 'no pude guardar la ubicación' } });
  }
});

/* ── Runtime de agentes (Fase 2) ─────────────────────────────────
   Ejecuciones, stream SSE y aprobaciones. Va en su propio módulo porque el
   bucle del agente y la puerta de aprobación no tienen nada que ver con
   servir identidad y presupuesto. */
app.use(rutasRuns(auth));

/* ── Proyectos y health checks (Fase 5) ─────────────────────────── */
app.use(rutasProyectos(auth));

/* ── Puente con n8n (Fase 6) ─────────────────────────────────────
   Solo lectura: la REST API de n8n no ejecuta workflows. */
app.use(rutasN8n(auth));
/* Fase 3 — prospección por llamadas. El scraper de Maps es opcional: sin
   GMAPS_SCRAPER_URL esa fuente falla con un error claro y NYC sigue funcionando. */
app.use(rutasLeads(auth, {
  repo: crearRepoLeads({ db }),
  fuentes: {
    nyc: (p) => buscarNyc(p),
    gmaps: (p) => buscarGmaps(p, { base: process.env.GMAPS_SCRAPER_URL })
  }
}));

app.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'no existe' } }));

app.listen(PORT, () => {
  console.log(`apm-api escuchando en :${PORT} (v${VERSION})`);
  arrancarVigilancia();
});
