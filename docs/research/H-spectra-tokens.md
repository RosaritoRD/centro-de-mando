# H — Spectra design system: real tokens extracted from the code

> Extracted from the main website's `css/styles.css` and `fonts.css` on 2026-08-02.
> **They are not an interpretation of the brief: they are the values in
> production today.** APM must use them unchanged so both products look like
> they belong to the same family.

## H.1 Palette — dark mode (base)

```css
:root {
  /* Surfaces */
  --bg:          #05070C;   /* near-black navy, page background */
  --bg-soft:     #090C13;
  --panel:       #0D1119;   /* cards */
  --panel-2:     #121724;   /* raised surface */
  --line:        rgba(244, 247, 251, 0.09);
  --line-strong: rgba(244, 247, 251, 0.16);

  /* Text */
  --text:    #F4F7FB;
  --muted:   #97A1B4;
  --muted-2: #6B7385;

  /* Accents */
  --blue:        #0C7BEB;   /* Brand Blue — from the logo */
  --blue-bright: #3B9DFF;   /* accents and glow on black */
  --blue-deep:   #0A5FB8;
  --blue-ghost:  rgba(12, 123, 235, 0.12);

  /* Semantic */
  --green: #2BD576;
  --amber: #F5B84D;
  --red:   #F16063;
}
```

## H.2 Palette — light mode

⚠️ **Correction to the brief.** It said "light mode toggle", which suggests dark
is the default. In the code it's the other way round: the comment literally says
*"LIGHT theme (default — the `<body>` snippet applies it before the first paint;
dark is chosen with the sun/moon button)"*.

**APM must also start in light mode**, or the two products will feel different.

Selector: **`body[data-theme="light"]`** (not `:root`, not `prefers-color-scheme`).

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
  --blue-bright: #0C7BEB;   /* on white the logo blue needs no glow */
  --blue-ghost:  rgba(12, 123, 235, 0.09);
  --glow-blue:   0 0 30px rgba(12,123,235,.16), 0 0 80px rgba(12,123,235,.05);
  --shadow-card: 0 8px 26px rgba(15, 30, 60, 0.10);
}
```

## H.3 Radii, shadows, motion

```css
--radius-xs: 8px;   --radius-sm: 12px;  --radius-md: 16px;
--radius-lg: 22px;  --radius-xl: 30px;  --radius-full: 999px;

--glow-blue:   0 0 40px rgba(12,123,235,.35), 0 0 120px rgba(12,123,235,.12);
--shadow-card: 0 8px 32px rgba(0, 0, 0, 0.45);

--ease:  cubic-bezier(0.22, 1, 0.36, 1);
--dur-1: 150ms;  --dur-2: 260ms;  --dur-3: 550ms;
```

## H.4 Typography — **self-hosted, no Google Fonts**

```css
--font-display: "Sora", "Inter", system-ui, sans-serif;
--font-body:    "Inter", system-ui, sans-serif;
--font-mono:    "JetBrains Mono", ui-monospace, monospace;
```

All three are **variable woff2 fonts served from your own domain**
(`assets/fonts/sora-latin-var.woff2`, `inter-latin-var.woff2`,
`jetbrains-mono-latin-var.woff2`). This was deliberate: no Google Fonts and a
hardened CSP.

**Consequence for APM:** copy the three `.woff2` files into the project and
declare them with its own `@font-face`. Any UI library that wants to inject
Google Fonts via `<link>` **breaks the CSP** — it's a rule-out criterion for
report C.

## H.5 Inherited constraints APM must respect

1. **CSP with a single hash**: the inline snippet that applies the theme before
   the first paint is signed by hash. If the snippet is edited, the hash has to
   be recalculated. APM needs the same anti-flicker pattern.
2. **No external CDN JS.** Everything vendored. Another rule-out criterion for UI
   libraries that assume a CDN.
3. **Content-based cache busting**: on the main website it's
   `node tools/cachebust.js`. If APM uses a bundler (Vite/Next), the build hash
   handles it — a point **in favor** of a bundler stack, not against.
4. **Truly mobile first**: the owner works from a phone (Termius/browser). The
   agent chat and the lead tables must be usable at 390 px.

## H.6 Brand file

The main website has a `brand/BRAND_IDENTITY.md` — worth reading in full before
Phase 1 so brand decisions already made aren't re-derived.
