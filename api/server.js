/* Acme — APM · server.

   Phase 1: the skeleton. Health, identity and budget. The agent runtime
   (Claude Agent SDK), the SSE chat and approvals are Phase 2 and live in their
   own modules on purpose: a skeleton that starts, deploys and is reachable
   over HTTPS is what has to be verified before putting an agent inside it.

   Full contracts in docs/ARCHITECTURE.md §4. */

import express from 'express';
/* Modular imports and NOT `import admin from 'firebase-admin'`: in v14 the
   default export has no `.credential`, so the old style dies on startup with
   "Cannot read properties of undefined (reading 'cert')". */
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
   Same project as your main website: that's what makes the parent domain's __session
   cookie valid here. With incomplete credentials the process does NOT start:
   an auth API left without a verifier that keeps serving is worse than an
   outage, because nobody notices. */
const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  console.error('APM: Firebase credentials missing. Refusing to start without a way to verify sessions.');
  process.exit(1);
}
initializeApp({
  credential: cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    /* The \n arrive escaped from the .env, same as in your main website. */
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  })
});
const fbAuth = getAuth();

const allowlist = parseAllowlist(process.env.APM_ALLOWED_UIDS);
if (allowlist.size === 0) {
  /* Not fatal — the door stays shut, which is the safe failure — but it has to
     show up in the logs or someone will lose an afternoon wondering why their
     own dashboard returns 403. */
  console.warn('APM: APM_ALLOWED_UIDS is empty. Nobody will be able to sign in.');
}

const app = express();
app.disable('x-powered-by');
/* Behind NPM: without this, req.ip is the proxy's IP. */
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

const auth = requireUser({ fbAuth, allowlist });

/* ── Health ──────────────────────────────────────────────────────
   Unauthenticated: the container HEALTHCHECK and the host watchdog check it,
   and they have no cookie. It reveals nothing: if the DB is down it says so,
   which is exactly what an attacker would learn by trying anyway. */
app.get('/api/health', async (_req, res) => {
  const base = await dbOk();
  res.status(base.ok ? 200 : 503).json({
    ok: base.ok,
    db: base.ok ? 'up' : 'down',
    ...(base.ok ? {} : { detail: base.error }),
    version: VERSION
  });
});

/* ── Who am I ────────────────────────────────────────────────────
   The front end uses it to decide whether to render the dashboard or send you
   to sign-in. It returns the caps along with the identity so the shell can
   show them without a second request. */
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

/* ── Daily budget ────────────────────────────────────────────────
   It already exists in Phase 1 even though nothing spends yet, because the
   handbrake has to be on BEFORE the first agent comes in, not after the
   first scare. */
app.get('/api/budget', auth, async (_req, res) => {
  try {
    const limite = Number(process.env.DAILY_BUDGET_USD || 5);
    /* The day's row is created on the fly with the environment's limit.
       ON CONFLICT so a limit changed from the dashboard isn't overwritten. */
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
    res.status(500).json({ error: { code: 'db_error', message: 'could not read the budget' } });
  }
});

app.put('/api/budget', auth, async (req, res) => {
  const limite = Number(req.body && req.body.limitUsd);
  if (!Number.isFinite(limite) || limite < 0 || limite > 1000) {
    return res.status(400).json({ error: { code: 'bad_limit', message: 'limitUsd must be between 0 and 1000' } });
  }
  try {
    await db.query(
      `INSERT INTO budget_day (day, limit_usd) VALUES (CURRENT_DATE, $1)
       ON CONFLICT (day) DO UPDATE SET limit_usd = EXCLUDED.limit_usd, updated_at = now()`,
      [limite]);
    res.json({ ok: true, limitUsd: limite });
  } catch (e) {
    console.error('budget put:', e.message);
    res.status(500).json({ error: { code: 'db_error', message: 'could not save the budget' } });
  }
});

/* ── Models and prices ───────────────────────────────────────────
   Served from the table, not a constant: the Sonnet 5 promo ends on
   31-Aug-2026 and a price hard-coded here would start lying that day,
   silently. */
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
    res.status(500).json({ error: { code: 'db_error', message: 'could not read the prices' } });
  }
});

/* ── Location ────────────────────────────────────────────────────
   Where you query from and where leads are searched. They're two different
   places, hence two fields: you can live in one place and sell in another,
   which is exactly Acme's case.

   It's stored on the server, not in the browser: you sign in from your phone
   and from your desktop, and a location that only lives in localStorage means
   the agent searches somewhere different depending on the device you ask from. */
app.get('/api/location', auth, async (_req, res) => {
  try {
    const { rows } = await db.query("SELECT value FROM setting WHERE key = 'location'");
    const guardada = ubicacionEfectiva(null, rows[0]?.value || null);
    /* Cities already typed, for the dropdown. They come from real runs: typing
       "Newark" correctly once should be enough to never type it again, and a
       fixed city list would never get it right. */
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
    res.status(500).json({ error: { code: 'db_error', message: 'could not read the location' } });
  }
});

app.put('/api/location', auth, async (req, res) => {
  /* Normalized BEFORE saving: what goes into `setting` already has the shape
     it will be read in, and a misspelled country is dropped here, not three
     layers down inside the system prompt. */
  const u = normalizarUbicacion(req.body);
  try {
    await db.query(
      `INSERT INTO setting (key, value) VALUES ('location', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(u)]);
    res.json({ ...u, resumen: { base: comoTexto(u.base), target: comoTexto(u.target) } });
  } catch (e) {
    console.error('location put:', e.message);
    res.status(500).json({ error: { code: 'db_error', message: 'could not save the location' } });
  }
});

/* ── Agent runtime (Phase 2) ─────────────────────────────────────
   Runs, SSE stream and approvals. It has its own module because the agent
   loop and the approval gate have nothing to do with serving identity and
   budget. */
app.use(rutasRuns(auth));

/* ── Projects and health checks (Phase 5) ───────────────────────── */
app.use(rutasProyectos(auth));

/* ── n8n bridge (Phase 6) ────────────────────────────────────────
   Read-only: the n8n REST API doesn't run workflows. */
app.use(rutasN8n(auth));
/* Phase 3 — call prospecting. The Maps scraper is optional: without
   GMAPS_SCRAPER_URL that source fails with a clear error and NYC keeps working. */
app.use(rutasLeads(auth, {
  repo: crearRepoLeads({ db }),
  fuentes: {
    nyc: (p) => buscarNyc(p),
    gmaps: (p) => buscarGmaps(p, { base: process.env.GMAPS_SCRAPER_URL })
  }
}));

app.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'not found' } }));

app.listen(PORT, () => {
  console.log(`apm-api listening on :${PORT} (v${VERSION})`);
  arrancarVigilancia();
});
