# FASE 3 — ¿sirve el censo FMCSA como fuente de leads de DSP?

**Fecha:** 2026-08-03 · Investiga el **riesgo 5** de `RESEARCH.md` §7
("cobertura real de DSP en el censo FMCSA sin comprobar") · **Coste:** $0

---

## Veredicto corto

> **La fuente es buena. El filtro que suponíamos, no.**
>
> El censo es gratis, legal, consultable por API y cubre el universo de
> transportistas. Pero **sus campos no permiten identificar a un DSP de
> Amazon**. Filtrar por tamaño de flota y antigüedad reduce mucho el ruido y
> aun así lo que queda son empresas de riego, excavación y mecánica.

Esto **no** invalida la decisión de `RESEARCH.md` §8 de cambiar Google Maps
por el censo — Google Places sigue prohibiendo almacenar su contenido. Lo que
cambia es que **el enriquecimiento deja de ser un extra y pasa a ser la pieza
que hace el trabajo**.

---

## Lo bueno: no hay que descargar nada

El dataset está en Socrata y acepta filtros **en el servidor**:

```
https://data.transportation.gov/resource/az4n-8mr2.json
  ?$select=count(*)
  &$where=phy_state='NJ' AND status_code='A'
```

Importa en una VPS que ya toca swap: **el fichero completo nunca baja**. Se
piden conteos y páginas concretas. Descartado el miedo a un CSV de cientos de
megas.

⚠️ Detalle que cuesta media hora si no se sabe: **`power_units` es TEXTO** en
el dataset. Un `BETWEEN 10 AND 60` falla con `query.soql.type-mismatch`. Hay
que castear: `(power_units::number) between 10 and 60`.

## El embudo, medido en Nueva Jersey

| Filtro | Resultado |
|---|---|
| Todos los transportistas | 130.098 |
| Activos (`status_code='A'`) | 49.286 |
| Activos + alta desde 2018 | 30.337 |
| Activos + flota 10-60 | 2.486 |
| Activos + desde 2018 + flota 15-45 | **405** |

De 130.098 a 405 con tres condiciones. El embudo funciona.

## Lo malo: los 405 no son DSP

Muestra real del filtro más fino:

```
TBI UNLIMITED LLC              BRIDGETON     19
GREENWAY INDUSTRIES OF NJ LLC  FARMINGDALE   15
SEMOLA ENTERPRISES LLC         BERLIN        31
ULTRA FLOW IRRIGATION LLC      BARNEGAT      33
OVER THE EDGE EXCAVATING LLC   RIVERDALE     18
GE MECHANICAL LLC              VINELAND      24
```

Riego, excavación, mecánica. Son empresas con furgonetas, no empresas de
reparto. El censo **no tiene ningún campo que diga "DSP de Amazon"**, y el
tamaño de flota no distingue a quien reparte paquetes de quien lleva
herramienta a una obra.

## COMPROBADO: la hipótesis se confirma. El censo NO sirve

**2026-08-03, con tres DSP reales que el dueño conoce.** Este es el resultado que
cierra la pregunta:

| DSP | ¿Está en el censo? |
|---|---|
| **Una empresa conocida de ejemplo** | ❌ No aparece en la fuente |
| **Acme Logistics LLC** | ⚠️ Hay uno en Montclair, NJ (DOT 0000000) con **0 unidades** |
| **Example Logistics NYC** | ❌ No existe. Los "Example" son fuegos artificiales y energía |

**Dos de tres no están registrados.** Y el único que aparece declara cero
furgonetas, así que **el filtro de flota 15-45 lo habría descartado también**.
El embudo de 130.098 → 405 que parecía funcionar habría dejado fuera a los tres.

Queda confirmado el motivo que se sospechaba: las furgonetas de un DSP van por
debajo de las 10.001 lb y **no necesitan número USDOT**. El censo no los
infra-representa: no los contiene.

### Consecuencia

