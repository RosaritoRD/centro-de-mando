# SPIKE 01 — ¿sobrevive una aprobación diferida al reinicio del proceso?

**Fecha:** 2026-08-03 · **Riesgo nº1 del proyecto** (`RESEARCH.md` §7) · **Coste:** ~$0.15
**Código:** `spike/defer-survives/` — se puede volver a correr.

---

## Veredicto

> **SÍ sobrevive.** Un proceso difiere la herramienta, muere, y **otro proceso
> distinto** reanuda por `session_id`, aprueba, y **la herramienta se ejecuta de
> verdad**. La arquitectura de aprobaciones de `ARCHITECTURE.md` §2 se mantiene.

**Pero con una condición que no estaba en el diseño y que lo cambia:**

> ⚠️ **Las herramientas de APM NO pueden ser un `createSdkMcpServer` in-process
> si van a pasar por aprobación.** Al reanudar, los servidores MCP de tipo `sdk`
> **no se reconectan**, la herramienta desaparece del prompt, y la ejecución
> diferida **se pierde en silencio**.

---

## Qué se probó, exactamente

Dos procesos separados de verdad (`node a.mjs`, el proceso muere, `node b.mjs`),
no dos llamadas dentro del mismo. El efecto observable es un **archivo en disco**,
no lo que el modelo dice que hizo: si el modelo contesta "listo, registrado" y el
archivo está vacío, la respuesta es NO.

| Prueba | Herramienta | A difiere | B reanuda y aprueba | ¿Se ejecutó? |
|---|---|---|---|---|
| 1 | MCP in-process (`createSdkMcpServer`) | ✅ `tool_deferred` | reanuda | ❌ **No** |
| 2 | ídem + `alwaysLoad: true` | ✅ | reanuda | ❌ No |
| 3 | ídem + `forkSession: true` | ✅ | reanuda | ❌ No |
| 4 | ídem, prompt vacío vs `"Continúa."` | ✅ | reanuda | ❌ No en ninguno |
| **5** | **Integrada (`Write`)** | ✅ `tool_deferred` | reanuda | ✅ **Sí** |

La prueba 5 es la que zanja el asunto: **el mecanismo `defer`/`resume` funciona**.

---

## La causa, medida y no deducida

Mismo código, mismas opciones. La **única** diferencia es pasar `resume`:

| | `init.mcp_servers` | ¿ve la herramienta? |
|---|---|---|
| Proceso A (sesión nueva) | `[{"name":"spike","status":"connected"}]` | ✅ `mcp__spike__registrar_gasto` |
| Proceso B (`resume`) | `[]` | ❌ lista vacía |

La explicación está en los propios tipos del SDK:

```ts
/**
 * MCP SDK server config with an actual McpServer instance.
 * Not serializable - contains a live McpServer object.
 */
export declare type McpSdkServerConfigWithInstance = McpSdkServerConfig & {
    instance: McpServer;
};
```

Un servidor in-process es **un objeto vivo**. La sesión reanudada se reconstruye
desde disco y ahí no cabe un objeto vivo. Aunque se vuelva a pasar en `options`
—que es lo que hace el spike—, no se reconecta.

### Lo peor no es que falle: es CÓMO falla

La documentación promete que si la herramienta diferida ya no está disponible,
el proceso sale con `stop_reason: "tool_deferred_unavailable"` e `is_error: true`.

**No es lo que pasa.** Lo que llega es:

```
terminal_reason: completed
assistant: "Parece que no tengo acceso a esa herramienta específica..."
```

Un turno **exitoso**, sin error, en el que el agente se disculpa. Para APM eso
significa que una aprobación pulsada desde el móvil podría marcarse como
completada sin que la acción ocurra jamás. Es exactamente la clase de fallo que
este producto no se puede permitir: el usuario cree que aprobó un envío y el
envío no salió.

---

## Qué cambia en la arquitectura

1. **Las herramientas que pasan por aprobación no van in-process.** O son
   integradas, o van en un servidor MCP que se reconstruya desde configuración
   serializable (stdio o HTTP). Queda por medir cuál de los dos en la VPS —
   stdio cuesta un subproceso, HTTP exige TLS con CA según la doc del SDK.

2. **⚠️ Corrección al informe E.** Recomendaba el conector de correo como
   `createSdkMcpServer` in-process, y el argumento de seguridad sigue siendo
   bueno (los secretos no salen del proceso). Pero **enviar un correo es
   justamente lo que exige aprobación humana**, así que ese conector no puede
   ser in-process para la parte de envío. La lectura sí puede seguir siéndolo:
   nadie aprueba un `list_recent`.

3. **Nunca dar por buena una aprobación por `terminal_reason`.** APM debe
   verificar el **efecto**, no el estado del turno. Si la fila de `approval`
   dice `allow` pero la herramienta no dejó rastro, la ejecución es `failed`,
   no `done`.

---

## Lo que este spike NO probó

Honestidad sobre el borde: se probó **reinicio de proceso**, no **recreación de
contenedor**. La sesión vive en disco bajo `~/.claude/projects/…`, que en un
contenedor recreado desaparece.

Para el caso real de APM falta cablear un `sessionStore` (el SDK expone la
opción, más `InMemorySessionStore` de referencia e `importSessionToStore`) sobre
Postgres, o montar un volumen. **Es un problema más pequeño y ya acotado**: el
mecanismo funciona, solo falta dónde guardar el transcript.

Siguiente prueba, cuando toque: repetir la prueba 5 con `sessionStore` en
Postgres y los dos procesos en contenedores distintos.

---

## Cómo reproducirlo

```bash
cd /opt/centro-de-mando/spike/defer-survives
set -a && . /opt/centro-de-mando/.env && set +a

node c-builtin.mjs a     # difiere; el archivo NO existe
node c-builtin.mjs b      # proceso nuevo: reanuda, aprueba, el archivo aparece

node a-difiere.mjs        # el caso MCP in-process
node b2-aprueba-vacio.mjs # …que no se ejecuta, y dice por qué
```

Usa `claude-haiku-4-5` a propósito: el spike prueba fontanería, no inteligencia,
y lo paga el dueño.
