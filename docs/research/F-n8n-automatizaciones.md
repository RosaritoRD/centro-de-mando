# Categoría F — Automatizaciones y puente con n8n

**Investigado:** 2026-08-02
**Contexto:** APM correrá en `apm.tu-dominio.com` (Claude Agent SDK), detrás de Nginx Proxy Manager (NPM),
con n8n auto-hospedado en Docker (6 workflows en producción) y Postgres propio compartido con n8n.

Todo lo marcado ✅ está verificado contra fuente primaria (docs.n8n.io, API de GitHub, repos).
Lo marcado ⚠️ NO VERIFICADO no debe darse por cierto sin comprobarlo en la VPS.

---

## 1. Resumen ejecutivo (las 3 decisiones)

| Decisión | Recomendación | Por qué en una línea |
|---|---|---|
| ¿Cómo dispara APM a n8n? | **Webhooks de n8n** (disparo) + **REST API** (lectura/monitoreo) | La REST API **no tiene endpoint para ejecutar workflows** — el webhook es la única vía real de disparo. |
| ¿MCP Server Trigger? | **No para el puente principal.** Opcional en fase 2 | Añade SSE, buffering, sesiones largas y un fallo más detrás de NPM, a cambio de nada que webhook+API no den. |
| ¿Scheduler? | **pg-boss** dentro de APM | Postgres que ya tienes, sin Redis nuevo, cron nativo, mantenimiento excelente (release 2026-08-01). |

---

## 2. Tabla comparativa de opciones de integración

| Opción | Dirección | Transporte | Auth | ¿Dispara? | ¿Monitorea? | Riesgo con NPM | Veredicto |
|---|---|---|---|---|---|---|---|
| **Webhook de n8n** | APM → n8n | HTTP POST normal | Basic / Header / JWT ✅ | ✅ Sí | Parcial (respuesta síncrona) | **Ninguno** | ✅ **Elegido para disparar** |
| **REST API pública** (`/api/v1`) | APM → n8n | HTTP normal | `X-N8N-API-KEY` ✅ | ❌ **No existe endpoint run/execute** | ✅ Completo (executions) | **Ninguno** | ✅ **Elegido para monitorear** |
| **MCP Server Trigger** | APM → n8n | SSE / Streamable HTTP | Bearer / Header ✅ | ✅ Sí (como "tool") | ❌ No da historial | **ALTO** (buffering) | ⚠️ Fase 2, opcional |
| **MCP Client Tool** | n8n → APM | SSE | Bearer/Header/OAuth2 ✅ | Dirección **contraria** | — | Medio | ❌ No sirve para este caso |
| **czlonkowski/n8n-mcp** | Claude → n8n (autoría) | stdio / HTTP | `N8N_API_KEY` | Sí (crea/edita workflows) | Sí | Bajo | ⚠️ Solo para **construir** workflows, nunca apuntado a producción |
| **Schedule Trigger de n8n** | n8n → APM | HTTP normal | La del webhook de APM | ✅ | ❌ | Ninguno | ⚠️ Solo tareas ya "de n8n" |

---

## 3. Hallazgo crítico: la REST API de n8n NO ejecuta workflows

✅ **VERIFICADO** — `https://docs.n8n.io/connect/n8n-api/workflow`

Endpoints reales del recurso Workflow:

```
GET    /api/v1/workflows
POST   /api/v1/workflows
GET    /api/v1/workflows/{id}
PUT    /api/v1/workflows/{id}
DELETE /api/v1/workflows/{id}
GET    /api/v1/workflows/{id}/history
GET    /api/v1/workflows/{id}/{versionId}
POST   /api/v1/workflows/{id}/activate     # DEPRECADO
POST   /api/v1/workflows/{id}/deactivate   # DEPRECADO
POST   /api/v1/workflows/{id}/publish      # actual
POST   /api/v1/workflows/{id}/unpublish    # actual
```

**No existe** `POST /workflows/{id}/run` ni `/execute`. Esto es lo que fuerza la arquitectura:
**para disparar hay que usar un webhook.** No hay alternativa vía API.

⚠️ Ojo con `activate`/`deactivate`: están **deprecados** a favor de `publish`/`unpublish`.
Si copias código de un tutorial de 2025 usará los viejos. Verifica cuál acepta tu versión de n8n antes de cablearlo.

### Recurso Execution (esto SÍ nos da el monitoreo completo)

✅ **VERIFICADO** — `https://docs.n8n.io/connect/n8n-api/execution`

```
GET    /api/v1/executions
GET    /api/v1/executions/{id}
DELETE /api/v1/executions/{id}
POST   /api/v1/executions/{id}/retry
POST   /api/v1/executions/{id}/stop
POST   /api/v1/executions/stop
GET    /api/v1/executions/{id}/tags
PUT    /api/v1/executions/{id}/tags
```

Query params de `GET /api/v1/executions` (todos verificados):

