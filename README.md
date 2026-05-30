# Nocturne 🌙

> **Tone-preserving dark mode for every site.**
> **Current version: v1.6.0** — HSL flip with oklch/canvas normalization, pseudo-elements, SVG paint, image inversion (SVG fetch + small raster), per-site toggle, and `:hover` / `:focus` / `:active` overrides via an incremental, cached stylesheet pass with cross-origin re-fetch, `var()` resolution, and live re-styling for CSS-in-JS pages.

Nocturne is a small Chrome extension (Manifest V3) that turns bright websites into a dark theme by HSL-flipping colors per element. Hue and tone are preserved — dark blue becomes a vivid bright blue, not pastel — so the brand character of each page survives the flip.

## Features

- **Tone-preserving color flips.** Bright backgrounds invert to dark; dark text inverts to bright. Hue and saturation are preserved so the brand character of the page stays recognizable.
- **Punchy contrast.** Achromatic darks snap to near-white (`L ≥ 0.9`); chromatic darks land at `L ≈ 0.72–0.88` with a small saturation bump so they read vivid rather than washed-out.
- **Modern color formats.** `oklch()`, `oklab()`, `lab()`, `lch()`, `hsl()`, `hwb()`, `color()`, named colors, hex, and `rgb()/rgba()` all parse, via a Canvas2D `fillStyle` round-trip. Falls back to lightness-only extraction if canvas can't normalize.
- **Background gradients.** `linear-gradient(...)` and friends have each color stop flipped (any CSS color function inside).
- **Pseudo-elements.** `::before` and `::after` are recolored via a generated stylesheet keyed on `data-nocturne` ids.
- **Shadow DOM.** The walker pierces open shadow roots.
- **Interactive states.** `:hover` / `:focus` / `:active` / `:checked` rules are flipped through a dedicated stylesheet pass, including cross-origin sheets (re-fetched via the service worker) and `var(--token)` values resolved against `:root`.
- **Live re-styling.** CSS-in-JS libraries (Emotion, styled-components, etc.) mount `<style>` tags *after* load. A `MutationObserver` watches for new `<style>` / `<link rel=stylesheet>` and re-runs the interactive pass (debounced), so hover states on React-heavy sites get flipped too.
- **Per-site toggle** (toolbar popup). The disabled list is persisted in `chrome.storage.local` and applied via `excludeMatches`, so disabled sites get **zero injection** — no flash, no perf hit.
- **Manual hostname add/remove** from the popup, for sites you're not currently on.
- **No FOUC.** A 1-line CSS file paints `html` dark at `document_start` before any paint.

## Performance

Nocturne is built to stay cheap even on large, dynamic pages:

- **Read/write split.** The DOM walk reads every element's computed style **first**, then applies all inline overrides in a single batch. Because `getComputedStyle` never runs against a style tree we just dirtied, the browser does far fewer style recalcs than a naive read-then-write-per-element loop.
- **Incremental interactive pass.** Each stylesheet remembers how many rules we've already scanned, so when a CSS-in-JS library appends rules we only pay for the new ones — not a full re-scan.
- **Fetch-once cross-origin sheets.** Every cross-origin href is fetched at most once; later passes reuse the result instead of re-downloading.
- **Cached color math.** `flipBg` / `flipFg` / canvas-normalize results are memoized, so repeated colors are essentially free.
- **Batched mutations.** DOM mutations are coalesced via `requestIdleCallback` (→ `requestAnimationFrame` → `setTimeout`).

## SVG and image handling

Dark-on-white logos go invisible the moment the background flips, so Nocturne handles three image cases:

| Case | What we do |
|---|---|
| **Inline `<svg>` markup** | Walk every SVG descendant; flip computed `fill` and `stroke` through the foreground HSL flip. **Dark icon paths become bright; already-light paint is left alone** so it can't oscillate between states across resync passes. |
| **External SVG via `<img src="…svg">`** | Try `fetch()` → inline as `<svg>` → strip `<script>` and `on*` handlers → walk and flip paths. If the fetch is blocked (CORS, 404, parse error), fall back to `filter: invert(1) hue-rotate(180deg)` on the original `<img>`. |
| **Raster `<img>` (PNG/JPG/WebP/AVIF/GIF/ICO)** | If `naturalWidth ≤ 100` **and** `naturalHeight ≤ 100`, treat as an icon and apply the CSS invert filter. Larger images are assumed to be photos and left alone. |

### Inversion policy

The current behavior is **"always invert"** for everything in the table above. That catches every dark logo and icon on a page — but it also means small avatars or thumbnails under 100 px get inverted. That's a deliberate trade-off; see "Tuning" below for how to adjust.

### Skipping a specific element

Add the attribute **`data-nocturne-skip`** to any element you don't want touched. The element *and all its descendants* are left alone:

```html
<img data-nocturne-skip src="profile-photo.png">

<div data-nocturne-skip>
  <!-- everything in here keeps its original colors and images -->
</div>
```

This is the official escape hatch. The skip check uses `Element.closest()`, so the attribute on an ancestor covers everything beneath. The legacy `data-quickdark-skip` attribute is still honored.

## Tuning

All knobs live as constants near the top of `content.js`:

