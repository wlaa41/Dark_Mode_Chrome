(() => {
  'use strict';

  const BG_LIGHT_THRESHOLD       = 0.55;
  const FG_DARK_THRESHOLD        = 0.55;  // Achromatic text below this -> flip to near-white.
  const FG_CHROMATIC_THRESHOLD   = 0.80;  // Chromatic colors below this -> push to vivid bright.
  const PSEUDO_ATTR              = 'data-nocturne';

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

  // Bright (>0.55 lightness) -> deep dark, hue kept.
  //  - near-grayscale becomes uniform near-black (#141414-ish)
  //  - tinted pastels become deep tinted dark
  function transformBg(h, s, l) {
    const newL = s < 0.08 ? 0.08 : Math.min(0.18, (1 - l) * 0.5);
    return [h, s, newL];
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
  const SKIP_ATTR             = 'data-nocturne-skip';
  // Honor the legacy data-quickdark-skip attribute too, so existing markup keeps working.
  const SKIP_SELECTOR         = '[' + SKIP_ATTR + '],[data-quickdark-skip]';
  const IMG_PROCESSED_DATASET = 'nocturneImg';
  const RASTER_ICON_MAX_PX    = 100;  // tweak in source to change icon size cutoff
  const CSS_INVERT_FILTER     = 'invert(1) hue-rotate(180deg)';

  function looksLikeSvgSrc(src) {
    if (!src) return false;
    return /\.svg(\?|#|$)/i.test(src) || /^data:image\/svg/i.test(src);
  }

  function isRasterSrc(src) {
    if (!src) return false;
    return /\.(png|jpe?g|gif|webp|avif|bmp|ico)(\?|#|$)/i.test(src)
      || /^data:image\/(png|jpe?g|gif|webp|avif|bmp|x-icon)/i.test(src);
  }

  function handleImg(img) {
    if (img.dataset[IMG_PROCESSED_DATASET]) return;
    img.dataset[IMG_PROCESSED_DATASET] = '1';
    const src = img.currentSrc || img.src || '';
    if (looksLikeSvgSrc(src)) {
      inlineOrFilterSvgImg(img);
    } else if (isRasterSrc(src)) {
      maybeInvertRasterIcon(img);
    }
  }

  async function inlineOrFilterSvgImg(img) {
    const src = img.currentSrc || img.src;
    if (!src || !img.parentNode) return;
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
      walk(adopted);
      flushWrites();
    } catch {
      // CORS-blocked, 404, parse error: CSS filter fallback
      img.style.setProperty('filter', CSS_INVERT_FILTER, 'important');
    }
  }

  function maybeInvertRasterIcon(img) {
    const apply = () => {
      const nw = img.naturalWidth || 0;
      const nh = img.naturalHeight || 0;
      if (!nw || !nh) return;
      if (nw > RASTER_ICON_MAX_PX || nh > RASTER_ICON_MAX_PX) return;
      img.style.setProperty('filter', CSS_INVERT_FILTER, 'important');
    };
    if (img.complete && img.naturalWidth > 0) apply();
    else img.addEventListener('load', apply, { once: true });
  }

  function flipSvgPaint(colorStr) {
    // Treat all SVG paint as foreground: flip dark icon strokes/text to bright,
    // leave already-light paint alone. ONE-directional, so it never oscillates
    // across resync passes. (Using both directions caused the logo to flicker
    // between dark and bright every resync.)
    return flipFg(colorStr);
  }

  // ---------- end SVG / image handling ----------

  // ---------- interactive state (:hover, :focus, :active) stylesheet pass ----------
  //
  // At element-walk time, :hover/:focus/:active styles aren't yet active, so
  // we never set inline overrides. When the user hovers, the original CSS rule
  // applies and shows a light background on dark mode. To fix that, we read
  // the page's stylesheets once they're parsed, find rules whose selectors
  // include interactive pseudo-classes, flip their colors, and inject a
  // single dedicated stylesheet at the end of <head> with !important overrides.
  //
  // The pass is incremental and cached: each stylesheet remembers how many
  // rules we've already scanned (so CSS-in-JS libraries that append rules only
  // cost us the new ones), and every cross-origin href is fetched at most once.

  const INTERACTIVE_RE = /:(?:hover|focus(?:-visible|-within)?|active|checked|visited|target)\b/i;
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
    pushFlipped(out, 'border-color',        style.getPropertyValue('border-color'),        flipBg);
    pushFlipped(out, 'border-top-color',    style.getPropertyValue('border-top-color'),    flipBg);
    pushFlipped(out, 'border-right-color',  style.getPropertyValue('border-right-color'),  flipBg);
    pushFlipped(out, 'border-bottom-color', style.getPropertyValue('border-bottom-color'), flipBg);
    pushFlipped(out, 'border-left-color',   style.getPropertyValue('border-left-color'),   flipBg);
    pushFlipped(out, 'outline-color',       style.getPropertyValue('outline-color'),       flipBg);
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
      interactiveSheetEl.id = 'nocturne-interactive';
    }
    let css = '';
    interactiveRules.forEach((decls, sel) => { css += sel + '{' + decls + '}\n'; });
    interactiveSheetEl.textContent = css;
    const head = document.head || document.documentElement;
    // Re-append at the end so we win the source-order tiebreak even after the
    // page (or a CSS-in-JS library) injects more sheets later.
    head.appendChild(interactiveSheetEl);
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
    const ourPseudoNode = pseudoSheet ? pseudoSheet.ownerNode : null;

    // First pass: read whatever we can directly, scanning only rules we haven't
    // seen yet on each sheet.
    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i];
      if (sheet.ownerNode === interactiveSheetEl) continue;
      if (ourPseudoNode && sheet.ownerNode === ourPseudoNode) continue;
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

  // ---------- end interactive state pass ----------

  let pseudoSheet = null;
  let pseudoUid = 0;

  function ensurePseudoSheet() {
    if (pseudoSheet) return pseudoSheet;
    const s = document.createElement('style');
    s.id = 'nocturne-pseudo';
    (document.head || document.documentElement).appendChild(s);
    pseudoSheet = s.sheet;
    return pseudoSheet;
  }

  // Collect-phase: read the pseudo's computed style and queue an override.
  // The actual id attribute + insertRule happen in flushWrites() so the read
  // phase stays free of DOM writes (keeps style recalc from thrashing).
  function processPseudo(el, which) {
    let cs;
    try { cs = getComputedStyle(el, which); } catch { return; }
    if (!cs) return;
    const content = cs.content;
    if (!content || content === 'none' || content === 'normal') return;

    const newBg = flipBg(cs.backgroundColor);
    const newFg = flipFg(cs.color);
    if (!newBg && !newFg) return;

    let body = '';
    if (newBg) body += `background-color:${newBg} !important;`;
    if (newFg) body += `color:${newFg} !important;`;

    pseudoWrites.push(el, which, body);
  }

  let seen = new WeakSet();

  // Pending DOM writes, collected during the read phase and applied in
  // flushWrites(). styleWrites is a flat [el, prop, value, ...] triple list;
  // pseudoWrites is a flat [el, which, body, ...] triple list.
  const styleWrites  = [];
  const pseudoWrites = [];

  function processElement(el) {
    if (seen.has(el)) return;
    seen.add(el);

    // Escape hatch: data-nocturne-skip (or legacy data-quickdark-skip) on self
    // or any ancestor opts out.
    if (typeof el.closest === 'function' && el.closest(SKIP_SELECTOR)) return;

    // <img>: dispatch to image handler and stop.
    if (el.tagName === 'IMG') { handleImg(el); return; }

    let cs;
    try { cs = getComputedStyle(el); } catch { return; }
    if (!cs) return;

    const newBg = flipBg(cs.backgroundColor);
    if (newBg) styleWrites.push(el, 'background-color', newBg);

    const newBgImg = flipBackgroundImage(cs.backgroundImage);
    if (newBgImg) styleWrites.push(el, 'background-image', newBgImg);

    const newFg = flipFg(cs.color);
    if (newFg) styleWrites.push(el, 'color', newFg);

    // SVG paint: fill / stroke (applies to <svg> and all SVG descendants)
    if (el.namespaceURI === SVG_NS) {
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

    processPseudo(el, '::before');
    processPseudo(el, '::after');
  }

  // Write-phase: apply everything collected during the read phase in one go.
  // Splitting reads from writes means getComputedStyle never runs against a
  // style tree we just dirtied, so the browser does far fewer recalcs.
  function flushWrites() {
    for (let i = 0; i < styleWrites.length; i += 3) {
      styleWrites[i].style.setProperty(styleWrites[i + 1], styleWrites[i + 2], 'important');
    }
    styleWrites.length = 0;

    if (pseudoWrites.length) {
      const sheet = ensurePseudoSheet();
      for (let i = 0; i < pseudoWrites.length; i += 3) {
        const el = pseudoWrites[i];
        const which = pseudoWrites[i + 1];
        const body = pseudoWrites[i + 2];
        let id = el.getAttribute(PSEUDO_ATTR);
        if (!id) {
          id = String(++pseudoUid);
          el.setAttribute(PSEUDO_ATTR, id);
        }
        try {
          sheet.insertRule(`[${PSEUDO_ATTR}="${id}"]${which}{${body}}`, sheet.cssRules.length);
        } catch { /* ignore */ }
      }
      pseudoWrites.length = 0;
    }
  }

  function walk(root) {
    if (!root || root.nodeType !== 1) return;
    processElement(root);
    const list = root.getElementsByTagName('*');
    for (let i = 0, n = list.length; i < n; i++) {
      const el = list[i];
      processElement(el);
      const sr = el.shadowRoot;
      if (sr) walkShadow(sr);
    }
  }

  function walkShadow(root) {
    let list;
    try { list = root.querySelectorAll('*'); } catch { return; }
    for (let i = 0, n = list.length; i < n; i++) {
      const el = list[i];
      processElement(el);
      const sr = el.shadowRoot;
      if (sr) walkShadow(sr);
    }
  }

  let scheduled = false;
  const pending = [];
  function flush() {
    scheduled = false;
    const batch = pending.splice(0);
    if (mo) mo.disconnect();
    for (let i = 0; i < batch.length; i++) walk(batch[i]);
    flushWrites();
    if (mo) observe();
  }
  function schedule(node) {
    pending.push(node);
    if (scheduled) return;
    scheduled = true;
    (window.requestIdleCallback || window.requestAnimationFrame || setTimeout)(flush);
  }

  // Full re-pass: stylesheets / lazy mounts may have changed computed colors
  // since the last walk. Reset 'seen' so every element gets re-checked; the
  // color caches keep the HSL math cheap.
  function resync() {
    if (mo) mo.disconnect();
    seen = new WeakSet();
    const root = document.documentElement;
    if (root) processElement(root);
    if (document.body) walk(document.body);
    flushWrites();
    if (mo) observe();
  }

  let mo = null;
  function observe() {
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  // True if an added subtree introduces stylesheet(s) we should re-scan for
  // interactive rules.
  function bringsStylesheet(n) {
    if (n.tagName === 'STYLE' || n.tagName === 'LINK') return true;
    return !!(n.querySelector && n.firstElementChild && n.querySelector('style,link[rel="stylesheet"]'));
  }

  function start() {
    const root = document.documentElement;
    if (root) processElement(root);
    if (document.body) walk(document.body);
    flushWrites();

    mo = new MutationObserver(muts => {
      let sawSheet = false;
      for (let i = 0; i < muts.length; i++) {
        const added = muts[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          const n = added[j];
          if (n.nodeType !== 1) continue;
          schedule(n);
          if (!sawSheet && bringsStylesheet(n)) sawSheet = true;
        }
      }
      if (sawSheet) scheduleInteractive();
    });
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  // Debug hook: open DevTools console and run e.g.
  //   __NOCTURNE__.parseRgb('oklch(1 0 0)')   -> should return [255,255,255,1]
  //   __NOCTURNE__.flipBg('oklch(1 0 0)')      -> should return a dark rgb(...)
  //   __NOCTURNE__.resync()                    -> force re-walk of the page
  // If __NOCTURNE__ is undefined, the old script is still cached — reload the extension.
  try {
    window.__NOCTURNE__ = {
      version: '1.6.0',
      parseRgb, flipBg, flipFg, flipSvgPaint,
      resync,
      processInteractiveStylesheets,
      fetchCssText,
    };
  } catch { /* sandboxed frames */ }
})();