| Param | Tipo | Nota |
|---|---|---|
| `includeData` | boolean | Incluye los datos detallados de la ejecución |
| `redactExecutionData` | boolean | Redacta la salida |
| `status` | string | `canceled`, `crashed`, `error`, `new`, `running`, `success`, `unknown`, `waiting` |
| `workflowId` | string | Filtra por workflow |
| `projectId` | string | Filtra por proyecto |
| `limit` | number | Default **100**, máximo **250** |
| `cursor` | string | Paginación: usa el `nextCursor` de la respuesta anterior |
| `ignoreDataSizeLimit` | boolean | Devuelve datos que exceden el límite de tamaño |

`POST /executions/{id}/retry` es una joya para APM: si un scrape diario falla, APM puede reintentarlo
sin reconstruir el payload.

### Autenticación

✅ **VERIFICADO** — `https://docs.n8n.io/connect/n8n-api/authentication`

- Header: **`X-N8N-API-KEY`** (textual: *"Send the API key in your API call as a header named `X-N8N-API-KEY`"*)
- Base URL self-hosted: **`https://<your-instance-url>/api/v1`**
- Se crea en **Settings → n8n API → Create an API key**, con **etiqueta y fecha de expiración**
- ⚠️ **Los scopes son solo Enterprise.** En un self-hosted normal **la API key tiene acceso total a la cuenta.**
  Trátala como credencial de root: va en el `.env` de APM, nunca en git, nunca en el navegador.
- ⚠️ **Pon recordatorio de la expiración.** Elegiste una fecha al crearla; el día que expire, APM deja de
  ver ejecuciones en silencio. Es exactamente el tipo de fallo que cuesta 3 horas encontrar.

⚠️ **NO VERIFICADO / a comprobar en tu VPS:** la doc dice *"The n8n API isn't available during the free trial"*.
Eso aplica a n8n Cloud. En self-hosted (tu caso) la API pública está disponible, pero **confírmalo**
entrando a Settings → n8n API antes de diseñar sobre ella.

---

## 4. Webhooks de n8n como mecanismo de disparo

✅ **VERIFICADO** — nodo Webhook, docs.n8n.io

Formato de URL:

```
Producción:  https://<tu-n8n>/webhook/<path>
Test:        https://<tu-n8n>/webhook-test/<path>
```

- La URL de producción se registra **al publicar el workflow**; la de test solo dura **120 segundos**
  tras pulsar "Listen for Test Event".
- La URL de producción se construye con la variable de entorno `WEBHOOK_URL`; la de test con
  `N8N_EDITOR_BASE_URL`. Si tu n8n está detrás de NPM y las URLs salen con `localhost:5678`,
  es porque falta `WEBHOOK_URL` en el docker-compose.

**Autenticación del nodo Webhook** (✅ verificado): `Basic auth`, `Header auth`, `JWT auth`, `None`.
→ Usa **Header auth** con un secreto largo por workflow. Nunca dejes `None` en un webhook accesible desde internet.

**Modos de respuesta** (✅ verificado): `Immediately` (devuelve "Workflow got started"),
`When Last Node Finishes`, `Using 'Respond to Webhook' Node`, y **`Streaming response`**.

Patrón recomendado para APM:

```
APM  --POST--> https://n8n.tu-dominio.com/webhook/apm-<tarea>
                Header: X-APM-Secret: <secreto por workflow>
                Body:   { runId, tenantId, params }
     <--202--   respuesta Immediately (no bloquees al agente)

APM  --GET-->  /api/v1/executions?workflowId=<id>&status=running|success|error
                Header: X-N8N-API-KEY: <key>
```

Es decir: **dispara por webhook, monitorea por API, correlaciona por `workflowId` + tu propio `runId`**.

⚠️ **Gotcha de correlación:** el webhook **no devuelve el `executionId`** en modo `Immediately`.
Dos salidas: (a) usar modo `Using 'Respond to Webhook' Node` y devolver `{{ $execution.id }}` explícitamente,
o (b) que el workflow haga un callback a APM al terminar. La opción (b) es más robusta y además te evita
hacer polling. ⚠️ NO VERIFICADO que `$execution.id` esté disponible en tu versión — pruébalo antes de depender de ello.

---

## 5. MCP Server Trigger de n8n

✅ **VERIFICADO** — `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger/`

- Expone workflows de n8n como **herramientas MCP**. Las herramientas se enganchan al trigger mediante
  el nodo **Custom n8n Workflow Tool**.
- **Transportes:** SSE y **Streamable HTTP**. La doc **no marca SSE como deprecado**; dice explícitamente
  que *"currently doesn't support standard input/output (stdio) transport"*.
  ⚠️ En el ecosistema MCP general SSE sí está en retirada a favor de Streamable HTTP, pero **eso no está
  escrito en la doc de n8n**. No lo afirmes como hecho.
