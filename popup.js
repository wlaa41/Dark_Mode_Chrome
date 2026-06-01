'use strict';

const $ = id => document.getElementById(id);
const siteEl   = $('currentSite');
const toggleEl = $('toggleBtn');
const hintEl   = $('hint');
const countEl  = $('count');
const listEl   = $('list');
const emptyEl  = $('empty');
const addInput = $('addInput');
const addBtn   = $('addBtn');

let currentHost = null;
let currentTabId = null;
let currentSupported = false;

function normalizeHost(input) {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (!/^[a-z0-9.-]+$/i.test(s)) return null;
  if (!s.includes('.') && s !== 'localhost') return null;
  return s;
}

function send(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, res => {
      // Touch lastError so Chrome doesn't log "Unchecked runtime.lastError"
      // when the service worker is briefly asleep; resolve undefined instead.
      void chrome.runtime.lastError;
      resolve(res);
    });
  });
}

function renderToggle(disabled) {
  if (!currentSupported) {
    toggleEl.textContent = 'Not available on this page';
    toggleEl.className = 'btn primary';
    toggleEl.disabled = true;
    hintEl.textContent = 'Ash only runs on http / https pages.';
    return;
  }
  toggleEl.disabled = false;
  if (disabled) {
    toggleEl.textContent = 'Turn ON for this site';
    toggleEl.className = 'btn primary off';
    hintEl.textContent = 'Dark mode is OFF here. Reloads on click.';
  } else {
    toggleEl.textContent = 'Turn OFF for this site';
    toggleEl.className = 'btn primary on';
    hintEl.textContent = 'Dark mode is ON. Reloads on click.';
  }
}

function renderList(list) {
  countEl.textContent = String(list.length);
  listEl.innerHTML = '';
  if (!list.length) {
    emptyEl.classList.remove('hidden');
    listEl.classList.add('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  listEl.classList.remove('hidden');
  for (const host of list) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'host';
    span.textContent = host;
    const btn = document.createElement('button');
    btn.textContent = '×';
    btn.title = 'Remove (re-enable dark mode here)';
    btn.addEventListener('click', async () => {
      const res = await send({ type: 'remove', host });
      if (res && res.list) {
        renderList(res.list);
        if (host === currentHost) renderToggle(false);
      }
    });
    li.appendChild(span);
    li.appendChild(btn);
    listEl.appendChild(li);
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab ? tab.id : null;

  let host = null;
  if (tab && tab.url) {
    try {
      const u = new URL(tab.url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        host = u.hostname;
        currentSupported = true;
      }
    } catch { /* ignore */ }
  }
  currentHost = host;
  siteEl.textContent = host || '(internal page)';

  const state = await send({ type: 'getState' });
  const list = (state && state.disabled) || [];
  const disabled = host ? list.includes(host) : false;
  renderToggle(disabled);
  renderList(list);
}

toggleEl.addEventListener('click', async () => {
  if (!currentHost) return;
  toggleEl.disabled = true;
  const res = await send({ type: 'toggle', host: currentHost });
  if (!res || !res.ok) { toggleEl.disabled = false; return; }
  renderToggle(res.disabled);
  renderList(res.list);
  if (currentTabId != null) chrome.tabs.reload(currentTabId);
  setTimeout(() => window.close(), 120);
});

async function submitAdd() {
  const host = normalizeHost(addInput.value);
  if (!host) {
    addInput.focus();
    addInput.select();
    return;
  }
  const res = await send({ type: 'add', host });
  if (res && res.list) {
    addInput.value = '';
    renderList(res.list);
    if (host === currentHost) renderToggle(true);
  }
}

addBtn.addEventListener('click', submitAdd);
addInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') submitAdd();
});

init();
