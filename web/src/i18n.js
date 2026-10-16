/* Interface language: English keys, Spanish catalogue.

   The source strings in the components are English and double as keys; the
   Spanish lives in ES below. With no saved choice, a Spanish browser gets
   Spanish and everything else gets English. The choice is saved in
   localStorage and switching reloads the page: every screen re-renders from
   scratch, so nothing is left half-translated.

   `{name}` placeholders are filled in AFTER translating, so values (titles,
   names, amounts) never pass through the catalogue. Data coming from the API
   (chat text, lead names, error messages) is shown as-is. */

const CLAVE = 'apm-lang';

function idiomaInicial() {
  try {
    const guardado = localStorage.getItem(CLAVE);
    if (guardado === 'es' || guardado === 'en') return guardado;
  } catch { /* no storage: fall back to the browser */ }
  return /^es\b/i.test(navigator.language || '') ? 'es' : 'en';
}

export const LANG = typeof window === 'undefined' ? 'en' : idiomaInicial();
/* For toLocaleString / Intl: dates, numbers and country names. */
export const LOCALE = LANG === 'es' ? 'es' : 'en-US';

export function setLang(lang) {
  try { localStorage.setItem(CLAVE, lang); } catch { /* still switch for this load */ }
  window.location.reload();
}

const ES = {
  // ── Shell ──
  'Overview': 'Resumen',
  "What's running and what needs your attention.": 'Lo que está en marcha y lo que necesita tu atención.',
  'Assistant': 'Asistente',
  'Delegate a task and follow every step your agents take.': 'Delega una tarea y sigue cada paso de tus agentes.',
  'Approvals': 'Aprobaciones',
  'Review the actions waiting for your decision.': 'Revisa las acciones que esperan tu decisión.',
  'Prospecting': 'Prospección',
  'Find contacts, prepare calls and log results.': 'Encuentra contactos, prepara llamadas y registra resultados.',
  'Projects': 'Proyectos',
  'Check that your sites and services are up.': 'Comprueba la disponibilidad de tus sitios y servicios.',
  'Automations': 'Automatizaciones',
  'Watch your workflows and catch interruptions.': 'Supervisa tus flujos y detecta interrupciones.',
  'Inbox': 'Bandeja de entrada',
  'All your conversations in one place.': 'Tus conversaciones, en un solo lugar.',
  'Could not connect to APM. Try again in a moment.': 'No se pudo conectar con APM. Vuelve a intentarlo en unos momentos.',
  'Retry': 'Reintentar',
  'Your session is not active or has expired.': 'Tu sesión no está activa o caducó.',
  'Sign in': 'Identificarme',
  'Your account is valid, but it is not authorized for the command center. APM belongs to a single person.': 'Tu cuenta es válida, pero no está autorizada para el centro de mando. APM es de una sola persona.',
  'Done': 'Completada', 'Failed': 'Con error', 'Running': 'En curso', 'Queued': 'En cola',
  'Awaiting approval': 'Espera aprobación', 'Interrupted': 'Interrumpida',
  'Next action': 'Siguiente acción', 'YOUR NEXT STEP': 'TU SIGUIENTE PASO',
  'Get your projects going': 'Pon tus proyectos en marcha',
  '{n} action is waiting for your approval': '{n} acción espera tu aprobación',
  '{n} actions are waiting for your approval': '{n} acciones esperan tu aprobación',
  'All set for your next task': 'Todo listo para tu próxima tarea',
  'Your agents need a decision to continue.': 'Tus agentes necesitan una decisión para continuar.',
  'Open the assistant to delegate, or carry on with your prospecting.': 'Abre el asistente para delegar o continúa con tu prospección.',
  'Review approvals': 'Revisar aprobaciones', 'Open assistant': 'Abrir asistente',
  "Today's budget": 'Presupuesto de hoy', 'Budget used': 'Presupuesto utilizado',
  '{left} available · {pct}% used': '{left} disponibles · {pct}% utilizado',
  'Loading budget…': 'Cargando presupuesto…', 'Budget unavailable': 'Presupuesto no disponible',
  'Agents working': 'Agentes trabajando', 'Active runs / concurrency limit': 'Ejecuciones activas / límite simultáneo',
  'System status': 'Estado del sistema', 'Operational': 'Operativo', 'Needs attention': 'Requiere atención',
  'Checking…': 'Comprobando…', 'No data': 'Sin datos', 'Database connected': 'Base de datos conectada',
  'Check the database connection': 'Revisar conexión con la base de datos', 'Querying services': 'Consultando servicios',
  'Could not check the status': 'No se pudo comprobar el estado',
  'Work shortcuts': 'Accesos de trabajo', 'Pick up where you left off': 'Continúa donde lo dejaste',
  'Prepare calls': 'Preparar llamadas', 'Contacts, scripts and follow-up': 'Contactos, guiones y seguimiento',
  'Review projects': 'Revisar proyectos', 'Availability of your services': 'Disponibilidad de tus servicios',
  'View automations': 'Ver automatizaciones', 'Active workflows and latest executions': 'Flujos activos y últimas ejecuciones',
  'Recent activity': 'Actividad reciente', 'View conversations': 'Ver conversaciones', 'Loading activity…': 'Cargando actividad…',
  'Could not load the activity.': 'No se pudo cargar la actividad.', 'Press Refresh to try again.': 'Pulsa Actualizar para volver a intentarlo.',
  'Your first task starts in the assistant.': 'Tu primera tarea empieza en el asistente.',
  'Ask it to check a project or help you prepare a call.': 'Pídele que revise un proyecto o te ayude a preparar una llamada.',
  'Start a conversation': 'Crear una conversación',
  'Loading…': 'Cargando…', 'Skip to content': 'Saltar al contenido', 'Command center': 'Centro de mando',
  'WORKSPACE': 'ESPACIO DE TRABAJO', 'Main navigation': 'Navegación principal', 'Soon': 'Pronto',
  'Personal workspace': 'Espacio personal', 'Refresh everything': 'Actualizar todo',
  'Switch to light theme': 'Cambiar a tema claro', 'Switch to dark theme': 'Cambiar a tema oscuro',
  'Light theme': 'Tema claro', 'Dark theme': 'Tema oscuro', 'Language': 'Idioma',
  'YOUR OPERATION AT A GLANCE': 'TU OPERACIÓN, DE UN VISTAZO', 'COMMAND CENTER': 'CENTRO DE MANDO',
  'Updating…': 'Actualizando…', 'Partial update': 'Actualización incompleta', 'Updated {time}': 'Actualizado {time}',
  'Waiting for data': 'Esperando datos', 'Some data could not be loaded.': 'No se pudieron cargar algunos datos.',
  'The inbox will be available soon.': 'La bandeja de entrada estará disponible próximamente.',
  'In the meantime, you can see your conversations with your agents in the assistant.': 'Mientras tanto, puedes consultar las conversaciones con tus agentes en el asistente.',
};

/* Optional extra catalogues registered by each screen, so the strings live
   next to the component that uses them. */
export function registrar(entradas) { Object.assign(ES, entradas); }

export function t(clave, vars) {
  let s = LANG === 'es' && Object.hasOwn(ES, clave) ? ES[clave] : clave;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

/* Singular/plural pick: tn(n, '{n} item', '{n} items'). */
export function tn(n, uno, varios, vars = {}) {
  return t(n === 1 ? uno : varios, { n, ...vars });
}
