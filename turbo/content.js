'use strict';

/**
 * Ash Turbo - Content Script
 *
 * High-performance dark mode using CSS filters. The dark mode itself is pure
 * CSS (turbo.css): one inversion filter on <html>, one counter-filter on real
 * media. This script only does two cheap jobs:
 *
 *   1. Detect already-dark pages and set html.ash-skip-turbo so we leave them
 *      completely alone (turbo.css scopes every rule on that class).
 *   2. Tag elements whose STYLESHEET background-image paints a real picture
 *      (url(...)) with data-ash-bg so the CSS can counter-invert them.
 *      Inline-style backgrounds are already covered by [style*="url("].
 *
 * All scanning is batched and time-budgeted (~8ms idle slices, reads first,
 * writes after) so it never blocks the page — the old version called
 * getComputedStyle synchronously on every element and on every mutation,
 * which janked infinite-scroll sites like Temu.
 */

(function () {
  // 1. Skip non-HTML documents (like PDFs or images opened directly)
  if (!(document.documentElement instanceof HTMLHtmlElement)) return;

  var SKIP_CLASS = 'ash-skip-turbo';
  var BG_ATTR = 'data-ash-bg';
  var SLICE_BUDGET_MS = 8;

  // Tags that never paint a background image worth counter-inverting.
  // (Media tags are excluded too — turbo.css already handles them directly.)
  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, TITLE: 1, HEAD: 1, NOSCRIPT: 1,
    TEMPLATE: 1, BR: 1, WBR: 1, OPTION: 1, SOURCE: 1, TRACK: 1, AUDIO: 1,
    IMG: 1, VIDEO: 1, CANVAS: 1, IFRAME: 1, EMBED: 1, OBJECT: 1, PICTURE: 1,
    svg: 1, path: 1, g: 1, use: 1, defs: 1, circle: 1, rect: 1, line: 1,
    polygon: 1, polyline: 1, ellipse: 1, text: 1
  };

  var disabled = false;
  var mo = null;

  // ---------- already-dark detection ----------

  function brightnessOf(color) {
    var m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/.exec(color);
    if (!m) return null;
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null; // transparent
    return (+m[1] * 299 + +m[2] * 587 + +m[3] * 114) / 1000;
  }

  function checkDarkness() {
    var root = document.documentElement;
    // Lift our own filter/white-base while measuring, otherwise we'd read the
    // background-color:#fff that turbo.css sets and NEVER detect a dark site.
    // Add/remove happens inside one synchronous task — nothing is painted.
    root.classList.add(SKIP_CLASS);
    var b = null;
    if (document.body) b = brightnessOf(getComputedStyle(document.body).backgroundColor);
    if (b === null) b = brightnessOf(getComputedStyle(root).backgroundColor);
    // If the page is already dark (brightness < 100), keep the filter off.
    if (b !== null && b < 100) { stop(); return; }
    root.classList.remove(SKIP_CLASS);
  }

  function stop() {
    disabled = true;
    if (mo) { mo.disconnect(); mo = null; }
    queue.length = 0;
    pendingMarks.length = 0;
    curList = null;
  }

  // ---------- budgeted stylesheet-background scanner ----------

  var seen = new WeakSet();
  var queue = [];          // roots whose subtrees still need scanning
  var pendingMarks = [];   // read phase output -> written in one batch
  var curList = null;      // snapshot of current root's descendants
  var curIdx = 0;
  var tickScheduled = false;

  function scheduleTick() {
    if (tickScheduled || disabled) return;
    tickScheduled = true;
    var cb = function () { tickScheduled = false; slice(); };
    if (window.requestIdleCallback) requestIdleCallback(cb, { timeout: 200 });
    else if (window.requestAnimationFrame) requestAnimationFrame(cb);
    else setTimeout(cb, 16);
  }

  function enqueue(node) {
    if (disabled || !node || node.nodeType !== 1) return;
    queue.push(node);
    scheduleTick();
  }

  function checkNode(el) {
    if (seen.has(el)) return;
    seen.add(el);
    if (SKIP_TAGS[el.tagName]) return;
    if (el.hasAttribute(BG_ATTR)) return;
    // Read phase only — the attribute write happens after the loop so we
    // never interleave style reads with DOM writes (no recalc thrashing).
    var bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none' && bg.indexOf('url(') !== -1) pendingMarks.push(el);
  }

  function slice() {
    if (disabled) return;
    var t0 = performance.now();
    for (;;) {
      if (!curList) {
        var root = queue.shift();
        if (!root) break;
        if (!root.isConnected) continue;
        checkNode(root);
        curList = root.getElementsByTagName('*');
        curIdx = 0;
      }
      while (curIdx < curList.length) {
        checkNode(curList[curIdx++]);
        if (performance.now() - t0 > SLICE_BUDGET_MS) break;
      }
      if (curIdx >= curList.length) curList = null;
      if (performance.now() - t0 > SLICE_BUDGET_MS) break;
    }
    // Write phase: one batch of attribute writes.
    for (var i = 0; i < pendingMarks.length; i++) {
      pendingMarks[i].setAttribute(BG_ATTR, '');
    }
    pendingMarks.length = 0;
    if (curList || queue.length) scheduleTick();
  }

  // ---------- boot ----------

  function start() {
    checkDarkness();
    if (disabled) return;

    enqueue(document.body || document.documentElement);

    mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) enqueue(added[j]); // scanned lazily in slices
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // Some sites apply their (dark) theme late — check once more after load.
    if (document.readyState !== 'complete') {
      window.addEventListener('load', checkDarkness, { once: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