- **Auth:** Bearer auth o Header auth.
- **URLs:** genera una de test y una de producción. El campo **Path** trae por defecto
  *"a randomly generated MCP URL path, to avoid conflicts with other MCP Server Trigger nodes"*, y es editable.
- ⚠️ **NO VERIFICADO al 100%:** el prefijo exacto. Las fuentes secundarias coinciden en `/mcp/<path>`
  (producción) y `/mcp-test/<path>` (test), y la propia doc de n8n usa `location /mcp/` en su ejemplo de nginx,
  lo que lo respalda fuertemente. Pero **la doc no publica la plantilla literal**.
  → **Léela del panel del nodo**, no la construyas a mano.

### MCP Client Tool — dirección contraria

✅ **VERIFICADO** — nodo `toolmcp`. Sirve para que **n8n consuma MCPs externos**, no para exponer n8n.
Soporta Bearer, header genérico, múltiples headers, OAuth2 y sin auth.

**¿Nos sirve?** Para el puente APM→n8n, **no**. Pero tiene un uso futuro real: si algún día APM expone
sus propias herramientas como MCP, los workflows de n8n podrían consumirlas con este nodo.
Es la pieza del puente inverso, no de este.

---

## 6. ⭐ Configuración NPM/nginx para SSE — LISTA PARA PEGAR

Este es el gotcha que ya sufriste. La causa raíz: **nginx bufferiza la respuesta por defecto**.
Con SSE el servidor nunca "termina" la respuesta, así que nginx se queda acumulando bytes que jamás
envía, y el cliente ve un *cuelgue* o un timeout — sin ningún error en los logs.

### 6.1 Fuente primaria: la propia doc de n8n

✅ **VERIFICADO — bloque textual de docs.n8n.io** (nodo MCP Server Trigger):

> *"When running n8n behind a reverse proxy like nginx, you may experience problems if the MCP endpoint
> isn't configured for SSE or streamable HTTP."*

```nginx
location /mcp/ {
    proxy_http_version          1.1;
    proxy_buffering             off;
    gzip                        off;
    chunked_transfer_encoding   off;

    proxy_set_header            Connection '';

    # The rest of your proxy headers and settings
    # . . .
}
```

### 6.2 Bloque para el **Advanced tab de Nginx Proxy Manager** — n8n MCP

NPM no te deja editar el `location` raíz, pero el **Advanced tab** del Proxy Host acepta bloques
`location` completos que se inyectan dentro del `server {}`. Pega esto tal cual en el Proxy Host
de tu n8n (p. ej. `n8n.tu-dominio.com`), pestaña **Advanced**:

