'use strict';

/* Shared helpers for the Ash test pages.
   Generates recognizable test "photos" at runtime (white background + colored
   shapes). If a photo is wrongly inverted, its white background turns black —
   instantly visible in a screenshot and checkable from computed styles. */

function makePhoto(size, label) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';                 // white photo background (telltale)
  x.fillRect(0, 0, size, size);
  x.fillStyle = '#e53935';                 // red square
  x.fillRect(size * 0.08, size * 0.08, size * 0.36, size * 0.36);
  x.fillStyle = '#43a047';                 // green circle
  x.beginPath();
  x.arc(size * 0.7, size * 0.3, size * 0.18, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#1e88e5';                 // blue triangle
  x.beginPath();
  x.moveTo(size * 0.5, size * 0.55);
  x.lineTo(size * 0.85, size * 0.9);
  x.lineTo(size * 0.15, size * 0.9);
  x.closePath();
  x.fill();
  x.fillStyle = '#111';
  x.font = 'bold ' + Math.round(size * 0.16) + 'px sans-serif';
  x.fillText(label, size * 0.06, size * 0.98);
  return c.toDataURL('image/png');
}

// Colorful 40px swatch (like a Temu color-variant chip) — must NEVER invert.
function makeSwatch() {
  const c = document.createElement('canvas');
  c.width = 40; c.height = 40;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 40, 40);
  g.addColorStop(0, '#ff5722');
  g.addColorStop(1, '#ffc107');
  x.fillStyle = g;
  x.fillRect(0, 0, 40, 40);
  return c.toDataURL('image/png');
}

// Dark monochrome glyph icon (transparent bg) — main Ash SHOULD invert this.
function makeGlyph() {
  const c = document.createElement('canvas');
  c.width = 40; c.height = 40;
  const x = c.getContext('2d');
  x.strokeStyle = '#222222';
  x.lineWidth = 6;
  x.beginPath();
  x.moveTo(8, 20); x.lineTo(32, 20);
  x.moveTo(22, 10); x.lineTo(32, 20); x.lineTo(22, 30);
  x.stroke();
  return c.toDataURL('image/png');
}

// Tiny placeholder, like a lazy-loader's pre-image. Dark by default so the
// icon-inverter takes the bait — the real photo must then clear the filter.
function makePlaceholder(color) {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = color || '#333333';
  x.fillRect(0, 0, 16, 16);
  return c.toDataURL('image/png');
}

function report(checks) {
  const pre = document.getElementById('results');
  let allPass = true;
  pre.textContent = checks.map(([name, pass]) => {
    if (!pass) allPass = false;
    return (pass ? 'PASS' : 'FAIL') + '  ' + name;
  }).join('\n');
  pre.textContent += '\n\n' + (allPass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  document.title = (allPass ? 'PASS - ' : 'FAIL - ') + document.title;
}
