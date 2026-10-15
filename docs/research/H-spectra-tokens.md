# H — Sistema de diseño Spectra: tokens reales extraídos del código

> Extraídos de `/opt/tu web principal/css/styles.css` y `fonts.css` el 2026-08-02.
> **No son una interpretación de tu brief: son los valores que hoy están en
> producción en tu-dominio.com.** APM debe usarlos idénticos para que los dos
> productos se vean de la misma familia.

## H.1 Paleta — modo oscuro (base)

```css
:root {
  /* Superficies */
  --bg:          #05070C;   /* navy casi negro, fondo de página */
  --bg-soft:     #090C13;
  --panel:       #0D1119;   /* tarjetas */
  --panel-2:     #121724;   /* superficie elevada */
  --line:        rgba(244, 247, 251, 0.09);
  --line-strong: rgba(244, 247, 251, 0.16);

  /* Texto */
  --text:    #F4F7FB;
  --muted:   #97A1B4;
  --muted-2: #6B7385;

  /* Acentos */
  --blue:        #0C7BEB;   /* Azul de marca — del logo */
  --blue-bright: #3B9DFF;   /* acentos y glow sobre negro */
  --blue-deep:   #0A5FB8;
  --blue-ghost:  rgba(12, 123, 235, 0.12);

  /* Semánticos */
  --green: #2BD576;
  --amber: #F5B84D;
  --red:   #F16063;
}
```

## H.2 Paleta — modo claro

⚠️ **Corrección a tu brief.** Escribiste "toggle de modo claro", lo que sugiere que
el oscuro es el predeterminado. En el código es al revés: el comentario dice
literalmente *"Tema CLARO (predeterminado — el snippet del `<body>` lo aplica antes
del primer pintado; el oscuro se elige con el botón sol/luna)"*. Coincide con tu
memoria `gating-suscripcion` ("tema claro default").

**APM debe arrancar en claro también**, o los dos productos se sentirán distintos.

Selector: **`body[data-theme="light"]`** (no `:root`, no `prefers-color-scheme`).

```css
body[data-theme="light"] {
  --bg:          #F6F8FC;
  --bg-soft:     #EDF1F8;
  --panel:       #FFFFFF;
  --panel-2:     #F1F4FA;
  --line:        rgba(11, 18, 32, 0.10);
  --line-strong: rgba(11, 18, 32, 0.20);
  --text:        #0B1220;
  --muted:       #4B5568;
  --muted-2:     #6E7890;
  --blue-bright: #0C7BEB;   /* sobre blanco el azul del logo no necesita glow */
  --blue-ghost:  rgba(12, 123, 235, 0.09);
  --glow-blue:   0 0 30px rgba(12,123,235,.16), 0 0 80px rgba(12,123,235,.05);
  --shadow-card: 0 8px 26px rgba(15, 30, 60, 0.10);
}
```

## H.3 Radios, sombras, movimiento

```css
--radius-xs: 8px;   --radius-sm: 12px;  --radius-md: 16px;
--radius-lg: 22px;  --radius-xl: 30px;  --radius-full: 999px;

--glow-blue:   0 0 40px rgba(12,123,235,.35), 0 0 120px rgba(12,123,235,.12);
--shadow-card: 0 8px 32px rgba(0, 0, 0, 0.45);

--ease:  cubic-bezier(0.22, 1, 0.36, 1);
--dur-1: 150ms;  --dur-2: 260ms;  --dur-3: 550ms;
```

## H.4 Tipografía — **self-hosted, no Google Fonts**

```css
--font-display: "Sora", "Inter", system-ui, sans-serif;
--font-body:    "Inter", system-ui, sans-serif;
--font-mono:    "JetBrains Mono", ui-monospace, monospace;
```

Las tres son **variable fonts woff2 servidas desde tu propio dominio**
(`assets/fonts/sora-latin-var.woff2`, `inter-latin-var.woff2`,
`jetbrains-mono-latin-var.woff2`). Esto fue deliberado (memoria
`about-cases-fonts`: sin Google Fonts, CSP endurecida).

**Consecuencia para APM:** copiar los tres `.woff2` al proyecto y declararlos con
`@font-face` propio. Cualquier librería de UI que quiera meter Google Fonts vía
`<link>` **rompe la CSP** — es un criterio de descarte para el informe C.

## H.5 Restricciones heredadas que APM debe respetar

1. **CSP con hash único** (memoria `security-hardening`): el snippet inline
   que aplica el tema antes del primer pintado va firmado por hash. Si se edita el
   snippet, hay que recalcular el hash. APM necesita el mismo patrón anti-parpadeo.
2. **Sin JS externo de CDN.** Todo vendorizado. Otro criterio de descarte para
   librerías de UI que asuman CDN.
3. **Cache busting por contenido**: en `tu web principal` es `node tools/cachebust.js`.
   Si APM usa un bundler (Vite/Next), el hash de build lo resuelve solo — es un
   punto **a favor** de un stack con bundler, no en contra.
4. **Móvil primero de verdad**: trabajas desde el teléfono con Termius/navegador.
   El chat de agentes y las tablas de leads tienen que ser usables a 390 px.

## H.6 Fichero de marca

Existe `/opt/tu web principal/brand/BRAND_IDENTITY.md` — conviene leerlo íntegro antes de
la Fase 1 para no re-derivar decisiones de marca ya tomadas.
