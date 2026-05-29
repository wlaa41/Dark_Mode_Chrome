# Quick Dark

> **Current working version: v1.5.0** — covers HSL flip with oklch/canvas normalization, pseudo-elements, SVG paint, image inversion (SVG fetch + small raster), per-site toggle, and `:hover` / `:focus` / `:active` overrides via stylesheet pass with cross-origin re-fetch.


A small Chrome extension (Manifest V3) that turns bright websites into a dark theme by HSL-flipping colors per element. Hue and tone are preserved — dark blue becomes a vivid bright blue, not pastel.

## Features

- **Tone-preserving color flips.** Bright backgrounds invert to dark; dark text inverts to bright. Hue and saturation are preserved so the brand character of the page stays recognizable.
- **Punchy contrast.** Achromatic darks snap to near-white (`L ≥ 0.9`); chromatic darks land at `L ≈ 0.6–0.75` with a small saturation bump so they read vivid rather than washed-out.
- **Modern color formats.** `oklch()`, `oklab()`, `lab()`, `lch()`, `hsl()`, `hwb()`, `color()`, named colors, hex, and `rgb()/rgba()` all parse, via a Canvas2D `fillStyle` round-trip. Falls back to lightness-only extraction if canvas can't normalize.
- **Background gradients.** `linear-gradient(...)` and friends have each color stop flipped (any CSS color function inside).
- **Pseudo-elements.** `::before` and `::after` are recolored via a generated stylesheet keyed on `data-quickdark` ids.
- **Shadow DOM.** The walker pierces open shadow roots.
- **Per-site toggle** (toolbar popup). The disabled list is persisted in `chrome.storage.local` and applied via `excludeMatches`, so disabled sites get **zero injection** — no flash, no perf hit.
- **Manual hostname add/remove** from the popup, for sites you're not currently on.
- **No FOUC.** A 1-line CSS file paints `html` dark at `document_start` before any paint.

## SVG and image handling

Dark-on-white logos go invisible the moment the background flips, so Quick Dark handles three image cases:

| Case | What we do |
|---|---|
| **Inline `<svg>` markup** | Walk every SVG descendant; flip computed `fill` and `stroke` through the foreground HSL flip. **Dark icon paths become bright; already-light paint is left alone** so it can't oscillate between states across resync passes. |
| **External SVG via `<img src="…svg">`** | Try `fetch()` → inline as `<svg>` → strip `<script>` and `on*` handlers → walk and flip paths. If the fetch is blocked (CORS, 404, parse error), fall back to `filter: invert(1) hue-rotate(180deg)` on the original `<img>`. |
| **Raster `<img>` (PNG/JPG/WebP/AVIF/GIF/ICO)** | If `naturalWidth ≤ 100` **and** `naturalHeight ≤ 100`, treat as an icon and apply the CSS invert filter. Larger images are assumed to be photos and left alone. |

### Inversion policy

The current behavior is **"always invert"** for everything in the table above. That catches every dark logo and icon on a page — but it also means small avatars or thumbnails under 100 px get inverted. That's a deliberate trade-off; see "Tuning" below for how to adjust.

### Skipping a specific element

Add the attribute **`data-quickdark-skip`** to any element you don't want touched. The element *and all its descendants* are left alone:

```html
<img data-quickdark-skip src="profile-photo.png">

<div data-quickdark-skip>
  <!-- everything in here keeps its original colors and images -->
</div>
```

This is the official escape hatch. The skip check uses `Element.closest()`, so the attribute on an ancestor covers everything beneath.

## Tuning

All knobs live as constants near the top of `content.js`:

| Constant | Default | Effect |
|---|---|---|
| `BG_LIGHT_THRESHOLD` | `0.55` | A background flips only if its lightness is above this. Lower = catch more off-whites; raise to leave mid-light backgrounds alone. |
| `FG_DARK_THRESHOLD` | `0.55` | A text color flips only if its lightness is below this. |
| `RASTER_ICON_MAX_PX` | `100` | Raster `<img>` larger than this in either dimension is treated as a photo and left untouched. Lower = fewer images touched. |
| `CSS_INVERT_FILTER` | `invert(1) hue-rotate(180deg)` | Fallback filter for external SVGs and small raster icons. Use `invert(1)` for straight inversion without hue rotate. |

The `transformBg` and `transformFg` functions next to those constants control how the L mapping works — edit them if you want different contrast curves (e.g. lower target L for vivid colors, or higher floor for grayscale).

## Per-site disable (popup)

Click the **Quick Dark** toolbar icon:

