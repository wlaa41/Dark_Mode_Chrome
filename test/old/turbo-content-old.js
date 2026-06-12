'use strict';

/**
 * Ash Turbo - Content Script
 * 
 * High-performance dark mode using CSS filters.
 * The core logic is in turbo.css for zero-latency darkening.
 * This script handles edge cases and 'already dark' detection.
 */

(function() {
  // 1. Skip non-HTML documents (like PDFs or images opened directly)
  if (!(document.documentElement instanceof HTMLHtmlElement)) return;

  function checkDarkness() {
    // Measure the root element's background
    const style = window.getComputedStyle(document.documentElement);
    const bg = style.backgroundColor;
    
    // If background is transparent, check body
    if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
      if (!document.body) {
        // Body not ready, wait for it
        setTimeout(checkDarkness, 10);
        return;
      }
      const bodyStyle = window.getComputedStyle(document.body);
      applyHeuristic(bodyStyle.backgroundColor);
    } else {
      applyHeuristic(bg);
    }
  }

  function applyHeuristic(color) {
    // Simple RGB parser
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return;
    
    const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
    // Perceptual brightness formula
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    
    // If the page is already dark (brightness < 100), disable the turbo filter
    if (brightness < 100) {
      document.documentElement.classList.add('ash-skip-turbo');
    }
  }

  // Run as soon as possible
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      checkDarkness();
      observeImages();
    });
  } else {
    checkDarkness();
    observeImages();
  }

  /**
   * Advanced Re-inversion Helper
   * Some sites (like Temu) use complex CSS for images.
   * This observer finds elements with background images that our CSS might miss.
   */
  function observeImages() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while (node = walker.nextNode()) {
      fixNode(node);
    }

    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) {
            fixNode(n);
            n.querySelectorAll('*').forEach(fixNode);
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function fixNode(el) {
    if (el.tagName === 'IMG' || el.tagName === 'VIDEO' || el.tagName === 'PICTURE') return;
    
    // Check for background images set via stylesheets (which [style*="..."] misses)
    const style = window.getComputedStyle(el);
    const bg = style.backgroundImage;
    if (bg && bg !== 'none' && bg.includes('url(')) {
      el.classList.add('re-invert-forced');
    }
  }

  console.log('[Ash Turbo] Engine Initialized');
})();
