(() => {
  'use strict';

  const BG_LIGHT_THRESHOLD       = 0.55;
  const FG_DARK_THRESHOLD        = 0.55;  // Achromatic text below this -> flip to near-white.
  const FG_CHROMATIC_THRESHOLD   = 0.80;  // Chromatic colors below this -> push to vivid bright.
  const BORDER_SIDES            = ['top', 'right', 'bottom', 'left'];

  // ---- Easy-to-edit config -------------------------------------------------
  // Skip pages that are ALREADY dark, so we never wreck a site's own dark mode.
  // Flip this to false to force Ash to run everywhere.
  const SKIP_DARK_PAGES         = true;
  // A page counts as "already dark" if its base background lightness is below
  // this. Raise toward 0.5 to skip more (treat more pages as dark); lower to
  // skip fewer.
  const DARK_PAGE_THRESHOLD     = 0.32;
  // Dark-surface band for near-grayscale backgrounds. White lands at
  // SURFACE_DARK_L (the page canvas); lighter-gray surfaces fan out toward
  // SURFACE_LIGHT_L. SURFACE_GAMMA < 1 expands the separation near white so
  // stacked dark grays stay distinguishable (dark tones are perceptually
  // closer together than light ones, so we deliberately spread them).
  const SURFACE_DARK_L          = 0.11;
  const SURFACE_LIGHT_L         = 0.30;
  const SURFACE_GAMMA           = 0.6;
  const CANVAS_CLASS            = 'ash-on';
  // Blend modes that assume a LIGHT backdrop. On a darkened page they crush
  // their element toward black, so we neutralize them to `normal`. (Lightening
  // modes like screen/lighten are fine on dark and are left alone.)
  const DARKENING_BLENDS        = new Set(['multiply', 'darken', 'color-burn', 'plus-darker']);
  // SVG resource containers whose descendants must NOT be recolored — their
  // paint is structural (mask luminance, clip geometry, filter/gradient defs),
  // not visible color. Recoloring them silently breaks the graphic.
  const SVG_DEFS_SELECTOR       = 'mask,clipPath,filter,defs,pattern,symbol,marker,linearGradient,radialGradient';
  // --------------------------------------------------------------------------

  // Handles "rgb(r, g, b)", "rgb(r g b)", "rgb(r g b / a)" and "rgb(r g b / 50%)".
  const rgbReSingle = /rgba?\(\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/;
  // Matches any CSS color function (rgb, oklch, hsl, lab, color, hwb, lch...) — used for gradient stops.
  const colorFnReGlobal = /(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^)]+\)/gi;

  // Canvas-backed color normalizer. Converts oklch(), hsl(), named colors, hex,
  // color-mix(), etc. to a parseable form. Double-sentinel detects invalid input.
  let _ctx = null;
  function getCtx() {
    if (_ctx) return _ctx;
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    _ctx = c.getContext('2d');
    return _ctx;
  }
  const normCache = new Map();
  function normalizeColor(str) {
    if (normCache.has(str)) return normCache.get(str);
    let out = null;
    try {
      const ctx = getCtx();
      ctx.fillStyle = '#01abcd';
      ctx.fillStyle = str;
      const r1 = ctx.fillStyle;
      ctx.fillStyle = '#fe5432';
      ctx.fillStyle = str;
      const r2 = ctx.fillStyle;
      if (r1 === r2) out = r1;
    } catch { /* leave null */ }
    normCache.set(str, out);
    return out;
  }

  function parseHexColor(hex) {
    if (hex.length === 6) {
      return [parseInt(hex.slice(0,2), 16), parseInt(hex.slice(2,4), 16), parseInt(hex.slice(4,6), 16), 1];
    }
    if (hex.length === 8) {
      const a = parseInt(hex.slice(6,8), 16) / 255;
      if (a === 0) return null;
      return [parseInt(hex.slice(0,2), 16), parseInt(hex.slice(2,4), 16), parseInt(hex.slice(4,6), 16), a];
    }
    if (hex.length === 3) {
      return [parseInt(hex[0]+hex[0], 16), parseInt(hex[1]+hex[1], 16), parseInt(hex[2]+hex[2], 16), 1];
    }
    return null;
  }

  function parseRgbForm(str) {
    const m = rgbReSingle.exec(str);
    if (!m) return null;
    let a = 1;
    if (m[4] !== undefined) {
      a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
    }
    if (a === 0) return null;
    return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), a];
  }

  // Last-resort: pull lightness directly from oklch/oklab/lch/lab/hsl so we can
  // still make the dark/bright decision even if canvas didn't normalize. Loses
  // chroma — returns an achromatic gray at the right lightness.
  function parseLightnessOnly(str) {
    let m = /^(oklch|oklab)\(\s*([\d.]+)(%?)/i.exec(str);
    if (m) {
      let l = parseFloat(m[2]);
      if (isNaN(l)) return null;
      if (m[3] === '%') l /= 100;
      l = Math.max(0, Math.min(1, l));
      const v = Math.round(l * 255);
      return [v, v, v, 1];
    }
    m = /^(lch|lab)\(\s*([\d.]+)/i.exec(str);
    if (m) {
      const l = Math.max(0, Math.min(1, parseFloat(m[2]) / 100));
      if (isNaN(l)) return null;
      const v = Math.round(l * 255);
      return [v, v, v, 1];
    }
    m = /^hsla?\(\s*[^,)\s]+\s*[,\s]\s*[^,)\s]+\s*[,\s]\s*([\d.]+)/i.exec(str);
    if (m) {
      let l = parseFloat(m[1]);
      if (isNaN(l)) return null;
      if (l > 1) l /= 100;
      l = Math.max(0, Math.min(1, l));
      const v = Math.round(l * 255);
      return [v, v, v, 1];
    }
    return null;
  }

  function parseRgb(str) {
    if (!str) return null;
    const c0 = str.charCodeAt(0);

    // Fast path: rgb()/rgba()
    if (c0 === 114) {  // 'r'
      const f = parseRgbForm(str);
      if (f) return f;
    }
    // Fast path: hex
    if (c0 === 35) {   // '#'
      const f = parseHexColor(str.slice(1));
      if (f) return f;
    }
    // Known non-colors
    if (str === 'transparent' || str === 'currentcolor' || str === 'none' || str === '') return null;

    // Slow path: canvas-normalize anything else (oklch, hsl, named, color-mix...).
    const norm = normalizeColor(str);
    if (norm) {
      const nc0 = norm.charCodeAt(0);
      if (nc0 === 35)  return parseHexColor(norm.slice(1));
      if (nc0 === 114) return parseRgbForm(norm);
    }

    // Final fallback: lightness-only extraction.
    return parseLightnessOnly(str);
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h / 6, s, l];
  }

  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    else if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  function hslToRgb(h, s, l) {
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      Math.round(hue2rgb(p, q, h) * 255),
      Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    ];
  }

  // Bright (>0.55 lightness) background -> dark, hue kept, NOT crushed to black.
  //
  //  - Near-grayscale (white / light-gray page & cards): mapped into a dark-
  //    canvas band L[0.12 .. 0.20]. Near-white -> darkest (the page canvas);
  //    surfaces just over the threshold stay a touch lighter, so stacked
  //    cards/buttons keep a sense of elevation instead of all going pure black.
  //  - Chromatic (colored buttons / badges): kept clearly colored. We land them
  //    at a medium-dark L[0.24 .. 0.40] with saturation preserved, so a light-
  //    blue button becomes a readable dark-blue — not a near-black blob.
  function transformBg(h, s, l) {
    if (s < 0.18) {
      // Achromatic surfaces. Map input lightness [threshold..1] onto an output
      // band [SURFACE_LIGHT_L..SURFACE_DARK_L] (inverted: white -> darkest).
      // The gamma curve on the white end spreads near-white inputs further
      // apart, so page / card / hover surfaces stay visually separated instead
      // of collapsing into one indistinguishable near-black.
      const span = 1 - BG_LIGHT_THRESHOLD;
      const dn = Math.min(1, Math.max(0, (1 - l) / span)); // 0 at white, 1 at threshold
      const newL = SURFACE_DARK_L + (SURFACE_LIGHT_L - SURFACE_DARK_L) * Math.pow(dn, SURFACE_GAMMA);
      return [h, s, newL];
    }
    // Colored surface: lighter originals go darker, but clamp to a visible band.
    const newL = Math.min(0.40, Math.max(0.24, 1 - l));
    return [h, Math.min(1, s * 0.92 + 0.08), newL];
  }

  // Text/foreground transform.
  //  - achromatic (s<0.12) snaps to L>=0.9 so near-blacks turn near-white
  //  - chromatic gets pushed into a vivid bright band (L 0.72-0.88), clamped at
  //    both ends so we never go washed-out or too dark. Saturation gets a bump.
  function transformFg(h, s, l) {
    if (s < 0.12) return [h, s, Math.max(0.9, 1 - l)];
    const newL = Math.min(0.88, Math.max(0.72, l + 0.18));
    return [h, Math.min(1, s + 0.08), newL];
  }

  const bgCache = new Map();
  const fgCache = new Map();

  function flipBg(colorStr) {
    if (bgCache.has(colorStr)) return bgCache.get(colorStr);
    const rgba = parseRgb(colorStr);
    if (!rgba) { bgCache.set(colorStr, null); return null; }
    const [r, g, b, a] = rgba;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l <= BG_LIGHT_THRESHOLD) { bgCache.set(colorStr, null); return null; }
    const [nh, ns, nl] = transformBg(h, s, l);
    const [nr, ng, nb] = hslToRgb(nh, ns, nl);
    const out = a === 1 ? `rgb(${nr},${ng},${nb})` : `rgba(${nr},${ng},${nb},${a})`;
    bgCache.set(colorStr, out);
    return out;
  }

  function flipFg(colorStr) {
    if (fgCache.has(colorStr)) return fgCache.get(colorStr);
    const rgba = parseRgb(colorStr);
    if (!rgba) { fgCache.set(colorStr, null); return null; }
    const [r, g, b, a] = rgba;
    const [h, s, l] = rgbToHsl(r, g, b);
    // Achromatic only flips when dark. Chromatic also brightens mid-tones so
    // brand colors (Udemy purple, star-rating orange, etc.) pop on dark bg.
    const cutoff = s < 0.12 ? FG_DARK_THRESHOLD : FG_CHROMATIC_THRESHOLD;
    if (l >= cutoff) { fgCache.set(colorStr, null); return null; }
    const [nh, ns, nl] = transformFg(h, s, l);
    const [nr, ng, nb] = hslToRgb(nh, ns, nl);
    const out = a === 1 ? `rgb(${nr},${ng},${nb})` : `rgba(${nr},${ng},${nb},${a})`;
    fgCache.set(colorStr, out);
    return out;
  }

  // Borders define separation between regions. On dark backgrounds they must
  // stay *visible* — so instead of flipping them like a fill (which pushes light
  // dividers to near-black and kills the contrast), we land every border in a
  // subtle mid-gray band L[0.30 .. 0.36] that reads as a separator against the
  // dark surfaces. Hue is preserved but saturation is capped, since borders are
  // usually near-neutral. Fully transparent borders are left alone.
  const borderCache = new Map();
  function flipBorder(colorStr) {
    if (borderCache.has(colorStr)) return borderCache.get(colorStr);
    const rgba = parseRgb(colorStr);
    if (!rgba) { borderCache.set(colorStr, null); return null; }
    const [r, g, b, a] = rgba;
    if (a === 0) { borderCache.set(colorStr, null); return null; }
    const [h, s] = rgbToHsl(r, g, b);
    const ns = Math.min(s, 0.45);
    const nl = 0.30 + Math.min(s, 0.5) * 0.12; // 0.30 neutral -> ~0.36 saturated
    const [nr, ng, nb] = hslToRgb(h, ns, nl);
    const out = a === 1 ? `rgb(${nr},${ng},${nb})` : `rgba(${nr},${ng},${nb},${a})`;
    borderCache.set(colorStr, out);
    return out;
  }

  // linear-gradient(white, #f0f0f0) -> same gradient with each light stop flipped.
  // Matches every CSS color function inside the gradient (rgb, oklch, hsl, ...).
  function flipBackgroundImage(value) {
    if (!value || value === 'none' || value.indexOf('gradient') === -1) return null;
    let changed = false;
    const out = value.replace(colorFnReGlobal, match => {
      const f = flipBg(match);
      if (f) { changed = true; return f; }
      return match;
    });
    return changed ? out : null;
  }

  // ---------- SVG / image handling ----------

  const SVG_NS                = 'http://www.w3.org/2000/svg';
  const SKIP_ATTR             = 'data-ash-skip';
  // Honor the legacy data-nocturne-skip / data-quickdark-skip attributes too,
  // so markup from earlier versions keeps working.
  const SKIP_SELECTOR         = '[' + SKIP_ATTR + '],[data-nocturne-skip],[data-quickdark-skip]';
  const IMG_PROCESSED_DATASET = 'ashImg';
  const RASTER_ICON_MAX_PX    = 100;  // tweak in source to change icon size cutoff
  const SVG_ICON_MAX_MIN_DIM  = 160;  // svg <img> bigger than this (smaller side) = artwork, skip
  const CSS_INVERT_FILTER     = 'invert(1) hue-rotate(180deg)';

  function looksLikeSvgSrc(src) {
    if (!src) return false;
    return /\.svg(\?|#|$)/i.test(src) || /^data:image\/svg/i.test(src);
  }

  function handleImg(img) {
    if (img.dataset[IMG_PROCESSED_DATASET]) return;
    img.dataset[IMG_PROCESSED_DATASET] = '1';
    const dispatch = () => {
      const src = img.currentSrc || img.src || '';
      if (looksLikeSvgSrc(src)) inlineOrFilterSvgImg(img);
      else updateRasterFilter(img);
    };
    if (img.complete && img.naturalWidth > 0) dispatch();
    // Re-run on EVERY load, not once: lazy loaders swap a tiny placeholder for
    // the real photo on the SAME element. The old once-only handling kept the
    // placeholder-era invert filter on the final product image (the "inverted
    // photos on Temu" bug).
    img.addEventListener('load', dispatch);
    img.addEventListener('error', () => updateRasterFilter(img));
  }

  async function inlineOrFilterSvgImg(img) {
    const src = img.currentSrc || img.src;
    if (!src || !img.parentNode) return;
    if (img.dataset.ashSvgBusy) return;
    // Icon-sized only: a large SVG is artwork (illustration / product art) and
    // recoloring its paths would corrupt the picture. 0x0 (not laid out yet)
    // is treated as an icon, matching the old behavior.
    const rect = img.getBoundingClientRect();
    if (Math.min(rect.width, rect.height) > SVG_ICON_MAX_MIN_DIM) return;
    img.dataset.ashSvgBusy = '1';
    try {
      const res = await fetch(src, { credentials: 'omit', cache: 'force-cache' });
      if (!res.ok) throw new Error('fetch ' + res.status);
      const text = await res.text();
      if (text.indexOf('<svg') === -1) throw new Error('not svg markup');

      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const svgEl = doc.documentElement;
      if (!svgEl || svgEl.nodeName.toLowerCase() !== 'svg') throw new Error('no svg root');

      // Strip <script> / event handlers for safety
      svgEl.querySelectorAll('script').forEach(s => s.remove());
      svgEl.querySelectorAll('*').forEach(el => {
        for (let i = el.attributes.length - 1; i >= 0; i--) {
          const a = el.attributes[i];
          if (a.name.toLowerCase().startsWith('on')) el.removeAttribute(a.name);
        }
      });

      // Carry over <img> attributes that affect rendering
      if (img.width)        svgEl.setAttribute('width',  img.width);
      if (img.height)       svgEl.setAttribute('height', img.height);
      if (typeof img.className === 'string' && img.className)
                            svgEl.setAttribute('class', img.className);
      if (img.alt)          svgEl.setAttribute('aria-label', img.alt);
      if (!svgEl.hasAttribute('preserveAspectRatio'))
                            svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');

      const adopted = document.importNode(svgEl, true);
      img.parentNode.replaceChild(adopted, img);
      enqueueWalk(adopted);
    } catch {
      // CORS-blocked, 404, parse error: CSS filter fallback
      img.style.setProperty('filter', CSS_INVERT_FILTER, 'important');
      delete img.dataset.ashSvgBusy; // allow a retry if the src changes later
    }
  }

  // Raster <img> policy. The old rule was "invert EVERY raster <= 100px" — on
  // shopping sites that color-flipped product swatches, mini-thumbnails and
  // avatars (the Temu complaint). Now we only invert when the pixels PROVE a
  // dark, near-monochrome glyph (logo / icon shape). Cross-origin pixels we
  // can't read -> never invert: a dark logo on a dark page beats a photo with
  // wrong colors.
  const ICON_SAMPLE_PX     = 24;        // downsample size for pixel stats
  const iconDecisionCache  = new Map(); // src -> boolean

  function rasterIconShouldInvert(img) {
    const nw = img.naturalWidth || 0, nh = img.naturalHeight || 0;
    if (!nw || !nh || nw > RASTER_ICON_MAX_PX || nh > RASTER_ICON_MAX_PX) return false;
    const src = img.currentSrc || img.src || '';
    if (iconDecisionCache.has(src)) return iconDecisionCache.get(src);
    let invert = false;
    try {
      const c = document.createElement('canvas');
      const w = Math.min(ICON_SAMPLE_PX, nw), h = Math.min(ICON_SAMPLE_PX, nh);
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data; // throws if cross-origin
      let opaque = 0, satSum = 0, lumSum = 0, vivid = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 16) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
        const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
        opaque++;
        satSum += max ? (max - min) / max : 0;
        if (max - min > 60) vivid++;
        lumSum += (r * 299 + g * 587 + b * 114) / 255000;
      }
      if (opaque) {
        invert = (satSum / opaque) < 0.18   // overall near-grayscale
              && (vivid / opaque) < 0.04    // almost no saturated pixels
              && (lumSum / opaque) < 0.45;  // and dark -> it's a glyph
      }
    } catch { invert = false; }
    iconDecisionCache.set(src, invert);
    return invert;
  }

  function updateRasterFilter(img) {
    if (rasterIconShouldInvert(img)) {
      img.style.setProperty('filter', CSS_INVERT_FILTER, 'important');
    } else if (img.style.getPropertyValue('filter') === CSS_INVERT_FILTER) {
      // Clear a filter WE set earlier (e.g. for the tiny placeholder this
      // element showed before the real photo loaded). A site's own filter
      // never matches our exact value, so it is never touched.
      img.style.removeProperty('filter');
    }
  }

  function flipSvgPaint(colorStr) {
    // Treat all SVG paint as foreground: flip dark icon strokes/text to bright,
    // leave already-light paint alone. ONE-directional, so it never oscillates
    // across resync passes. (Using both directions caused the logo to flicker
    // between dark and bright every resync.)
    return flipFg(colorStr);
  }

  // ---------- end SVG / image handling ----------

  // ---------- stylesheet override pass (:hover etc. + ::before/::after) ----------
  //
  // At element-walk time, :hover/:focus/:active styles aren't yet active, so
  // we never set inline overrides. When the user hovers, the original CSS rule
  // applies and shows a light background on dark mode. To fix that, we read
  // the page's stylesheets once they're parsed, find rules whose selectors
  // include interactive pseudo-classes, flip their colors, and inject a
  // single dedicated stylesheet at the end of <head> with !important overrides.
  //
  // Pseudo-ELEMENTS (::before/::after/::placeholder/...) ride the same pass:
  // they can ONLY be styled from stylesheets, so flipping their rules here
  // fully replaces the old per-element getComputedStyle(el, '::before') walk —
  // which was 2 extra computed-style resolutions on EVERY element and a large
  // part of why big pages felt slow. Colors a pseudo merely inherits are
  // already covered by the inline flip on its host element.
  //
  // The pass is incremental and cached: each stylesheet remembers how many
  // rules we've already scanned (so CSS-in-JS libraries that append rules only
  // cost us the new ones), and every cross-origin href is fetched at most once.

  const INTERACTIVE_RE = /:(?:hover|focus(?:-visible|-within)?|active|checked|visited|target)\b|::?(?:before|after|placeholder|marker|selection|first-line|first-letter)\b/i;
  let interactiveSheetEl = null;
  const interactiveRules   = new Map();    // selectorText -> declaration string (deduped, last wins)
  const sheetRuleProgress  = new WeakMap();// CSSStyleSheet -> count of top-level rules already scanned
  const fetchedHrefs       = new Set();    // cross-origin hrefs already fetched (or attempted)
  let interactiveDirty     = false;

  // Best-effort var(--name[, fallback]) resolution against :root computed styles.
  // Interactive rules read from stylesheet text keep var() unresolved; we can't
  // know the element's cascade, so :root is a pragmatic approximation that covers
  // the common "design tokens on :root" pattern. A few passes resolve nesting.
  let _rootStyle = null;
  function rootStyle() {
    if (_rootStyle) return _rootStyle;
    try { _rootStyle = getComputedStyle(document.documentElement); } catch { _rootStyle = null; }
    return _rootStyle;
  }
  const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g;
  function resolveVars(value) {
    if (!value || value.indexOf('var(') === -1) return value;
    let out = value;
    for (let pass = 0; pass < 3 && out.indexOf('var(') !== -1; pass++) {
      const prev = out;
      out = out.replace(VAR_RE, (m, name, fallback) => {
        const rs = rootStyle();
        const v = rs ? rs.getPropertyValue(name).trim() : '';
        if (v) return v;
        if (fallback !== undefined) return fallback.trim();
        return m; // leave unresolved
      });
      if (out === prev) break;
    }
    return out;
  }

  function pushFlipped(out, prop, value, flipFn) {
    if (!value) return;
    value = value.trim();
    if (!value) return;
    if (value.indexOf('var(') !== -1) {
      value = resolveVars(value);
      if (value.indexOf('var(') !== -1) return; // still unresolved — skip
    }
    const f = flipFn(value);
    if (f) out.push(prop + ':' + f + ' !important;');
  }

  function collectInteractiveDecls(style) {
    const out = [];
    pushFlipped(out, 'background-color', style.getPropertyValue('background-color'), flipBg);
    let bgImg = (style.getPropertyValue('background-image') || '').trim();
    if (bgImg && bgImg.indexOf('gradient') !== -1) {
      if (bgImg.indexOf('var(') !== -1) bgImg = resolveVars(bgImg);
      if (bgImg.indexOf('var(') === -1) {
        const f = flipBackgroundImage(bgImg);
        if (f) out.push('background-image:' + f + ' !important;');
      }
    }
    pushFlipped(out, 'color',               style.getPropertyValue('color'),               flipFg);
    pushFlipped(out, 'border-color',        style.getPropertyValue('border-color'),        flipBorder);
    pushFlipped(out, 'border-top-color',    style.getPropertyValue('border-top-color'),    flipBorder);
    pushFlipped(out, 'border-right-color',  style.getPropertyValue('border-right-color'),  flipBorder);
    pushFlipped(out, 'border-bottom-color', style.getPropertyValue('border-bottom-color'), flipBorder);
    pushFlipped(out, 'border-left-color',   style.getPropertyValue('border-left-color'),   flipBorder);
    pushFlipped(out, 'outline-color',       style.getPropertyValue('outline-color'),       flipBorder);
    pushFlipped(out, 'caret-color',         style.getPropertyValue('caret-color'),         flipFg);
    pushFlipped(out, 'fill',                style.getPropertyValue('fill'),                flipFg);
    pushFlipped(out, 'stroke',              style.getPropertyValue('stroke'),              flipFg);
    return out.length ? out.join('') : null;
  }

  function walkRule(rule) {
    // CSSRule.STYLE_RULE === 1
    if (rule.type === 1) {
      const sel = rule.selectorText;
      if (!sel || !INTERACTIVE_RE.test(sel)) return;
      const decls = collectInteractiveDecls(rule.style);
      if (decls && interactiveRules.get(sel) !== decls) {
        interactiveRules.set(sel, decls);
        interactiveDirty = true;
      }
    } else if (rule.cssRules) {
      // CSSGroupingRule: @media, @supports, @layer, etc.
      const sub = rule.cssRules;
      for (let i = 0; i < sub.length; i++) walkRule(sub[i]);
    }
  }

  function walkCssRules(rules) {
    for (let i = 0; i < rules.length; i++) walkRule(rules[i]);
  }

  function flushInteractive() {
    if (!interactiveDirty) return;
    interactiveDirty = false;
    if (!interactiveRules.size) return;
    if (!interactiveSheetEl) {
      interactiveSheetEl = document.createElement('style');
      interactiveSheetEl.id = 'ash-interactive';
    }
    let css = '';
    interactiveRules.forEach((decls, sel) => { css += sel + '{' + decls + '}\n'; });
    interactiveSheetEl.textContent = css;
    const head = document.head || document.documentElement;
    // Append at the end so we win the source-order tiebreak — but ONLY when
    // something actually mounted after us. A no-op re-append still invalidates
    // every style on the page, which made the next getComputedStyle pay a
    // full-document recalc inside our walk slice (a 100ms+ jank spike).
    if (interactiveSheetEl.parentNode !== head || interactiveSheetEl.nextSibling) {
      head.appendChild(interactiveSheetEl);
    }
  }

  // Fetch a CSS file as text. Tries direct fetch first (works when CDN sends
  // CORS headers, common for static assets); falls back to the background
  // service worker, which has <all_urls> host_permissions and is exempt from
  // page-level CORS.
  async function fetchCssText(url) {
    try {
      const res = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
      if (res.ok) return await res.text();
    } catch { /* try background */ }
    try {
      const res = await chrome.runtime.sendMessage({ type: 'fetchText', url });
      if (res && res.ok && typeof res.text === 'string') return res.text;
    } catch { /* give up */ }
    return null;
  }

  async function processInteractiveStylesheets() {
    const externalHrefs = [];
    const sheets = document.styleSheets;

    // First pass: read whatever we can directly, scanning only rules we haven't
    // seen yet on each sheet.
    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i];
      if (sheet.ownerNode === interactiveSheetEl) continue;
      let rules = null;
      try { rules = sheet.cssRules; }
      catch {
        // Cross-origin SecurityError — queue for re-fetch (once).
        if (sheet.href && !fetchedHrefs.has(sheet.href)) externalHrefs.push(sheet.href);
        continue;
      }
      if (!rules) continue;
      const start = sheetRuleProgress.get(sheet) || 0;
      if (start >= rules.length) continue;        // nothing new since last scan
      for (let j = start; j < rules.length; j++) walkRule(rules[j]);
      sheetRuleProgress.set(sheet, rules.length);
    }

    // Apply same-origin overrides immediately so the user sees something fast.
    flushInteractive();

    if (!externalHrefs.length) return;

    // Mark before awaiting so a concurrent pass can't double-fetch the same href.
    for (const href of externalHrefs) fetchedHrefs.add(href);

    // Second pass: fetch + parse the cross-origin sheets in parallel.
    const fetched = await Promise.all(externalHrefs.map(async href => {
      const text = await fetchCssText(href);
      if (!text) return null;
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(text);
        return sheet;
      } catch {
        return null;
      }
    }));

    for (const sheet of fetched) {
      if (!sheet) continue;
      try { walkCssRules(sheet.cssRules); } catch {}
    }

    flushInteractive();
  }

  // Debounced re-run, triggered when new <style>/<link> nodes appear (CSS-in-JS
  // libraries such as Emotion / styled-components mount styles after load).
  let interactiveScheduled = false;
  function scheduleInteractive() {
    if (interactiveScheduled) return;
    interactiveScheduled = true;
    setTimeout(() => {
      interactiveScheduled = false;
      processInteractiveStylesheets();
    }, 200);
  }

  // ---------- end stylesheet override pass ----------

  let seen = new WeakSet();

  // Pending DOM writes, collected during the read phase and applied in
  // flushWrites(). styleWrites is a flat [el, prop, value, ...] triple list.
  const styleWrites  = [];

  function processElement(el) {
    if (seen.has(el)) return;
    seen.add(el);

    // Escape hatch: data-ash-skip (or legacy data-nocturne-skip / data-quickdark-skip) on self
    // or any ancestor opts out. skipPresent is refreshed once per walk slice —
    // when no skip attribute exists anywhere (the common case) we save an
    // el.closest() selector match on every single element.
    if ((skipPresent || curListInShadow) && typeof el.closest === 'function' && el.closest(SKIP_SELECTOR)) return;

    let cs;
    try { cs = getComputedStyle(el); } catch { cs = null; }

    // Neutralize light-backdrop blend modes (multiply/darken/...). Without this,
    // e.g. Amazon product photos — which use `mix-blend-mode: multiply` to melt
    // a white frame into a white page — go near-black once we darken the page.
    // Done before the <img> dispatch so images get the fix too.
    if (cs && DARKENING_BLENDS.has(cs.mixBlendMode)) {
      styleWrites.push(el, 'mix-blend-mode', 'normal');
    }

    // <img>: dispatch to image handler and stop.
    if (el.tagName === 'IMG') { handleImg(el); return; }

    if (!cs) return;

    const newBg = flipBg(cs.backgroundColor);
    if (newBg) styleWrites.push(el, 'background-color', newBg);

    const newBgImg = flipBackgroundImage(cs.backgroundImage);
    if (newBgImg) styleWrites.push(el, 'background-image', newBgImg);

    const newFg = flipFg(cs.color);
    if (newFg) styleWrites.push(el, 'color', newFg);

    // Caret color on editable fields. `auto` already follows our flipped text
    // color, so it only breaks when a site sets an explicit dark caret-color
    // (e.g. eBay's search box) — flip those to a light, visible caret.
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) {
      const caret = cs.caretColor;
      if (caret && caret !== 'auto') {
        const nc = flipFg(caret);
        if (nc) styleWrites.push(el, 'caret-color', nc);
      }
    }

    // Borders: only recolor sides that are actually drawn (width > 0 and a real
    // style), so we never paint lines onto elements that had none.
    for (let s = 0; s < 4; s++) {
      const side = BORDER_SIDES[s];
      if (parseFloat(cs.getPropertyValue('border-' + side + '-width')) === 0) continue;
      const style = cs.getPropertyValue('border-' + side + '-style');
      if (!style || style === 'none' || style === 'hidden') continue;
      const nb = flipBorder(cs.getPropertyValue('border-' + side + '-color'));
      if (nb) styleWrites.push(el, 'border-' + side + '-color', nb);
    }
    // Outline (focus rings, etc.) — same subtle-separator treatment.
    if (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle && cs.outlineStyle !== 'none') {
      const no = flipBorder(cs.outlineColor);
      if (no) styleWrites.push(el, 'outline-color', no);
    }

    // SVG paint: fill / stroke (applies to <svg> and all SVG descendants).
    if (el.namespaceURI === SVG_NS) {
      // Skip elements inside <mask>/<clipPath>/<filter>/<defs>/gradients/etc.:
      // their paint is structural. Recoloring a mask's contents broke Udemy's
      // star ratings (the mask encodes the filled-star fraction by luminance),
      // making every rating look identical.
      if (el.closest && el.closest(SVG_DEFS_SELECTOR)) return;
      const fillStr = cs.fill;
      if (fillStr && fillStr !== 'none' && fillStr !== '') {
        const nf = flipSvgPaint(fillStr);
        if (nf) styleWrites.push(el, 'fill', nf);
      }
      const strokeStr = cs.stroke;
      if (strokeStr && strokeStr !== 'none' && strokeStr !== '') {
        const ns = flipSvgPaint(strokeStr);
        if (ns) styleWrites.push(el, 'stroke', ns);
      }
      return;  // SVG elements don't render ::before / ::after
    }
  }

  // Write-phase: apply everything collected during the read phase in one go.
  // Splitting reads from writes means getComputedStyle never runs against a
  // style tree we just dirtied, so the browser does far fewer recalcs.
  function flushWrites() {
    for (let i = 0; i < styleWrites.length; i += 3) {
      styleWrites[i].style.setProperty(styleWrites[i + 1], styleWrites[i + 2], 'important');
    }
    styleWrites.length = 0;
  }

  // ---------- time-sliced DOM walking ----------
  //
  // ALL walking (initial pass, mutation batches, resync) goes through one
  // budgeted queue. Each slice processes elements for at most WALK_BUDGET_MS,
  // flushes the collected writes in a single batch, and yields to the page.
  // The old code walked the whole tree synchronously — on huge infinite-scroll
  // DOMs (Temu and friends) that froze the main thread for whole seconds.

  const WALK_BUDGET_MS = 12;

  const walkQueue   = [];     // element roots whose subtrees still need work
  const shadowQueue = [];     // shadow roots pending expansion
  let curList = null;         // descendant list of the root being processed
  let curIdx  = 0;
  let curListInShadow = false;// shadow trees always run the closest() skip check
  let walkScheduled = false;
  let skipPresent = false;    // any data-ash-skip in the document? per-slice

  function scheduleWalk() {
    if (walkScheduled) return;
    walkScheduled = true;
    const cb = () => { walkScheduled = false; walkSlice(WALK_BUDGET_MS); };
    if (window.requestIdleCallback) requestIdleCallback(cb, { timeout: 150 });
    else if (window.requestAnimationFrame) requestAnimationFrame(cb);
    else setTimeout(cb, 16);
  }

  function enqueueWalk(node) {
    if (!node || node.nodeType !== 1) return;
    walkQueue.push(node);
    scheduleWalk();
  }

  // Advance to the next pending root; returns false when nothing is left.
  function nextList() {
    while (walkQueue.length) {
      const root = walkQueue.shift();
      if (!root.isConnected) continue;
      processElement(root);
      curList = root.getElementsByTagName('*');
      curIdx = 0;
      curListInShadow = false;
      return true;
    }
    while (shadowQueue.length) {
      const sr = shadowQueue.shift();
      let list;
      try { list = sr.querySelectorAll('*'); } catch { continue; }
      curList = list;
      curIdx = 0;
      curListInShadow = true;
      return true;
    }
    return false;
  }

  function walkSlice(budget) {
    if (mo) mo.disconnect();
    skipPresent = !!document.querySelector(SKIP_SELECTOR);
    const t0 = performance.now();
    do {
      if (!curList && !nextList()) break;
      while (curIdx < curList.length) {
        const el = curList[curIdx++];
        processElement(el);
        if (el.shadowRoot) shadowQueue.push(el.shadowRoot);
        if (performance.now() - t0 > budget) break;
      }
      if (curList && curIdx >= curList.length) curList = null;
    } while (performance.now() - t0 <= budget);
    flushWrites();
    if (mo) observe();
    if (curList || walkQueue.length || shadowQueue.length) scheduleWalk();
  }

  // Full re-pass: stylesheets / lazy mounts may have changed computed colors
  // since the last walk. Reset 'seen' so every element gets re-checked; the
  // color caches keep the HSL math cheap, and the slicer keeps it jank-free.
  function resync() {
    seen = new WeakSet();
    walkQueue.length = 0;
    shadowQueue.length = 0;
    curList = null;
    enqueueWalk(document.documentElement);
  }

  let mo = null;
  let pageSkipped = false;
  function observe() {
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  // --- Dark-canvas control + already-dark-site detection --------------------

  // Toggle our pre-paint dark canvas (early.css `html.ash-on`). Removing it
  // both lets us read the page's own background and leaves dark sites untouched.
  function setCanvas(on) {
    const el = document.documentElement;
    if (!el) return;
    try { el.classList.toggle(CANVAS_CLASS, on); } catch { /* sandbox */ }
  }

  // Lightness [0..1] of the page's OWN base background. We lift our canvas while
  // measuring so we read the site, not ourselves. Returns 1 (treat as light)
  // when nothing opaque is declared — the browser default is white.
  function pageBaseLightness() {
    const read = el => {
      if (!el) return null;
      let c;
      try { c = parseRgb(getComputedStyle(el).backgroundColor); } catch { return null; }
      return c && c[3] > 0 ? c : null;
    };
    setCanvas(false);
    const c = read(document.body) || read(document.documentElement);
    setCanvas(true);
    if (!c) return 1;
    const [, , l] = rgbToHsl(c[0], c[1], c[2]);
    return l;
  }

  function isPageAlreadyDark() {
    return pageBaseLightness() < DARK_PAGE_THRESHOLD;
  }

  // True if an added subtree introduces stylesheet(s) we should re-scan for
  // interactive rules.
  function bringsStylesheet(n) {
    if (n.tagName === 'STYLE' || n.tagName === 'LINK') return true;
    return !!(n.querySelector && n.firstElementChild && n.querySelector('style,link[rel="stylesheet"]'));
  }

  function start() {
    // Already-dark site? Reveal its own background and do nothing else, so we
    // never fight a theme the page already ships. Toggle SKIP_DARK_PAGES off
    // (top of file) to force Ash to run regardless.
    if (SKIP_DARK_PAGES && isPageAlreadyDark()) {
      setCanvas(false);
      pageSkipped = true;
      return;
    }

    mo = new MutationObserver(muts => {
      let sawSheet = false;
      for (let i = 0; i < muts.length; i++) {
        const added = muts[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          const n = added[j];
          if (n.nodeType !== 1) continue;
          enqueueWalk(n);
          if (!sawSheet && bringsStylesheet(n)) sawSheet = true;
        }
      }
      if (sawSheet) scheduleInteractive();
    });

    // No synchronous pre-paint walk: early.css already paints a dark canvas,
    // dark body and readable default text, so we let the browser do its first
    // paint (paying the initial full style resolution in ITS render pass, not
    // inside our task) and start flipping in idle slices right after. On huge
    // pages this is the difference between a frozen tab and a smooth load.
    enqueueWalk(document.documentElement);
    observe();

    // First interactive-state pass: catch :hover/:focus/:active rules in the
    // stylesheets that are already parsed.
    processInteractiveStylesheets();

    // Single follow-up pass once all stylesheets / images have loaded.
    // Earlier 800ms / 2500ms timers were dropped — they caused visible
    // flicker on pages whose styles settle quickly.
    if (document.readyState !== 'complete') {
      window.addEventListener('load', () => {
        resync();
        processInteractiveStylesheets();
      }, { once: true });
    }
  }

  // Add the dark canvas immediately (document_start) so light pages never
  // flash white. It's lifted later if the page turns out to already be dark.
  setCanvas(true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  // Debug hook: open DevTools console and run e.g.
  //   __ASH__.parseRgb('oklch(1 0 0)')   -> should return [255,255,255,1]
  //   __ASH__.flipBg('oklch(1 0 0)')      -> should return a dark rgb(...)
  //   __ASH__.resync()                    -> force re-walk of the page
  // If __ASH__ is undefined, the old script is still cached — reload the extension.
  try {
    window.__ASH__ = {
      version: '2.0.0',
      get skipped() { return pageSkipped; },
      parseRgb, flipBg, flipFg, flipBorder, flipSvgPaint,
      isPageAlreadyDark, pageBaseLightness, setCanvas,
      resync,
      processInteractiveStylesheets,
      fetchCssText,
    };
  } catch { /* sandboxed frames */ }
})();