| Constant | Default | Effect |
|---|---|---|
| `BG_LIGHT_THRESHOLD` | `0.55` | A background flips only if its lightness is above this. Lower = catch more off-whites; raise to leave mid-light backgrounds alone. |
| `FG_DARK_THRESHOLD` | `0.55` | An achromatic text color flips only if its lightness is below this. |
| `FG_CHROMATIC_THRESHOLD` | `0.80` | A chromatic text color flips (and brightens) only if its lightness is below this. |
| `RASTER_ICON_MAX_PX` | `100` | Raster `<img>` larger than this in either dimension is treated as a photo and left untouched. Lower = fewer images touched. |
| `CSS_INVERT_FILTER` | `invert(1) hue-rotate(180deg)` | Fallback filter for external SVGs and small raster icons. Use `invert(1)` for straight inversion without hue rotate. |

The `transformBg` and `transformFg` functions next to those constants control how the L mapping works — edit them if you want different contrast curves (e.g. lower target L for vivid colors, or higher floor for grayscale).

## Per-site disable (popup)

Click the **Nocturne** toolbar icon:

- The current site shows at the top with one button that toggles it on or off here. Clicking reloads the tab.
- Below it, every disabled site is listed with `×` to re-enable.
- The input box adds hostnames manually (e.g. `example.com`) without needing to visit them.

The disabled list lives in `chrome.storage.local` under `disabledSites`. Disabled sites have the content script **not registered** for them — the script never runs at all on those origins.

## Debug

Open DevTools on a page where Nocturne is active, then in the console:

```js
__NOCTURNE__.version                          // "1.6.0"
__NOCTURNE__.parseRgb('oklch(1 0 0)')         // [255, 255, 255, 1]
__NOCTURNE__.flipBg('oklch(1 0 0)')           // dark rgb(...)
__NOCTURNE__.flipFg('rgb(0, 0, 139)')         // bright vivid blue
__NOCTURNE__.flipSvgPaint('rgb(20, 20, 20)')  // bright fill replacement
__NOCTURNE__.resync()                         // force a full re-walk now
__NOCTURNE__.processInteractiveStylesheets()  // re-run the :hover/:focus pass
```

If `__NOCTURNE__` is `undefined`, the script didn't load on this page — reload at `chrome://extensions` (click ↻ on Nocturne) and hard-refresh the page (`Ctrl+Shift+R`).

## How it works

1. **Background service worker** (`background.js`) registers `content.js` + `early.css` for `<all_urls>` via `chrome.scripting.registerContentScripts`. Disabled sites are passed in `excludeMatches`.
2. **`early.css`** sets `html { background-color: #121212 !important }` at `document_start`. Kills the white flash before any of the page's CSS paints.
3. **`content.js`** walks the DOM at `DOMContentLoaded`, then again on every added node via `MutationObserver`. One follow-up resync runs on the `load` event so any stylesheets / images that finished after the first walk are picked up. The walk reads all computed styles first, then writes the inline overrides in one batch.
4. For each element, computed `background-color`, `background-image`, `color`, `fill`, and `stroke` are read, converted via cached `flipBg`/`flipFg`/`flipSvgPaint`, and written back as inline `!important`. Inline `!important` beats any author stylesheet rule.
5. `<img>` elements dispatch to the image handler (see the SVG table above).
6. Pseudo-elements are tagged via `data-nocturne="N"` on the host and styled via a dedicated `<style>` tag.
7. Interactive (`:hover` etc.) rules are read from the page's stylesheets — incrementally and cached — flipped, and re-emitted in a single `nocturne-interactive` stylesheet appended last so it wins source order. New stylesheets added at runtime trigger a debounced re-run.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest. Service worker, popup, permissions, icons. |
| `background.js` | Registers/updates content scripts; handles `getState` / `toggle` / `add` / `remove` / `fetchText` messages. |
| `content.js` | DOM walker + color/paint flipper + image handler + interactive-state pass. |
| `early.css` | Pre-paint dark canvas. |
| `popup.html` / `popup.css` / `popup.js` | Toolbar popup UI. |
| `icons/` | Crescent-moon toolbar icons (16/32/48/128 px). |

## Loading

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → pick this folder.
3. Pin the **Nocturne** icon to the toolbar.
4. After any code edit: click ↻ next to the extension, then hard-refresh tabs (`Ctrl+Shift+R`).

## Known limits

- `background-image: url(photo.jpg)` is not inverted (we can't reach raster pixels through CSS).
- Cross-origin SVGs served without CORS get the CSS-filter fallback rather than a true tone-flip.
- Cross-origin `<iframe>` content is each frame's own problem — the extension runs independently inside same-origin frames only.
- Closed shadow roots are unreachable by design.
- `<canvas>` / WebGL drawings paint themselves; we don't intercept.
- `var()` in interactive rules is resolved against `:root` only, so tokens overridden deeper in the cascade may resolve to the root value.

## Roadmap (next iteration)

Done in v1.6.0: live re-styling for CSS-in-JS pages, `var()` resolution in interactive rules, and the read/write-split performance pass. Still open:

- **Box-shadow / outline on hover.** We process `outline-color` but not `box-shadow` colors — cards lifting on hover with a faint shadow can look harsh in dark mode. Lower-priority but worth doing.
- **Per-element `var()` resolution.** Today interactive `var()` values resolve against `:root`. Resolving against the matched element's cascade would be more accurate for component-scoped tokens.
- **`<canvas>` / WebGL drawings.** Out of scope (they paint their own pixels), but worth noting if any future "dark" target relies on canvas charts.
