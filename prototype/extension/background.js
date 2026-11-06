// Local-only event log. No network. Stores hostname + metrics, never URLs.
"use strict";

const MAX_EVENTS = 100;
const HOST_RE =
  /^(?=.{1,253}$)(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/;
const KINDS = new Set(["blocked", "unreadable", "overflow"]);
const SOURCES = new Set(["video", "canvas", "css", "page"]);
const EVENT_KEYS = ["areaPct", "fps", "host", "kind", "source", "type"];

let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

function senderHost(sender) {
  try {
    const u = new URL(sender.url);
    return u.protocol === "http:" || u.protocol === "https:"
      ? u.hostname
      : null;
  } catch {
    return null;
  }
}

function validEvent(msg, sender) {
  if (Object.keys(msg).sort().join() !== EVENT_KEYS.join()) return false;
  if (!sender.tab || typeof msg.host !== "string" || !HOST_RE.test(msg.host))
    return false;
  if (senderHost(sender) !== msg.host) return false;
  if (!KINDS.has(msg.kind) || !SOURCES.has(msg.source)) return false;
  if (msg.kind === "blocked") {
    return (
      Number.isInteger(msg.fps) &&
      msg.fps >= 0 &&
      msg.fps <= 1000 &&
      typeof msg.areaPct === "number" &&
      msg.areaPct >= 0 &&
      msg.areaPct <= 100
    );
  }
  return msg.fps === null && msg.areaPct === null; // not measured: never store numbers
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (
    sender.id !== chrome.runtime.id ||
    !msg ||
    typeof msg !== "object" ||
    Array.isArray(msg)
  )
    return;

  if (msg.type === "shield-event" && validEvent(msg, sender)) {
    const entry = {
      t: Date.now(),
      host: msg.host,
      kind: msg.kind,
      source: msg.source,
      fps: msg.fps,
      areaPct: msg.areaPct,
    };
    serial(async () => {
      const { events } = await chrome.storage.local.get("events");
      const list = Array.isArray(events) ? events : [];
      list.push(entry);
      await chrome.storage.local.set({ events: list.slice(-MAX_EVENTS) });
    }).catch(() => {});
    return;
  }

  const fromPopup =
    typeof sender.url === "string" &&
    sender.url === chrome.runtime.getURL("popup/popup.html");
  if (msg.type === "clear" && Object.keys(msg).length === 1 && fromPopup) {
    serial(() => chrome.storage.local.set({ events: [] })).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
});
