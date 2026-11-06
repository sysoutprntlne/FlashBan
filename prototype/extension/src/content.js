// Seizure Shield prototype content script (isolated world, document_start).
// Consumes the FlashDetector global defined by content-bundle.js.
// New sources are covered by an opaque overlay while their real pixels are sampled
// underneath; the overlay is released only after a clean warmup window.
(() => {
  'use strict';

  const PRESET = 'strict';
  const MIN_AREA = 21800;      // CSS px; smaller elements cannot violate the area gate
  const WARMUP_MS = 1250;
  const MIN_SAMPLES = 8;
  const GAP_MS = 500;          // sampling gap that forces a fresh guarded warmup
  const MAX_ANALYZED = 8;      // sources sampled concurrently (guard + clear)
  const MAX_TRACKED = 32;      // beyond this the whole page is covered
  const MAX_SCAN = 500;        // candidates inspected per element type per scan
  const SCAN_MS = 200;
  const BUDGET_MS = 8;         // sampling time per animation frame
  const MAX_EVENTS = 50;       // log messages per page load
  const W = 32, H = 18;
  const LABEL = { video: 'video', canvas: 'canvas', css: 'animated element' };
  const HOST_RE = /^(?=.{1,253}$)(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/;
  const COVERED = new Set(['guard', 'blocked', 'unreadable', 'overflow']);

  const sources = new Map();   // element -> source record
  const revealed = new WeakSet();
  let running = false, rafId = 0, scanTimer = 0, scanQueued = false, rotate = 0;
  let pageShield = null, pageRevealed = false, eventsSent = 0;

  const sampler = document.createElement('canvas');
  sampler.width = W;
  sampler.height = H;
  const sctx = sampler.getContext('2d', { willReadFrequently: true });
  const dot = document.createElement('canvas');
  dot.width = dot.height = 1;
  const dctx = dot.getContext('2d', { willReadFrequently: true });

  // ---------- detector + logging ----------

  function newDetector(type) {
    try {
      const size = type === 'css' ? { width: 1, height: 1 } : { width: W, height: H };
      return globalThis.FlashDetector.createDetector({ ...size, preset: PRESET, minAreaPx: MIN_AREA });
    } catch {
      return null; // bundle missing or broken: caller fails closed
    }
  }

  function logEvent(kind, source, report) {
    const host = location.hostname.toLowerCase();
    if (eventsSent >= MAX_EVENTS || !HOST_RE.test(host)) return;
    eventsSent++;
    const measured = kind === 'blocked' && report && Number.isFinite(report.flashesPerSecond);
    const msg = {
      type: 'shield-event', host, kind, source,
      fps: measured ? report.flashesPerSecond : null,
      areaPct: measured ? report.areaPct : null,
    };
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch { /* extension reloaded */ }
  }

  // ---------- overlay ----------

  const CSS = `
    :host { all: initial; }
    .box { box-sizing: border-box; width: 100%; height: 100%; overflow: auto; padding: 12px;
      display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 8px;
      background: #111; color: #f2f2f2; border: 2px solid #f2f2f2; font: 14px/1.4 system-ui, sans-serif; }
    p { margin: 0; }
    strong { font-size: 15px; }
    button { font: inherit; color: #111; background: #f2f2f2; border: 2px solid #f2f2f2;
      border-radius: 4px; padding: 6px 10px; cursor: pointer; }
    button:focus-visible { outline: 3px solid #ffbf47; outline-offset: 2px; }
    * { animation: none !important; transition: none !important; }`;

  function makeOverlay(buttonText, onReveal) {
    const host = document.createElement('div');
    for (const [k, v] of Object.entries({ all: 'initial', position: 'fixed', 'z-index': '2147483647',
      display: 'block', left: '0', top: '0', width: '0', height: '0', margin: '0', padding: '0' })) {
      host.style.setProperty(k, v, 'important');
    }
    host.setAttribute('data-flashban-overlay', 'true');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const box = document.createElement('div');
    box.className = 'box';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Seizure shield');
    const title = document.createElement('strong');
    title.textContent = 'Seizure shield';
    const status = document.createElement('p');
    status.id = 'status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = buttonText;
    button.setAttribute('aria-describedby', 'status');
    button.addEventListener('click', (e) => { if (e.isTrusted) onReveal(); });
    box.append(title, status, button);
    root.append(style, box);
    return { host, status, text: '' };
  }

  function setText(overlay, text) {
    if (overlay.text === text) return;
    overlay.text = text;
    // Set after insertion so screen readers announce the change.
    setTimeout(() => { overlay.status.textContent = text; }, 50);
  }

  function removeOverlay(overlay, focusTarget) {
    if (!overlay) return;
    const hadFocus = document.activeElement === overlay.host;
    overlay.host.remove();
    if (hadFocus && focusTarget && focusTarget.tabIndex >= 0) focusTarget.focus({ preventScroll: true });
  }

  function overlayParent() {
    const fs = document.fullscreenElement;
    return fs && fs.localName !== 'video' && fs.localName !== 'canvas' ? fs : document.documentElement;
  }

  function place(src, rect) {
    const o = src.overlay;
    if (!o) return;
    const parent = overlayParent();
    if (parent && o.host.parentNode !== parent) parent.append(o.host);
    const s = o.host.style;
    const hidden = rect.width * rect.height === 0;
    s.setProperty('display', hidden ? 'none' : 'block', 'important');
    s.setProperty('left', `${rect.left}px`, 'important');
    s.setProperty('top', `${rect.top}px`, 'important');
    s.setProperty('width', `${rect.width}px`, 'important');
    s.setProperty('height', `${rect.height}px`, 'important');
  }

  function message(src, report) {
    const what = LABEL[src.type];
    switch (src.state) {
      case 'guard':
        return `Checking this ${what} for rapid flashing before showing it.`;
      case 'blocked': {
        const fps = report.flashesPerSecond >= globalThis.FlashDetector.MAX_REPORTED_RATE
          ? `${report.flashesPerSecond} or more` : `about ${report.flashesPerSecond}`;
        const paused = src.type === 'canvas' ? '' : ' Paused.';
        return `Rapid flashing detected: ${fps} flashes per second over ${Math.round(report.areaPct)}% of this ${what}.${paused} Hidden for safety.`;
      }
      case 'unreadable':
        return `This ${what} could not be analyzed (for example cross-origin or protected content), so it is hidden for safety. Flash rate not measured.`;
      default:
        return `Too many media or animated elements to analyze at once. This ${what} is hidden for safety. Flash rate not measured.`;
    }
  }

  // ---------- source lifecycle ----------

  const analyzedCount = () => {
    let n = 0;
    for (const s of sources.values()) if (s.state === 'guard' || s.state === 'clear') n++;
    return n;
  };

  function setState(src, state, report) {
    if (state === 'guard' && !src.det) state = 'unreadable';
    src.state = state;
    if (state === 'clear') {
      removeOverlay(src.overlay, src.el);
      src.overlay = null;
      return;
    }
    if (state === 'guard') {
      src.det.reset();
      src.startT = performance.now();
      src.firstT = 0;
      src.lastT = 0;
    } else if (state === 'blocked') {
      pause(src);
      logEvent('blocked', src.type, report);
    } else {
      logEvent(state, src.type, null);
    }
    if (!src.overlay) {
      src.overlay = makeOverlay(`Show this ${LABEL[src.type]} anyway`, () => reveal(src));
      place(src, src.el.getBoundingClientRect());
    }
    src.overlay.host.dataset.state = state;
    setText(src.overlay, message(src, report));
  }

  function pause(src) {
    try {
      if (src.type === 'video') src.el.pause();
      if (src.type === 'css') {
        for (const a of src.el.getAnimations()) {
          if (a.playState === 'running') { a.pause(); src.paused.push(a); }
        }
      }
    } catch { /* cover remains */ }
  }

  function track(el, type) {
    if (sources.has(el) || revealed.has(el)) return;
    if (sources.size >= MAX_TRACKED) { showPageShield(); return; }
    const src = { el, type, det: newDetector(type), state: 'guard', overlay: null, paused: [],
      startT: 0, firstT: 0, lastT: 0, idleT: 0, off: [] };
    const slots = analyzedCount();
    sources.set(el, src);
    if (type === 'video' && typeof el.requestVideoFrameCallback === 'function') {
      src.freshFrame = true;
      let callbackId;
      const next = () => { callbackId = el.requestVideoFrameCallback(() => {
        if (!sources.has(el)) return;
        src.freshFrame = true; next();
      }); };
      next();
      src.off.push(() => el.cancelVideoFrameCallback(callbackId));
    }
    if (type === 'video') {
      on(src, 'play', () => {
        if (src.state === 'blocked') el.pause();
        else if (src.state === 'clear') setState(src, 'guard'); // every play gets a guarded warmup
      });
      on(src, 'loadstart', () => { if (src.state !== 'guard' && src.state !== 'overflow') setState(src, 'guard'); });
    }
    setState(src, slots >= MAX_ANALYZED ? 'overflow' : 'guard');
  }

  function on(src, type, fn) {
    src.el.addEventListener(type, fn, true);
    src.off.push(() => src.el.removeEventListener(type, fn, true));
  }

  function drop(src) {
    for (const off of src.off) off();
    removeOverlay(src.overlay, src.el);
    src.overlay = null;
    sources.delete(src.el);
  }

  function reveal(src) {
    revealed.add(src.el);
    for (const a of src.paused) { try { a.play(); } catch { /* ignore */ } }
    drop(src);
  }

  function showPageShield() {
    if (pageShield || pageRevealed) return;
    pageShield = makeOverlay('Show this page anyway', () => {
      pageRevealed = true;
      removeOverlay(pageShield, null);
      pageShield = null;
    });
    logEvent('overflow', 'page', null);
    const s = pageShield.host.style;
    s.setProperty('width', '100vw', 'important');
    s.setProperty('height', '100vh', 'important');
    overlayParent()?.append(pageShield.host);
    setText(pageShield, 'This page has more media or animated elements than the shield can analyze, so the page is hidden for safety. Flash rate not measured.');
  }

  // ---------- sampling ----------

  function pageBackdrop() {
    for (const node of [document.body, document.documentElement]) {
      if (!node) continue;
      const c = getComputedStyle(node).backgroundColor;
      if (c && c !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(c)) return c;
    }
    return '#ffffff';
  }

  // Returns real pixels, null when there is no frame yet, or throws (fail closed).
  function read(src, backdrop) {
    const el = src.el;
    if (src.type === 'css') {
      // DOM approximation: computed background colour x own opacity over the page background.
      const cs = getComputedStyle(el);
      const op = Number.parseFloat(cs.opacity);
      dctx.globalAlpha = 1;
      dctx.fillStyle = backdrop;
      dctx.fillRect(0, 0, 1, 1);
      dctx.globalAlpha = Number.isFinite(op) ? Math.min(1, Math.max(0, op)) : 1;
      dctx.fillStyle = cs.backgroundColor;
      dctx.fillRect(0, 0, 1, 1);
      dctx.globalAlpha = 1;
      return dctx.getImageData(0, 0, 1, 1).data;
    }
    if (src.type === 'video') {
      if (el.mediaKeys) throw new Error('protected media');
      if (el.readyState < 2 || !el.videoWidth) return null;
    } else if (!el.width || !el.height) {
      return null;
    }
    sctx.globalAlpha = 1;
    sctx.fillStyle = backdrop;
    sctx.fillRect(0, 0, W, H);
    sctx.drawImage(el, 0, 0, W, H);
    return sctx.getImageData(0, 0, W, H).data; // SecurityError when tainted
  }

  function frame() {
    rafId = 0;
    if (!running) return;
    const t0 = performance.now();
    let backdrop = null;
    const fs = document.fullscreenElement;
    const list = [...sources.values()];
    rotate = list.length ? (rotate + 1) % list.length : 0;

    for (let k = 0; k < list.length; k++) {
      const src = list[(k + rotate) % list.length];
      if (!sources.has(src.el)) continue;
      if (!src.el.isConnected) { drop(src); continue; }
      const rect = src.el.getBoundingClientRect();
      const area = rect.width * rect.height;
      place(src, rect);
      if (fs && fs === src.el && COVERED.has(src.state)) document.exitFullscreen().catch(() => {});
      if (src.state !== 'guard' && src.state !== 'clear') continue;
      const now = performance.now();
      if (src.lastT && now - src.lastT > GAP_MS) setState(src, 'guard'); // starved or hidden: re-warm
      if (area === 0) continue;
      if (area < MIN_AREA) { drop(src); continue; }
      if (now - t0 > BUDGET_MS) continue;

      if (src.type === 'video' && !src.el.paused && src.freshFrame === false) continue;
      let report;
      try {
        backdrop ??= pageBackdrop();
        const pixels = read(src, backdrop);
        if (!pixels) continue;
        report = src.det.push({ t: now, pixels, areaPx: area });
        if (src.type === 'video' && typeof src.el.requestVideoFrameCallback === 'function') src.freshFrame = false;
      } catch {
        // A tainted source must not poison pixel reads for unrelated sources.
        sampler.width = W; dot.width = 1;
        setState(src, 'unreadable');
        continue;
      }
      src.lastT = now;
      if (!src.firstT) src.firstT = now;
      if (report.reason === 'unreadable') setState(src, 'unreadable');
      else if (report.violation) setState(src, 'blocked', report);
      else if (src.state === 'guard' && report.samples >= MIN_SAMPLES &&
        now - src.firstT >= WARMUP_MS && now - src.startT >= WARMUP_MS) setState(src, 'clear');
    }
    rafId = requestAnimationFrame(frame);
  }

  // ---------- discovery ----------

  function scan() {
    scanQueued = false;
    if (!running) return;
    const vw = innerWidth, vh = innerHeight;
    const consider = (el, type) => {
      if (sources.has(el) || revealed.has(el) || (pageRevealed && sources.size >= MAX_TRACKED)) return;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < MIN_AREA) return;
      if (r.bottom < -vh || r.top > 2 * vh || r.right < -vw || r.left > 2 * vw) return;
      track(el, type);
    };
    for (const tag of ['video', 'canvas']) {
      const els = document.getElementsByTagName(tag);
      for (let i = 0; i < els.length && i < MAX_SCAN; i++) consider(els[i], tag);
    }
    if (typeof document.getAnimations === 'function') {
      const anims = document.getAnimations();
      for (let i = 0; i < anims.length && i < MAX_SCAN; i++) {
        const a = anims[i], fx = a.effect;
        if (!(a instanceof CSSAnimation) || a.playState !== 'running' || !fx || fx.pseudoElement) continue;
        if (fx.target instanceof Element) consider(fx.target, 'css');
      }
    }
    const now = performance.now();
    for (const src of [...sources.values()]) {
      if (src.state === 'overflow' && analyzedCount() < MAX_ANALYZED) setState(src, 'guard');
      if (src.type === 'css' && src.state === 'clear') {
        const active = src.el.getAnimations().some((a) => a.playState === 'running');
        if (active) src.idleT = 0;
        else if (!src.idleT) src.idleT = now;
        else if (now - src.idleT > 2000) drop(src);
      }
    }
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    queueMicrotask(scan); // runs before paint, so new media is covered before first display
  }

  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.localName === 'video' || n.localName === 'canvas' ||
          n.getElementsByTagName('video').length || n.getElementsByTagName('canvas').length) {
          queueScan();
          return;
        }
      }
    }
  });

  function start() {
    if (running) return;
    running = true;
    observer.observe(document, { childList: true, subtree: true });
    document.addEventListener('animationstart', queueScan, true);
    scanTimer = setInterval(scan, SCAN_MS);
    scan();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    clearInterval(scanTimer);
    observer.disconnect();
    document.removeEventListener('animationstart', queueScan, true);
    for (const src of [...sources.values()]) drop(src);
    removeOverlay(pageShield, null);
    pageShield = null;
  }

  addEventListener('pagehide', stop, true);
  addEventListener('pageshow', (e) => { if (e.persisted) start(); }, true);
  start();
})();
