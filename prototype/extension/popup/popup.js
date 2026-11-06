'use strict';

const list = document.getElementById('events');
const empty = document.getElementById('empty');
const status = document.getElementById('status');
const KIND = {
  blocked: 'Rapid flashing hidden',
  unreadable: 'Could not analyze, hidden',
  overflow: 'Too many elements, hidden',
};
const SOURCE = { video: 'video', canvas: 'canvas', css: 'animated element', page: 'whole page' };

function describe(e) {
  const measured = e.kind === 'blocked' && Number.isFinite(e.fps) && Number.isFinite(e.areaPct);
  return measured ? `${e.fps >= 8 ? "8 or more" : "about " + e.fps} flashes/s over ${Math.round(e.areaPct)}%` : 'flash rate not measured';
}

function render(events) {
  const valid = (Array.isArray(events) ? events : [])
    .filter((e) => e && typeof e.host === 'string' && KIND[e.kind] && SOURCE[e.source] && Number.isFinite(e.t));
  list.replaceChildren(...valid.slice().reverse().map((e) => {
    const li = document.createElement('li');
    const host = document.createElement('span');
    host.className = 'host';
    host.textContent = e.host;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${KIND[e.kind]} (${SOURCE[e.source]}): ${describe(e)} · ${new Date(e.t).toLocaleTimeString()}`;
    li.append(host, meta);
    return li;
  }));
  empty.hidden = valid.length > 0;
  list.hidden = valid.length === 0;
}

async function load() {
  const { events } = await chrome.storage.local.get('events');
  render(events);
}

document.getElementById('clear').addEventListener('click', async () => {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'clear' });
    status.textContent = res && res.ok ? 'Events cleared.' : 'Could not clear events.';
  } catch {
    status.textContent = 'Could not clear events.';
  }
  load();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.events) render(changes.events.newValue);
});

load();
