import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const code = await readFile(
  new URL("../extension/background.js", import.meta.url),
  "utf8",
);
function harness() {
  let listener,
    events = [];
  const id = "test-extension";
  const chrome = {
    runtime: {
      id,
      getURL: (p) => `chrome-extension://${id}/${p}`,
      onMessage: { addListener: (fn) => (listener = fn) },
    },
    storage: {
      local: {
        get: async () => ({ events: structuredClone(events) }),
        set: async (v) => {
          events = structuredClone(v.events);
        },
      },
    },
  };
  vm.runInNewContext(code, {
    chrome,
    URL,
    Promise,
    Date,
    Set,
    Number,
    Object,
    Array,
  });
  return {
    send: (msg, sender, response = () => {}) => listener(msg, sender, response),
    events: () => events,
    id,
  };
}
const event = {
  type: "shield-event",
  host: "example.com",
  kind: "blocked",
  source: "canvas",
  fps: 4,
  areaPct: 100,
};
const sender = {
  id: "test-extension",
  url: "https://example.com/path?private=yes",
  tab: { id: 1 },
};
const settle = () => new Promise((r) => setTimeout(r, 20));
test("rejects foreign extensions, hostname spoofing, extra fields and invalid metrics", async () => {
  const h = harness();
  h.send(event, { ...sender, id: "other" });
  h.send({ ...event, host: "victim.com" }, sender);
  h.send({ ...event, url: "https://example.com/private" }, sender);
  h.send({ ...event, fps: NaN }, sender);
  h.send({ ...event, areaPct: 101 }, sender);
  h.send({ ...event, source: "script" }, sender);
  await settle();
  assert.equal(h.events().length, 0);
});
test("concurrent valid reports serialize, stay bounded and never store URL paths", async () => {
  const h = harness();
  for (let i = 0; i < 120; i++) h.send({ ...event, fps: 3 + (i % 5) }, sender);
  await settle();
  assert.equal(h.events().length, 100);
  for (const e of h.events()) {
    assert.equal(e.host, "example.com");
    assert.equal("url" in e, false);
    assert.equal("path" in e, false);
    assert.equal(e.kind, "blocked");
  }
});
test("unreadable sources must not invent measurements", async () => {
  const h = harness();
  h.send({ ...event, kind: "unreadable" }, sender);
  await settle();
  assert.equal(h.events().length, 0);
  h.send({ ...event, kind: "unreadable", fps: null, areaPct: null }, sender);
  await settle();
  assert.equal(h.events().length, 1);
  assert.equal(h.events()[0].fps, null);
});
test("only the exact extension popup may clear events", async () => {
  const h = harness();
  h.send(event, sender);
  await settle();
  h.send({ type: "clear" }, sender);
  h.send(
    { type: "clear" },
    { id: h.id, url: `chrome-extension://${h.id}/other.html` },
  );
  await settle();
  assert.equal(h.events().length, 1);
  const response = await new Promise((r) =>
    h.send(
      { type: "clear" },
      { id: h.id, url: `chrome-extension://${h.id}/popup/popup.html` },
      r,
    ),
  );
  assert.equal(response.ok, true);
  assert.equal(h.events().length, 0);
});
