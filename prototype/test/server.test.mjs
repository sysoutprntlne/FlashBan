import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test("local delivery supports full files, HEAD, video byte ranges and invalid-range rejection", async () => {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../server.mjs", import.meta.url))],
    {
      env: { ...process.env, PORT: "19877" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = once(child, "exit");
  const timeout = setTimeout(() => child.kill(), 5000);
  try {
    await Promise.race([
      once(child.stdout, "data"),
      exited.then(() => {
        throw new Error("server exited before becoming ready");
      }),
    ]);
    const url = "http://127.0.0.1:19877/studio/style.css";
    const whole = await fetch(url),
      text = await whole.text();
    assert.equal(whole.status, 200);
    const part = await fetch(url, { headers: { Range: "bytes=0-31" } });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), text.slice(0, 32));
    assert.match(part.headers.get("content-range"), /^bytes 0-31\//);
    const suffix = await fetch(url, { headers: { Range: "bytes=-16" } });
    assert.equal(await suffix.text(), text.slice(-16));
    const head = await fetch(url, { method: "HEAD" });
    assert.equal(await head.text(), "");
    assert.equal(
      Number(head.headers.get("content-length")),
      Buffer.byteLength(text),
    );
    const invalid = await fetch(url, {
      headers: { Range: "bytes=999999999-" },
    });
    assert.equal(invalid.status, 416);
  } finally {
    clearTimeout(timeout);
    child.kill();
    await exited;
  }
});