**El censo FMCSA queda descartado como fuente de leads de DSP.** No por legal
ni por coste —sigue siendo gratis y público— sino porque el nicho no está
dentro. Sirve para transportistas de camión; los DSP de última milla no son eso.

### Por dónde ir ahora (a decidir con el dueño)

La señal que sí distingue a un DSP de cualquier otra empresa con furgonetas es
**que contrata repartidores sin parar**. Un DSP vive de rotación de conductores
y publica ofertas de forma continua. Eso es observable y público.

| Vía | A favor | En contra |
|---|---|---|
| **Ofertas de empleo** (Indeed, ZipRecruiter: "Delivery Associate" + ciudad) | Señal específica del nicho, pública, y da nombre + ciudad + a veces teléfono | Hay que revisar ToS de cada portal antes de tocar nada |
| **Registro mercantil estatal** (NJ Division of Revenue, NY DOS) | Público, gratis, oficial | No marca el sector: mismo problema que el censo |
| **Amazon Logistics / directorio DSP** | La fuente auténtica | No es público |

Recomendación: explorar la vía de ofertas de empleo, **con revisión de ToS
antes de escribir una sola línea de scraper** — es el error que ya se evitó
con Google Places.

---

## La hipótesis original (así se formuló, antes de comprobarla)

⚠️ **No es un hecho verificado, es la explicación más probable y hay que
medirla:** un DSP opera Ford Transit y Sprinter, que suelen quedar **por
debajo de las 10.001 libras de peso bruto**. Ese es justo el umbral a partir
del cual hace falta número USDOT. Si la mayoría de los DSP no necesitan
registrarse, **el censo no los infra-representa por casualidad: no los
contiene**.

Comprobarlo es barato y es lo primero de la próxima sesión: coger 5 DSP
conocidos de la zona y buscar si tienen número USDOT. Si no lo tienen, la
fuente de leads hay que replantearla entera, y es mejor saberlo antes de
construir el importador que después.

## Qué hacer según el resultado

| Si los DSP conocidos… | Entonces |
|---|---|
| **sí** tienen USDOT | El censo vale como universo. El enriquecimiento web (Playwright efímero) es quien decide si cada candidato es DSP. Coste: una visita por candidato sobre ~400, no sobre 130.000 |
| **no** tienen USDOT | El censo no sirve para este nicho y hay que buscar otra fuente. Google Places sigue descartado por su política de almacenamiento |

**No se construye el esquema de leads hasta contestar esto.** Un `lead` con
campos pensados para el censo es trabajo tirado si la fuente cambia.

## Cómo reproducir

```bash
B=https://data.transportation.gov/resource/az4n-8mr2.json
curl -s -G "$B" --data-urlencode '$select=count(*)' \
  --data-urlencode "\$where=phy_state='NJ' AND status_code='A' AND (power_units::number) between 15 and 45"
```

---

# FUENTE NUEVA: dspjobhub.com (2026-08-03)

el dueño aporta la fuente que el censo no podía dar: **un portal de empleo
específico de DSP de Amazon**. Confirma la intuición de que la señal que
distingue a un DSP es que **contrata repartidores sin parar**.

Prueba de fuego superada: **Example Logistics NYC aparece ahí**, y es uno de
los tres que el censo FMCSA no contenía.

## Revisión legal — ANTES de escribir nada

| Comprobación | Resultado |
|---|---|
| `robots.txt` | `Allow: /` general. Bloquea `/jobs?*` (buscador con parámetros), `/admin`, `/login`, `/register`, `/recruitersearch` |
| Fichas `/job/...` | **NO bloqueadas** — es donde está el dato |
| Términos de servicio | **No existen**: `/terms`, `/terms-of-service`, `/privacy`, `/legal` devuelven 404 |

No hay ToS que prohíba nada, y `robots.txt` permite justo la ruta que interesa.
**Regla que se mantiene:** solo fichas `/job/...`, nunca `/jobs?...`, y a ritmo
humano. Si algún día publican términos, se releen antes de seguir.

