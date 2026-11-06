import { createDetector } from "/engine/detector.js";
const $ = (id) => document.getElementById(id);
const source = $("source"),
  ctx = source.getContext("2d", { willReadFrequently: true });
const sample = document.createElement("canvas");
sample.width = 32;
sample.height = 18;
const read = sample.getContext("2d", { willReadFrequently: true });
const motion = matchMedia("(prefers-reduced-motion: reduce)");
let frame = null,
  generation = 0,
  running = false,
  events = [],
  selected = "calm",
  latest = null;
const sceneNames = {
  calm: "Calm motion",
  flash: "Rapid changes",
  unreadable: "Unreadable media",
};
const targets = () => document.querySelectorAll('input[name="scene"],#preset');
function shield(kicker, title, detail) {
  $("shield").hidden = false;
  $("shield-kicker").textContent = kicker;
  $("shield-title").textContent = title;
  $("shield-detail").textContent = detail;
  $("calm-caption").hidden = true;
  $("reveal").hidden = true;
}
function paintCalm(c, t = 0) {
  const w = c.canvas.width,
    h = c.canvas.height;
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#164648");
  g.addColorStop(1, "#1b625a");
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = "#79a99a";
  c.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    c.beginPath();
    c.ellipse(
      w * 0.78,
      h * 0.46,
      w * (0.16 + i * 0.055),
      h * (0.22 + i * 0.08),
      -0.3,
      0,
      Math.PI * 2,
    );
    c.stroke();
  }
  c.fillStyle = "#9dc9ad";
  c.beginPath();
  c.arc(w * 0.78, h * 0.46, 14, 0, Math.PI * 2);
  c.fill();
}
function controls() {
  const reduced = motion.matches;
  $("run").disabled = running || reduced;
  $("replay").disabled = running;
  $("stop").disabled = !running;
  $("motion-note").hidden = !reduced;
  targets().forEach((e) => (e.disabled = running));
}
function cancel() {
  generation++;
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  running = false;
  controls();
}
function log(title, detail, type = "shield") {
  events.unshift({
    title,
    detail,
    type,
    time: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  });
  events = events.slice(0, 12);
  renderEvents();
}
function renderEvents() {
  const list = $("events");
  list.replaceChildren();
  $("event-count").textContent = events.length;
  if (!events.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "A clean slate. Your session events will appear here.";
    list.append(li);
    return;
  }
  for (const event of events) {
    const li = document.createElement("li"),
      icon = document.createElement("span"),
      copy = document.createElement("span"),
      title = document.createElement("strong"),
      detail = document.createElement("small"),
      time = document.createElement("span");
    icon.className = "event-icon";
    icon.textContent = event.type === "allow" ? "✓" : "◇";
    copy.className = "event-copy";
    title.textContent = event.title;
    detail.textContent = event.detail;
    time.className = "event-time";
    time.textContent = event.time;
    copy.append(title, detail);
    li.append(icon, copy, time);
    list.append(li);
  }
}
function metrics(report) {
  latest = report;
  $("flashes").textContent =
    report.reason === "unreadable" ? "—" : report.flashesPerSecond.toFixed(0);
  $("flash-caption").textContent =
    report.reason === "unreadable"
      ? "Pixel access unavailable"
      : "Completed opposing transitions";
  $("area").textContent =
    report.reason === "unreadable" ? "—" : `${Math.round(report.areaPct)}%`;
  $("samples").textContent = report.samples;
}
function stop(reason = "Stopped by you") {
  if (!running) return;
  cancel();
  $("run-status").textContent = reason;
  shield(
    "PAUSED",
    "A moment to pause.",
    "The source is stopped. Choose a scene to run another check.",
  );
  $("decision").textContent = "Paused";
  $("decision-detail").textContent = "No source is running";
  log("Session paused", reason);
  $("run").focus();
}
async function run(measurementsOnly = false) {
  if (running || (!measurementsOnly && motion.matches)) return;
  cancel();
  const gen = generation;
  running = true;
  selected = document.querySelector('input[name="scene"]:checked').value;
  latest = null;
  sample.width = 32;
  sample.height = 18;
  source.width = 640;
  source.height = 360; // Reset origin-clean state after the cross-origin test.
  const working = measurementsOnly ? document.createElement("canvas") : source;
  working.width = 640;
  working.height = 360;
  const draw = working.getContext("2d", { willReadFrequently: true });
  paintCalm(draw);
  const areaPx =
    $("stage").getBoundingClientRect().width *
    $("stage").getBoundingClientRect().height;
  const detector = createDetector({
    width: 32,
    height: 18,
    preset: $("preset").value,
    minAreaPx: 21800,
  });
  $("source-label").textContent =
    `local.demo / ${selected === "flash" ? "rapid changes" : selected === "unreadable" ? "unreadable media" : "calm motion"}`;
  $("sample-mode").textContent = measurementsOnly
    ? "Controlled pixel replay · no visible stimulus"
    : "Real source pixels, on-device";
  $("decision").textContent = "Checking";
  $("decision-detail").textContent = "Building a first sample window";
  $("flashes").textContent = "0";
  $("area").textContent = "0%";
  $("samples").textContent = "0";
  $("flash-caption").textContent = "Completed opposing transitions";
  shield(
    "PROTECTIVE HEAD START",
    "Checking before revealing.",
    measurementsOnly
      ? "A measurements-only run. The source stays out of view."
      : "New content stays covered while the first sample window fills.",
  );
  $("run-status").textContent = measurementsOnly
    ? "Running a measurements-only replay"
    : "Analyzing · source is guarded";
  controls();
  $("stop").focus();
  let start = performance.now(),
    lastUpdate = 0,
    allowed = false;
  if (selected === "unreadable") {
    try {
      const img = new Image();
      img.src = `http://127.0.0.1:${Number(location.port) + 1}/cross-origin.svg`;
      await img.decode();
      if (gen !== generation) return;
      draw.drawImage(img, 0, 0, 640, 360);
    } catch {
      if (gen !== generation) return;
      fail("The media source could not be read.");
      return;
    }
  }
  function fail(detail) {
    if (gen !== generation) return;
    const count = latest?.samples || 0;
    cancel();
    metrics({
      flashesPerSecond: 0,
      areaPct: 0,
      samples: count,
      severity: "block",
      violation: true,
      reason: "unreadable",
    });
    shield("UNREADABLE MEDIA", "When in doubt, keep it covered.", detail);
    $("decision").textContent = "Guarded";
    $("decision-detail").textContent = "Fail-closed: no readable pixels";
    $("run-status").textContent = "Guarded · pixel access unavailable";
    log(
      "Unreadable source guarded",
      "Browser pixel access was restricted. Nothing was revealed.",
    );
    $("run").focus();
  }
  function tick(now) {
    if (gen !== generation) return;
    const elapsed = now - start;
    if (selected === "flash") {
      draw.fillStyle =
        Math.floor(elapsed / 125) % 2 === 0 ? "#a2a2a2" : "#171717";
      draw.fillRect(0, 0, 640, 360);
    } else if (selected === "calm") paintCalm(draw);
    let pixels;
    try {
      read.drawImage(working, 0, 0, 32, 18);
      pixels = read.getImageData(0, 0, 32, 18).data;
    } catch {
      fail("The browser rejected cross-origin canvas pixel access.");
      return;
    }
    const report = detector.push({ t: now, pixels, areaPx });
    if (now - lastUpdate > 90 || report.violation) {
      metrics(report);
      lastUpdate = now;
    }
    if (report.violation) {
      cancel();
      shield(
        "RAPID CHANGES DETECTED",
        "A flash caught. A little calm kept.",
        `${report.flashesPerSecond} general flashes in the last second. The source was covered before this demo’s warm-up ended.`,
      );
      $("decision").textContent = "Shielded";
      $("decision-detail").textContent = "Source stopped behind a static cover";
      $("run-status").textContent = "Shielded · source stopped";
      if (!measurementsOnly) $("reveal").hidden = false;
      log(
        "Rapid changes shielded",
        `${report.flashesPerSecond} general flashes / second · ${Math.round(report.areaPct)}% affected source area`,
      );
      $("run").focus();
      return;
    }
    if (elapsed >= 1300 && !allowed) {
      allowed = true;
      $("decision").textContent = "Allowed";
      $("decision-detail").textContent = "No general-flash threshold exceeded";
      if (!measurementsOnly) {
        $("shield").hidden = true;
        $("calm-caption").hidden = false;
      } else
        shield(
          "REPLAY COMPLETE",
          "A readable signal.",
          "No threshold was exceeded. The replay source stays out of view.",
        );
      $("run-status").textContent = "Allowed · continuous sampling";
      log(
        "Calm source allowed",
        "The first sample window was clean. Monitoring continued.",
        "allow",
      );
    }
    if (elapsed >= 5000) {
      cancel();
      $("run-status").textContent = "Check complete · source stopped";
      $("run").focus();
      return;
    }
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
}
$("run").addEventListener("click", () => run(false));
$("replay").addEventListener("click", () => run(true));
$("stop").addEventListener("click", () => stop());
$("reveal").addEventListener("click", () => {
  $("shield").hidden = true;
  $("run-status").textContent =
    "Paused source revealed · no animation is running";
  log("Paused source revealed", "Explicit reveal. The source remains stopped.");
  $("run").focus();
});
$("clear").addEventListener("click", () => {
  events = [];
  renderEvents();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") stop("Stopped with Escape");
});
window.addEventListener("blur", () =>
  stop("Stopped when the window lost focus"),
);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop("Stopped when the tab was hidden");
});
window.addEventListener("pagehide", () => cancel());
motion.addEventListener("change", () => {
  if (motion.matches) stop("Stopped for reduced motion");
  controls();
});
for (const input of document.querySelectorAll('input[name="scene"]'))
  input.addEventListener("change", () => {
    $("source-label").textContent =
      `local.demo / ${sceneNames[input.value].toLowerCase()}`;
  });
paintCalm(ctx);
controls();