```nginx
# ── n8n MCP / SSE ── Proxy Host: n8n.tu-dominio.com → Advanced tab ──
# Solo afecta a las rutas MCP. El resto del sitio sigue con el proxy normal de NPM.

location ^~ /mcp/ {
    # OJO: ajusta al nombre/puerto real de tu contenedor n8n en la red de Docker.
    proxy_pass http://n8n:5678;

    # HTTP/1.1 obligatorio: con 1.0 nginx cierra la conexión tras cada respuesta
    # y el stream SSE muere al primer evento.
    proxy_http_version 1.1;

    # LA directiva clave. Sin esto nginx acumula el stream en memoria y no
    # reenvía nada: el cliente ve un cuelgue silencioso, sin error en logs.
    proxy_buffering off;

    # No cachear un stream dinámico (nginx podría servir una respuesta muerta).
    proxy_cache off;

    # gzip sobre SSE retrasa los eventos hasta llenar el buffer de compresión.
    gzip off;

    # SSE ya trae su propio framing (event:/data:). Dejar que nginx aplique
    # el suyo encima rompe el parseo en el cliente.
    chunked_transfer_encoding off;

    # Vaciar Connection: evita heredar 'close' (o 'upgrade' de un bloque
    # WebSocket vecino) de otra parte de la config. NO es proxying WebSocket.
    proxy_set_header Connection '';

    # Timeouts largos: el default de nginx (60s) mata la sesión MCP a mitad.
    proxy_read_timeout  86400s;
    proxy_send_timeout  86400s;

    # Cinturón y tirantes: si algún día un proxy intermedio o un NPM actualizado
    # reintroduce buffering, esta cabecera de respuesta lo desactiva igual.
    proxy_set_header X-Accel-Buffering no;

    # Cabeceras estándar (NPM las pone en su bloque, no en el tuyo: repítelas).
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Mismo tratamiento para el endpoint de test (dura 120s, pero si no lo
# configuras vas a creer que tu MCP está roto cuando solo lo está el test).
location ^~ /mcp-test/ {
    proxy_pass http://n8n:5678;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    chunked_transfer_encoding off;
    proxy_set_header Connection '';
    proxy_read_timeout  86400s;
    proxy_send_timeout  86400s;
    proxy_set_header X-Accel-Buffering no;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**Notas de uso en NPM:**

- `^~` hace que este `location` gane sobre los prefijos genéricos de NPM. Sin él, el bloque
  de NPM puede capturar la ruta primero y tu config no se aplica nunca. Este es el error nº1.
- ⚠️ **No actives el toggle "Websockets Support"** de NPM para esto. SSE **no** es WebSocket:
  ese toggle inyecta `Connection: upgrade`, justo lo contrario de `Connection: ''`.
- ⚠️ **`proxy_pass` con el nombre del contenedor** solo funciona si NPM y n8n comparten red Docker.
  Si no, usa la IP del host y el puerto publicado. **Verifícalo con `docker network inspect` antes de pegar.**
- Tras guardar, NPM recarga solo. Si el Proxy Host se pone en rojo, hay un error de sintaxis:
  revisa con `docker logs <contenedor-npm>`.
- ⚠️ **Con varias réplicas de n8n**, todas las peticiones `/mcp*` deben ir **a la misma réplica**
  (la sesión MCP tiene estado). Tú tienes una sola instancia, así que no aplica hoy — pero anótalo.

**Cómo comprobar que funciona** (el test que no miente):

```bash
curl -N -i https://n8n.tu-dominio.com/mcp/<tu-path> \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <token>"
```

`-N` desactiva el buffering **de curl**, para no confundir un fallo tuyo con uno de nginx.
Si ves eventos llegando poco a poco → bien. Si se queda mudo y luego corta → sigue habiendo buffering.

⚠️ **Síntoma verificado que despista mucho:** si recibes
`Error: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`, **no es buffering**.
Es que falta el header `Accept: application/json, text/event-stream` en la petición.
n8n rechaza peticiones MCP que no acepten ambos tipos y devuelve HTML.

### 6.3 El mismo problema en NUESTRO endpoint SSE de APM

`apm.tu-dominio.com` va a hacer streaming del chat del agente. **Sufre exactamente lo mismo.**
Bloque para el Advanced tab del Proxy Host de APM:

```nginx
# ── APM streaming del chat ── Proxy Host: apm.tu-dominio.com → Advanced tab ──
location ^~ /api/chat/stream {
    proxy_pass http://centro-de-mando:3000;   # ajusta contenedor:puerto

    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    chunked_transfer_encoding off;
    proxy_set_header Connection '';

    # Una conversación larga con el Agent SDK puede pensar minutos entre tokens.
    # 3600s es un punto medio sensato; 86400s si vas a tener sesiones muy largas.
    proxy_read_timeout  3600s;
    proxy_send_timeout  3600s;

    proxy_set_header X-Accel-Buffering no;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

✅ **La defensa más robusta va en el código de APM, no en nginx.** Emite estas cabeceras **de respuesta**
desde el propio endpoint. `X-Accel-Buffering: no` es una cabecera que nginx honra específicamente,
y así el streaming sigue funcionando aunque alguien toque la config de NPM en el futuro:

```js
res.writeHead(200, {
  'Content-Type':      'text/event-stream',
  'Cache-Control':     'no-cache, no-transform', // no-transform frena a proxies intermedios
  'Connection':        'keep-alive',
  'X-Accel-Buffering': 'no',                     // nginx: no bufferices esta respuesta
});
```

Truco extra: manda un comentario SSE de keepalive (`res.write(': ping\n\n')`) cada ~25 s.
Mantiene viva la conexión frente a timeouts intermedios y detecta clientes muertos.

---

## 7. czlonkowski/n8n-mcp — verificación

✅ **VERIFICADO** (API de GitHub + README, 2026-08-02)

| Dato | Valor |
|---|---|
| Repo | `czlonkowski/n8n-mcp` |
| Estrellas | **22.470** |
| Licencia | **MIT** |
| Último push | **2026-07-30** (activo) |
| Archivado | No |

**Qué hace:** servidor MCP que le da a Claude conocimiento estructurado de los nodos de n8n
(~2.285 nodos, 828 core + 1.457 community, y ~2.352 plantillas) para que **construya y valide workflows**.
Son 7 herramientas de documentación/validación + **16 herramientas de gestión opt-in** que requieren
`N8N_API_URL` y `N8N_API_KEY`: CRUD de workflows, ejecuciones, credenciales, data tables y auditoría de seguridad.

**¿Es seguro apuntarlo a PRODUCCIÓN?** ✅ El propio README responde, en mayúsculas:

> *"NEVER edit your production workflows directly with AI!"* — y añade que hay que copiar el workflow,
> probar en desarrollo y validar antes de desplegar, porque *"AI results can be unpredictable. Protect your work!"*

**Recomendación concreta para ti:**

- **Sí úsalo** en tu portátil/sesión de Claude Code para **escribir** workflows nuevos. Es excelente en eso.
- **No** lo conectes a `n8n.tu-dominio.com` con una API key de escritura. Tienes 6 workflows en producción
  (incluida la content factory) y una API key sin scopes = acceso total.
- Si aun así lo conectas, usa **`DISABLED_TOOLS`** para apagar las operaciones de escritura (verificado que existe).
- Las herramientas de gestión **están desactivadas por defecto** si no configuras las env vars — o sea,
  el modo seguro es el default. Bien diseñado.
- ⚠️ **NO VERIFICADO:** el README dice "current support: n8n 2.31.6+". Comprueba tu versión (`docker exec ... n8n --version`)
  antes de asumir compatibilidad.

---

## 8. Lo mejor valorado en GitHub (búsqueda abierta)

Búsqueda vía GitHub Search API ordenada por estrellas, con fecha de último push. Datos del **2026-08-02**.

### 8.1 n8n + MCP / agentes

| # | Repo | ★ | Licencia | Último push | ¿Aporta algo sobre usar la REST API de n8n? |
|---|---|---|---|---|---|
| 1 | `n8n-io/n8n` | **199.048** | Other (fair-code) | 2026-08-02 | Fuente de verdad. ⚠️ **No es OSI-open**: licencia "Sustainable Use" |
| 2 | `czlonkowski/n8n-mcp` | **22.470** | MIT | 2026-07-30 | Sí — envuelve la API en 16 tools opt-in. Referencia de cómo NO exponerla |
| 3 | `nerding-io/n8n-nodes-mcp` | 3.028 | MIT | **2026-01-02** ⚠️ | Nodo community pre-oficial. **7 meses sin push** — obsoleto: n8n ya trae MCP nativo |
| 4 | `leonardsellem/n8n-mcp-server` | 1.633 | MIT | **2025-07-09** ⚠️ | *"MCP server for interacting with n8n API"*. **13 meses sin push: descartado** |
| 5 | `bytechefhq/bytechef` | 937 | Other | 2026-07-31 | Competidor de n8n, no integración. Informativo |
| 6 | `freddy-schuetz/n8n-claw` | 542 | **Ninguna** ⚠️ | 2026-07-31 | Agente autónomo en n8n. **Sin licencia = no reutilizable legalmente** |
| 7 | `makafeli/n8n-workflow-builder` | 532 | MIT | 2026-03-19 | Solapa con n8n-mcp, menos mantenido |
| 8 | `CoreWorxLab/CAAL` | 432 | MIT | 2026-05-25 | **Interesante como patrón:** autodescubre workflows de n8n y los expone como tools MCP |
| 9 | `salacoste/mcp-n8n-workflow-builder` | 230 | MIT | 2026-04-12 | Otro clon de menor tracción |

**Conclusión de esta búsqueda:** hay **un solo ganador claro** (`czlonkowski/n8n-mcp`, 22k★ y activo)
y una larga cola de proyectos abandonados. Nada de esto es un cliente de la REST API que merezca adoptarse.

### 8.2 Clientes de la REST API de n8n en TypeScript

Búsqueda `n8n api client typescript` ordenada por estrellas — el resultado es **demoledor**:
el repo mejor valorado tiene **10 estrellas** (`yoanhuke/laravel-n8n`, PHP), y el único cliente
TypeScript (`egose/n8n-toolkit`, Apache-2.0) tiene **1 estrella**.

✅ **Conclusión con dato duro: no existe cliente de la API de n8n que valga la pena.**
→ **Usa `fetch` nativo.** La API son ~15 endpoints REST con un header. Una dependencia de 1 estrella
para eso es puro riesgo de supply chain. Escribe 80 líneas propias y tienes control total.

### 8.3 Schedulers / colas de trabajos para Node

| # | Repo | ★ | Licencia | Último push | Último release | Issues abiertas |
|---|---|---|---|---|---|---|
| 1 | `taskforcesh/bullmq` | **9.232** | MIT | 2026-08-02 | **v6.0.5 (2026-08-01)** | **378** |
| 2 | `timgit/pg-boss` | **3.818** | MIT | 2026-08-01 | **12.26.4 (2026-08-01)** | **25** |
| 3 | `graphile/worker` | 2.351 | MIT | 2026-07-08 | — | 43 |
| 4 | `sidequestjs/sidequest` | 1.009 | **LGPL-3.0** ⚠️ | 2026-07-22 | — | — |

⚠️ **Sobre LGPL-3.0 en `sidequest`:** para un SaaS servido por red la LGPL es manejable, pero introduce
obligaciones de relinking que MIT no tiene. **Descartado por licencia, no por calidad.**

**Los tres primeros están vivos y son MIT.** No hay ganador por abandono: hay que decidir por arquitectura.

⚠️ **NO VERIFICADO — dato que debes comprobar tú:** la descripción del repo de BullMQ en GitHub dice
literalmente *"based on Redis **or PostgreSQL**"*, y la v6 introdujo "pluggable queue backends".
**Pero la página de novedades de bullmq.io sigue describiéndolo como "Redis-backed" y no confirma
un backend Postgres.** No des por hecho que BullMQ funciona sobre Postgres sin verificarlo en su doc oficial.
Si resultara maduro, cambiaría el análisis de abajo.

---

## 9. Recomendación: MCP Server Trigger vs REST API + webhooks

### 🏆 **REST API + webhooks. Sin dudarlo, para la v1.**

**Pros de REST API + webhooks:**

- ✅ HTTP normal: **cero problemas con NPM.** No hay SSE, no hay buffering, no hay timeouts largos.
- ✅ El monitoreo es *mejor*: `GET /executions` da estado, historial, datos y errores.
  MCP no expone historial de ejecuciones **en absoluto**.
- ✅ `POST /executions/{id}/retry` y `/stop` dan control operativo real.
- ✅ Depurable con `curl`. Cuando falle a las 2 AM, lo arreglas.
- ✅ Sin sesiones con estado: si APM se reinicia a mitad, no se pierde nada.
- ✅ La auth es un header. Ya sabes gestionar eso.

**Contras:**

- ❌ Dos mecanismos en vez de uno (webhook para disparar, API para leer).
- ❌ Necesitas polling o callback para saber cuándo terminó. Es un poco de código.
- ❌ Un webhook nuevo por cada tarea nueva (aunque puedes hacer uno genérico con router).

**Pros de MCP Server Trigger:**

- ✅ Claude *descubre* las tools solo. Elegante para casos abiertos donde no sabes de antemano qué llamará.
- ✅ Una sola integración conceptual.

**Contras (los que pesan):**

- ❌ **Exige SSE/streaming detrás de NPM — el fallo que ya sufriste.** Y no solo una vez: cada
  actualización de NPM puede reintroducirlo.
- ❌ **No da historial de ejecuciones.** Necesitarías la REST API igualmente → no ahorras nada.
- ❌ Sesiones con estado: reinicios de APM, de n8n o de NPM las rompen.
- ❌ Superficie de fallo más grande para depurar (SSE + auth + sesión + buffering).
- ❌ ⚠️ El prefijo exacto de la URL ni siquiera está publicado en la doc.

**El argumento decisivo:** MCP **no elimina** la REST API — la necesitas igual para monitorear.
Así que MCP no es "una opción en vez de la otra", es **una capa extra encima de la que igual vas a construir**,
y la capa extra es precisamente la que rompe detrás de tu proxy.

**Cuándo reconsiderarlo (fase 2):** cuando tengas 20+ workflows y quieras que el agente elija
dinámicamente cuál usar sin que tú lo cablees. Entonces MCP gana de verdad. Con 6 workflows, no.

---

## 10. Recomendación de scheduler: pg-boss

### 🏆 **pg-boss dentro de APM.**

**Los datos duros primero** (no opinión):

| Criterio | pg-boss | BullMQ | graphile-worker | Schedule Trigger n8n |
|---|---|---|---|---|
| Estrellas | 3.818 | **9.232** | 2.351 | (parte de n8n) |
| Licencia | **MIT** ✅ | **MIT** ✅ | **MIT** ✅ | Fair-code ⚠️ |
| Último release | **2026-08-01** ✅ | **2026-08-01** ✅ | 2026-07-08 | — |
| Issues abiertas | **25** ✅ | 378 | 43 | — |
| Infra nueva | **Ninguna** ✅ | Redis | Ninguna | Ninguna |
| Cron recurrente | ✅ nativo | ✅ repeatable jobs | ✅ | ✅ |
| Transaccional con tus datos | ✅ **mismo Postgres** | ❌ | ✅ | ❌ |

**Por qué pg-boss y no BullMQ, pese a que BullMQ tiene 2,4× estrellas:**

1. **Atomicidad transaccional.** Este es el argumento real. APM guarda estado en Postgres.
   Con pg-boss puedes hacer `INSERT` de tu dato **y** encolar el job **en la misma transacción**.
   Si el commit falla, no queda un job huérfano apuntando a una fila inexistente.
   Con BullMQ + Redis eso es imposible: son dos sistemas, y tendrás bugs de "el job existe pero el dato no".
   Con 6 workflows y scrapes diarios, ese bug **va a pasar**.
2. **Ya tienes Redis, sí — pero es de otro.** Tu Redis en `/opt/redis` sirve a otras cosas.
   Meterle la cola de APM acopla dos sistemas: un `FLUSHALL` o un reinicio de mantenimiento
   se lleva por delante tus jobs programados. Postgres ya lo tratas como dato sagrado (tienes backups
   cifrados en cron a R2, verificados). **Los jobs de APM merecen ese nivel de cuidado; el cache no lo tiene.**
3. **Durabilidad.** Redis por defecto no es durable. Postgres sí, y ya está respaldado.
4. **Señal de mantenimiento a favor de pg-boss:** 25 issues abiertas frente a 378 de BullMQ.
   Con un ratio issues/estrellas de 0,7% vs 4,1%, pg-boss está claramente mejor atendido en proporción.
   Ambos publicaron release el 2026-08-01, así que la actividad es empatada; la diferencia es la deuda.
5. **Menos piezas.** Un servicio menos que monitorear, respaldar y reiniciar en tu VPS.

**Cuándo BullMQ sería mejor:** decenas de miles de jobs por minuto, o necesidad de flows/hijos
complejos. No es tu caso ni de lejos: hablamos de scrapes diarios y reportes semanales.

**graphile-worker:** técnicamente excelente y también Postgres-native. Pierde contra pg-boss por
tracción (2.351 vs 3.818 ★) y por API menos orientada a scheduling declarativo. Es la segunda opción válida.

### ¿Y programar dentro de n8n con Schedule Trigger?

**Recomendación: híbrida, con una regla clara de quién manda.**

| El trabajo es... | Prográmalo en | Por qué |
|---|---|---|
| Un workflow de n8n de principio a fin (scrape → transformar → guardar) | **n8n (Schedule Trigger)** | No metas a APM de intermediario sin razón. Menos saltos, menos fallos |
| Lógica del agente (razonar, resumir, decidir, llamar al Agent SDK) | **APM (pg-boss)** | Reintentos, estado y logs en tu dominio, no en la UI de n8n |
| Mixto: n8n recolecta y el agente razona | **APM (pg-boss)** dispara el webhook de n8n | Quien orquesta debe ser quien tiene el estado |

**La regla:** *el que necesita saber si funcionó, es el que programa.*
Si APM debe reaccionar al resultado, APM programa. Si es fire-and-forget de datos, n8n programa.

⚠️ **Un aviso sobre poner todo en n8n:** perderías el historial en la base de datos de APM y dependerías
de la retención de ejecuciones de n8n (que se purga). Para reportes semanales que quieras auditar meses
después, **pg-boss + tu propia tabla** es la opción defendible.

---

## 11. Arquitectura recomendada (resumen visual)

```
                        ┌──────────────────────────────┐
   Navegador ──SSE──────│  apm.tu-dominio.com  (APM)      │
   (chat streaming)     │  Claude Agent SDK            │
   ▲ necesita §6.3      │  pg-boss (Postgres propio)   │
                        └───────┬──────────────▲───────┘
                                │              │
             POST /webhook/… ───┘              └─── GET /api/v1/executions
             Header auth                            X-N8N-API-KEY
                                │              │
                        ┌───────▼──────────────┴───────┐
                        │  n8n.tu-dominio.com             │
                        │  6 workflows + content factory│
                        └──────────────────────────────┘
                     (ambos detrás de Nginx Proxy Manager)
```

**Solo el enlace navegador↔APM necesita la config anti-buffering.** Los dos enlaces APM↔n8n son
HTTP normal. Esa es exactamente la razón de elegir REST+webhooks sobre MCP.

---

## 12. Plan de implementación

1. Crear API key en n8n (Settings → n8n API). **Anotar la fecha de expiración en el calendario.**
2. Guardar `N8N_API_URL=https://n8n.tu-dominio.com/api/v1` y `N8N_API_KEY` en el `.env` de APM. **Nunca en git.**
   ⚠️ Recuerda que el `.env` ya se filtró una vez a git (01/08/2026) — verifica el `.gitignore` antes.
3. Escribir un cliente propio con `fetch` (~80 líneas): `listWorkflows()`, `getExecutions()`,
   `getExecution(id)`, `retryExecution(id)`. **Sin dependencias** (§8.2).
4. Añadir un nodo Webhook con **Header auth** a cada workflow que APM deba disparar.
5. Pegar el bloque de §6.3 en el Advanced tab de `apm.tu-dominio.com` **y** emitir `X-Accel-Buffering: no`
   desde el código. Probar con `curl -N`.
6. Instalar pg-boss apuntando al Postgres existente, **en su propio schema** (`pgboss`) para no mezclar
   con las tablas de n8n ni con las tuyas.
7. Migrar los recurrentes según la tabla de §10.
8. (Opcional, más adelante) Evaluar MCP Server Trigger con el bloque de §6.2 ya probado.

---

## ⚠️ Correcciones

Errores y suposiciones falsas detectadas durante esta investigación. Léelo antes que nada:

1. **"La REST API de n8n puede ejecutar workflows"** — ❌ **FALSO.** No existe `POST /workflows/{id}/run`
   ni equivalente. **Verificado** contra la referencia oficial del recurso Workflow. El disparo **solo**
   es posible por webhook (o Schedule/otro trigger). Esta suposición, muy extendida en blogs, habría
   invalidado el diseño entero. **Es el hallazgo más importante de este documento.**

2. **"SSE está deprecado en el MCP Server Trigger de n8n"** — ⚠️ **NO VERIFICADO.** La doc de n8n lista
   SSE y Streamable HTTP **sin marcar ninguno como deprecado**. Lo único que dice explícitamente es que
   *no* soporta stdio. La deprecación de SSE es una tendencia del ecosistema MCP general, **no un hecho
   documentado por n8n**. No lo repitas como cierto.

3. **"Activar 'Websockets Support' en NPM arregla SSE"** — ❌ **FALSO y contraproducente.** Ese toggle
   inyecta `Connection: upgrade`, mientras que SSE requiere `Connection: ''` (vaciarlo). Son mecanismos
   distintos. Activarlo empeora el problema.

4. **"Con `proxy_buffering off` ya está resuelto"** — ⚠️ **INCOMPLETO.** Hacen falta al menos cinco
   directivas más: `proxy_http_version 1.1`, `proxy_set_header Connection ''`, `gzip off`,
   `chunked_transfer_encoding off` y timeouts largos. Los timeouts por defecto (60 s) matan la conexión
   igual aunque el buffering esté desactivado — y el síntoma es idéntico, lo que despista muchísimo.

5. **`Unexpected token '<', "<!DOCTYPE "...` NO es un problema de buffering** — es que falta el header
   `Accept: application/json, text/event-stream`. Perseguir la config de nginx por este error es una
   pérdida de horas garantizada.

6. **"BullMQ ya soporta PostgreSQL"** — ⚠️ **NO VERIFICADO / CONTRADICTORIO.** La descripción del repo en
   GitHub dice *"based on Redis or PostgreSQL"*, pero la página oficial de novedades de bullmq.io lo sigue
   describiendo como Redis-backed y **no confirma** ese backend. Comprobar en su documentación antes de
   apoyar ninguna decisión en ello.

7. **"Más estrellas = mejor elección"** — ❌ BullMQ tiene 2,4× las estrellas de pg-boss y aun así **no** es
   la recomendación. El criterio decisivo es la atomicidad transaccional con el Postgres que APM ya usa,
   no la popularidad. (Nota de honestidad: la ratio de issues abiertas también favorece a pg-boss,
   pero un proyecto más grande naturalmente acumula más issues — no lo interpretes como abandono de BullMQ,
   que publicó release el mismo día.)

8. **`POST /workflows/{id}/activate` está DEPRECADO** — usa `publish`/`unpublish`. Casi todos los tutoriales
   de 2025 usan los viejos. ⚠️ Verifica cuáles acepta tu versión antes de cablearlos.

9. **La API key de n8n self-hosted NO tiene scopes** — los scopes son solo Enterprise. Tu key tendrá
   **acceso total**. De ahí la recomendación de no apuntar herramientas de IA con escritura a producción.

10. **⚠️ NO VERIFICADO — el prefijo `/mcp/` y `/mcp-test/`.** Fuentes secundarias coinciden y el ejemplo
    de nginx de la propia n8n usa `location /mcp/`, pero **la doc no publica la plantilla literal de la URL**.
    Léela del panel del nodo. No la construyas a mano.

11. **⚠️ NO VERIFICADO — `proxy_pass http://n8n:5678`.** Solo funciona si NPM y n8n comparten red Docker.
    Comprueba con `docker network inspect` y ajusta antes de pegar el bloque.

12. **La licencia de n8n no es open source OSI** — la API de GitHub la reporta como "Other"
    (Sustainable Use License). Irrelevante para uso interno, pero **relevante si algún día revendes
    la automatización como parte del producto a tus DSP.** Tenlo presente dado tu plan de SaaS multi-tenant.

---

## Fuentes

- [MCP Server Trigger — n8n Docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger) (bloque nginx oficial)
- [MCP Client Tool — n8n Docs](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/)
- [n8n API — Docs](https://docs.n8n.io/connect/n8n-api) · [Authentication](https://docs.n8n.io/connect/n8n-api/authentication) · [Endpoint reference](https://docs.n8n.io/connect/n8n-api/api-reference) · [Execution](https://docs.n8n.io/connect/n8n-api/execution) · [Workflow](https://docs.n8n.io/connect/n8n-api/workflow)
- [Webhook node — n8n Docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook)
- [Configuring Nginx for n8n MCP Servers with Claude Code — blog.thalheim.io](https://blog.thalheim.io/2025/11/12/configuring-nginx-for-n8n-mcp-servers-with-claude-code/)
- [Expose MCP in Nginx Proxy Manager — techstuff.leighonline.net](https://techstuff.leighonline.net/2026/05/16/expose-mcp-in-nginx-proxy-manager/)
- [Surviving SSE Behind Nginx Proxy Manager — Medium](https://medium.com/@dsherwin/surviving-sse-behind-nginx-proxy-manager-npm-a-real-world-deep-dive-69c5a6e8b8e5)
- [czlonkowski/n8n-mcp](https://github.com/czlonkowski/n8n-mcp) · [timgit/pg-boss](https://github.com/timgit/pg-boss) · [taskforcesh/bullmq](https://github.com/taskforcesh/bullmq) · [graphile/worker](https://github.com/graphile/worker)
- [BullMQ News](https://bullmq.io/news/)
- Datos de estrellas/licencia/push: GitHub Search & Repos API, consultada 2026-08-02