## ⚠️ La trampa: el campo "correcto" miente

Las fichas traen **JSON-LD `JobPosting`** de schema.org, que es la mejor noticia
posible: datos estructurados, sin raspar HTML frágil. Pero:

```json
"hiringOrganization": {"@type":"Organization","name":"Amazon"}
"title": "Delivery Driver (Amazon DSP - Bronx) - Example Logistics NYC"
```

**`hiringOrganization.name` es "Amazon" en todas las ofertas.** El nombre del DSP
está solo en el `title`, detrás del último " - ". Fiarse del campo estructurado
—que es lo natural con JSON-LD— daría miles de leads llamados "Amazon" y un
dataset inservible.

**El nombre del DSP se extrae del `title`, no de `hiringOrganization`.**

## Campos aprovechables

| Campo | Ejemplo | Uso |
|---|---|---|
| `title` | `… - Example Logistics NYC` | **nombre del DSP** (tras el último " - ") |
| `jobLocation[].address.addressLocality` | `The Bronx, NY, United States` | ciudad y estado |
| `datePosted` | `2026-04-21` | recencia = señal de que sigue operando |
| `jobBenefits` | `$23.75 / hour` | tamaño/salud aproximada |
| `url` | ficha | procedencia, para poder reauditar |
| `description` | HTML | a veces trae web o redes de la empresa |

⚠️ `validThrough` viene con año **2126** — un siglo de más. No sirve para
caducar nada; usar `datePosted`.

## Lo que NO da, y cómo se completa

el dueño lo confirma y la ficha lo corrobora: **no hay teléfono ni Instagram** en
la página (`telephone` y `instagram` ausentes del HTML). El contacto es el
segundo paso:

- Muchos DSP tienen **Instagram** → búsqueda por nombre
- **Google Maps** los tiene, pero normalmente **sin teléfono directo**
- La `description` a veces incluye web o redes

Eso convierte el enriquecimiento en lo mismo que ya se había concluido: la
fuente da el **nombre + ciudad**, y el contacto se busca aparte.

## Siguiente paso concreto

1. Contar cuántas fichas hay para NJ/NY y cuántos DSP **distintos** salen tras
   deduplicar por nombre. Es el equivalente al conteo que se hizo con el censo,
   y decide si la fuente tiene volumen o son cuatro empresas repetidas.
2. Solo entonces, el esquema de `lead`.

---

## ⚠️ "Amazon DSP" es ambiguo — y contamina cualquier búsqueda

Descubierto el 2026-08-03 al mirar `theaccrueagency.com`, que puja en Google
Ads por la palabra clave exacta `amazon dsp services`.

**Son dos productos de Amazon sin ninguna relación:**

| Sigla | Qué es | Quién lo usa |
|---|---|---|
| **DSP = Delivery Service Partner** | Empresas de reparto de última milla | Nuestro nicho |
| **DSP = Demand-Side Platform** | Plataforma publicitaria programática de Amazon | Agencias de marketing y vendedores |

`theaccrueagency.com` es una agencia de marketing ("Full Service Amazon
Marketing Agency", 200+ marcas escaladas): vende lo segundo. Aparece de primera
si buscas "amazon dsp services" porque paga por esa keyword.

**Consecuencia para el pipeline de leads:** buscar "Amazon DSP" a secas trae
agencias de publicidad mezcladas con empresas de reparto, y la mezcla no se ve
hasta que alguien intenta llamar. Los términos deben desambiguar
(*delivery service partner*, *delivery associate*, *last mile*, *DSP owner*) y
excluir lo publicitario (*ads*, *demand-side*, *PPC*, *seller*, *agency*).

Esto **no** afecta a `dspjobhub.com`, que es específico de reparto por
construcción. Afecta a cualquier enriquecimiento por búsqueda web o Maps, que
es justo el paso que falta para conseguir los contactos.