- The current site shows at the top with one button that toggles it on or off here. Clicking reloads the tab.
- Below it, every disabled site is listed with `×` to re-enable.
- The input box adds hostnames manually (e.g. `example.com`) without needing to visit them.

The disabled list lives in `chrome.storage.local` under `disabledSites`. Disabled sites have the content script **not registered** for them — the script never runs at all on those origins.

## Debug

Open DevTools on a page where Quick Dark is active, then in the console:

```js
__QUICKDARK__.version                          // "1.3.0"
__QUICKDARK__.parseRgb('oklch(1 0 0)')         // [255, 255, 255, 1]
__QUICKDARK__.flipBg('oklch(1 0 0)')           // dark rgb(...)
__QUICKDARK__.flipFg('rgb(0, 0, 139)')         // bright vivid blue
__QUICKDARK__.flipSvgPaint('rgb(20, 20, 20)')  // bright fill replacement
__QUICKDARK__.resync()                         // force a full re-walk now
```

If `__QUICKDARK__` is `undefined`, the script didn't load on this page — reload at `chrome://extensions` (click ↻ on Quick Dark) and hard-refresh the page (`Ctrl+Shift+R`).

## How it works

1. **Background service worker** (`background.js`) registers `content.js` + `early.css` for `<all_urls>` via `chrome.scripting.registerContentScripts`. Disabled sites are passed in `excludeMatches`.
2. **`early.css`** sets `html { background-color: #121212 !important }` at `document_start`. Kills the white flash before any of the page's CSS paints.
3. **`content.js`** walks the DOM at `DOMContentLoaded`, then again on every added node via `MutationObserver`. One follow-up resync runs on the `load` event so any stylesheets / images that finished after the first walk are picked up. Earlier timed resyncs (800 ms / 2500 ms) were removed because they caused visible flicker on pages whose styles settled quickly.
4. For each element, computed `background-color`, `background-image`, `color`, `fill`, and `stroke` are read, converted via cached `flipBg`/`flipFg`/`flipSvgPaint`, and written back as inline `!important`. Inline `!important` beats any author stylesheet rule.
5. `<img>` elements dispatch to the image handler (see the SVG table above).
6. Pseudo-elements are tagged via `data-quickdark="N"` on the host and styled via a dedicated `<style>` tag.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest. Service worker, popup, permissions. |
| `background.js` | Registers/updates content scripts; handles `getState` / `toggle` / `add` / `remove` messages from the popup. |
| `content.js` | DOM walker + color/paint flipper + image handler. |
| `early.css` | Pre-paint dark canvas. |
| `popup.html` / `popup.css` / `popup.js` | Toolbar popup UI. |

## Loading

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → pick this folder.
3. Pin the **Quick Dark** icon to the toolbar.
4. After any code edit: click ↻ next to the extension, then hard-refresh tabs (`Ctrl+Shift+R`).

## Known limits

- `background-image: url(photo.jpg)` is not inverted (we can't reach raster pixels through CSS).
- Cross-origin SVGs served without CORS get the CSS-filter fallback rather than a true tone-flip.
- Cross-origin `<iframe>` content is each frame's own problem — the extension runs independently inside same-origin frames only.
- Closed shadow roots are unreachable by design.
- `<canvas>` / WebGL drawings paint themselves; we don't intercept.

## Improvements to assess (next iteration)

These are observed issues / opportunities that are **not** blocking v1.5.0 but should be looked at next:

- **Udemy search bar (hover state).** When hovering over the search bar / search icon on `udemy.com`, the visual treatment still feels off — needs investigation of the specific selector(s) involved (the input element, its wrapper, and the icon button each carry separate `:hover` rules) and whether they're hitting the same cross-origin sheet we already re-fetch, or a different one injected later by React.
- **CSS-in-JS rules injected after page load.** Libraries like Emotion / styled-components mount `<style>` tags after `DOMContentLoaded` and after `load`. Today we run the interactive pass once at `start()` and once at `load`. Add a `MutationObserver` on `document.head` watching for new `<style>` / `<link rel=stylesheet>` and re-run the interactive pass when one appears.
- **`var(--…)` values inside interactive rules.** We currently skip them — the flipper can't resolve a variable from a rule's source text. Resolve via `getComputedStyle(document.documentElement).getPropertyValue('--name')` at injection time, then run the flip on the resolved value.
- **Box-shadow / outline on hover.** We don't process `box-shadow` colors — cards lifting on hover with a faint shadow can look harsh in dark mode. Lower-priority but worth doing.
- **`<canvas>` / WebGL drawings paint themselves.** Out of scope, but worth noting if any future "dark" target relies on canvas charts.
