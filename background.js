'use strict';

const SCRIPT_ID = 'quickdark-main';
const STORAGE_KEY = 'disabledSites';

function hostToPattern(host) {
  return `*://${host}/*`;
}

async function getDisabled() {
  const { [STORAGE_KEY]: list = [] } = await chrome.storage.local.get(STORAGE_KEY);
  return list;
}

async function setDisabled(list) {
  await chrome.storage.local.set({ [STORAGE_KEY]: list });
}

async function syncScripts() {
  const disabled = await getDisabled();
  const excludeMatches = disabled.length ? disabled.map(hostToPattern) : undefined;
  const def = {
    id: SCRIPT_ID,
    matches: ['<all_urls>'],
    js: ['content.js'],
    css: ['early.css'],
    runAt: 'document_start',
    allFrames: true,
    persistAcrossSessions: true
  };
  if (excludeMatches) def.excludeMatches = excludeMatches;

  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length) {
      await chrome.scripting.updateContentScripts([def]);
    } else {
      await chrome.scripting.registerContentScripts([def]);
    }
  } catch (e) {
    console.error('[QuickDark] syncScripts failed:', e);
  }
}

chrome.runtime.onInstalled.addListener(syncScripts);
chrome.runtime.onStartup.addListener(syncScripts);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'getState') {
    (async () => {
      const list = await getDisabled();
      sendResponse({ disabled: list });
    })();
    return true;
  }

  if (msg.type === 'toggle' && typeof msg.host === 'string') {
    (async () => {
      const list = await getDisabled();
      const set = new Set(list);
      let nowDisabled;
      if (set.has(msg.host)) {
        set.delete(msg.host);
        nowDisabled = false;
      } else {
        set.add(msg.host);
        nowDisabled = true;
      }
      const next = [...set].sort();
      await setDisabled(next);
      await syncScripts();
      sendResponse({ ok: true, disabled: nowDisabled, list: next });
    })();
    return true;
  }

  if (msg.type === 'remove' && typeof msg.host === 'string') {
    (async () => {
      const list = await getDisabled();
      const next = list.filter(h => h !== msg.host);
      await setDisabled(next);
      await syncScripts();
      sendResponse({ ok: true, list: next });
    })();
    return true;
  }

  if (msg.type === 'fetchText' && typeof msg.url === 'string') {
    (async () => {
      try {
        const res = await fetch(msg.url, { credentials: 'omit', cache: 'force-cache' });
        if (!res.ok) { sendResponse({ ok: false, status: res.status }); return; }
        const text = await res.text();
        sendResponse({ ok: true, text });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg.type === 'add' && typeof msg.host === 'string') {
    (async () => {
      const list = await getDisabled();
      const set = new Set(list);
      set.add(msg.host);
      const next = [...set].sort();
      await setDisabled(next);
      await syncScripts();
      sendResponse({ ok: true, list: next });
    })();
    return true;
  }
});
