import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL(".", import.meta.url));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".vtt": "text/vtt; charset=utf-8",
  ".zip": "application/zip",
};
const port = Number(process.env.PORT || 8787);
const main = http.createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (pathname === "/") pathname = "/studio/index.html";
    const file = path.resolve(root, "." + pathname);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    const bytes = await readFile(file);
    const headers = {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Accept-Ranges": "bytes",
    };
    let start = 0,
      end = bytes.length - 1,
      status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (match && (match[1] || match[2])) {
        start = match[1]
          ? Number(match[1])
          : Math.max(0, bytes.length - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      }
      if (
        !match ||
        !(match[1] || match[2]) ||
        start > end ||
        start >= bytes.length
      ) {
        res
          .writeHead(416, { "Content-Range": `bytes */${bytes.length}` })
          .end();
        return;
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${bytes.length}`;
    }
    headers["Content-Length"] = Math.max(0, end - start + 1);
    res.writeHead(status, headers);
    res.end(req.method === "HEAD" ? undefined : bytes.subarray(start, end + 1));
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});
// A deliberately different origin, with no CORS header, for a real tainted-canvas test.
const cross = http.createServer((_req, res) => {
  res.writeHead(200, {
    "Content-Type": "image/svg+xml",
    "Cache-Control": "no-store",
  });
  res.end(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#244f55"/></svg>',
  );
});
main.listen(port, "127.0.0.1", () =>
  console.log(`FlashBan studio: http://127.0.0.1:${port}`),
);
cross.listen(port + 1, "127.0.0.1");
for (const server of [main, cross])
  server.on("error", (e) => {
    console.error(e.message);
    process.exitCode = 1;
    main.close();
    cross.close();
  });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    main.close();
    cross.close();
  });
