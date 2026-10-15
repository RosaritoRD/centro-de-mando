# SPIKE 02 — ¿sobrevive una aprobación diferida a la recreación del contenedor?

**Fecha:** 2026-08-03 · Cierra el hueco que dejó abierto `SPIKE-01-defer.md` · **Coste:** ~$0.35
**Código:** `spike/session-store-pg/` · **Se corre con:** `./tools/spike-02.sh`

---

## Veredicto

> **SÍ.** Con un `SessionStore` sobre Postgres, un contenedor difiere la
> herramienta y **otro contenedor distinto, con el disco limpio**, reanuda por
> `session_id`, aprueba, y **la herramienta se ejecuta de verdad**.

Con esto el riesgo nº1 del proyecto (`RESEARCH.md` §7) queda cerrado del todo:
SPIKE 01 probó que sobrevive a la muerte del **proceso**; este prueba que
sobrevive a la muerte del **contenedor**, que es lo que pasa en cada
`docker compose up -d --build`.

```
Contenedor 1 (fase A)   difiere el Write   → archivo NO existe · 14 entradas en Postgres
                        [contenedor destruido]
Contenedor 2 (fase B)   disco sin transcript ✓ · reanuda desde Postgres · aprueba
                        → archivo existe · "gasto 12.50 cafe"
```

---

## Por qué la prueba vale

Dos cosas que la hacen honesta, y que costaron más que el resto:

1. **Son contenedores de verdad distintos.** Cada fase es un `docker run --rm`
   independiente. El `~/.claude/` del primero no existe para el segundo.
2. **La fase B se niega a correr si encuentra el transcript en disco.** Sin ese
   guardián, la prueba pasaría igual reanudando desde el archivo local y no
   probaría nada sobre Postgres. Es la lección de SPIKE 01: el veredicto es el
   **efecto observable** (un archivo con el contenido correcto), nunca lo que
   diga el modelo ni el `terminal_reason`.

Se usa la herramienta **integrada `Write`**, no un MCP in-process, porque
SPIKE 01 ya demostró que un servidor `sdk` no se reconecta al reanudar.

---

## La trampa que encontró: el `projectKey` sale del `cwd`

El SDK no expone opción para fijar el `projectKey`: lo **deriva del `cwd`
saneado**. Si el `WORKDIR` del contenedor cambia entre despliegues, la clave
cambia, `load()` no encuentra nada y la sesión no reanuda.

Probado a propósito — misma sesión, `cwd` distinto:

```
Error: Claude Code returned an error result:
No conversation found with session ID: 0c84131b-…
```

**La buena noticia es cómo falla: ruidosamente**, con excepción y salida 1. Es
lo contrario del fallo del MCP in-process, que terminaba `completed` sin error
mientras el agente se disculpaba. Este APM lo puede detectar y reportar.

**Consecuencia para APM:** el `WORKDIR` del contenedor de agentes pasa a ser
parte del contrato de datos, no una decisión de empaquetado. Cambiarlo
invalida todas las aprobaciones pendientes.

---

## Una sospecha que resultó falsa

Se escribió el spike con `sessionStoreFlush: 'eager'` suponiendo que el
defecto `'batched'` dejaría el último lote sin escribir al morir el proceso
justo en el defer.

**Es falso, y está medido:** el ciclo completo pasa igual con `'batched'`. Un
defer emite un mensaje `result`, y el SDK vacía el buffer del mirror en cada
`result` — el defer **ya es** un punto de flush. Se deja el defecto; `'eager'`
cuesta un `append()` por frame sin comprar nada. `SPIKE_FLUSH` reproduce ambos.

---

## Lo que hay que respetar al implementar el adaptador

Del contrato del SDK (`sdk.d.ts`), no de la intuición:

| Regla | Por qué |
|---|---|
| `uuid` es clave de **idempotencia** | El SDK reintenta `append()` 3 veces y `importSessionToStore()` reproduce entradas. Sin `ON CONFLICT DO NOTHING` el transcript se duplica y la sesión reanudada ve el turno dos veces |
| Hay entradas **sin `uuid`** | Títulos, tags, marcadores de modo. El contrato manda añadirlas sin deduplicar → el índice único es **parcial** (`WHERE entry_uuid IS NOT NULL`) |
| El orden **es** el dato | `load()` debe devolver lo mismo en el mismo orden. Por eso la PK es `BIGSERIAL` y no UUID: un UUID aleatorio no ordena |
| `entry` es un **blob opaco** | El SDK documenta su forma como interna de la CLI; lo único garantizado es el round-trip `JSON.stringify`/`parse`. JSONB puede reordenar claves y da igual: el SDK nunca compara bytes |
| `delete()` es **opcional** | Su ausencia es un no-op válido para backends append-only. Encaja con la política del proyecto: a `apm_app` no se le concede DELETE |
| `listSubkeys()` no es opcional *de facto* | Sin él, al reanudar solo se materializa el transcript principal y **se pierden los de los subagentes** |

También: `sessionStore` **no se puede usar con `persistSession: false`**. El
mirror se dispara después del write local, así que el SDK sigue escribiendo en
disco. Postgres es la copia que sobrevive, no un reemplazo.

---

## Qué queda de la Fase 2

El cimiento está. Falta lo de encima: Agent SDK en el backend, orquestador +
1 subagente real, UI de chat con streaming, registro de coste por ejecución y
la aprobación humana cableada con `canUseTool` + hooks.

Sigue vigente la regla que salió de SPIKE 01: **nunca dar una aprobación por
buena por el `terminal_reason`.** APM verifica el efecto. Si la fila de
`approval` dice `allow` pero la herramienta no dejó rastro, la ejecución es
`failed`, no `done`.

---

## Cómo reproducirlo

```bash
cd /opt/centro-de-mando
docker exec -i n8n_postgres psql -U n8n -d apm < db/migrations/002_session_store.sql
./tools/spike-02.sh
```

Modelo `claude-haiku-4-5` a propósito: esto prueba fontanería, no
inteligencia.
